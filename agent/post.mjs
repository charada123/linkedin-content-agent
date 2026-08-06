// Entry point: pick a theory, generate a motivational post about it, and
// (optionally) publish it.
//
//   node post.mjs                    # dry run — generate and print, do NOT publish
//   node post.mjs --post             # generate AND publish to LinkedIn
//   node post.mjs --theory maslow    # force a theory (substring match)
//
// The dry-run default is a safety net: you never accidentally publish while
// testing. The scheduled GitHub Action passes --post explicitly.

import { config } from "./config.mjs";
import { generatePost } from "./generate.mjs";
import { resolveAuthorUrn, publishPost, deletePost } from "./linkedin.mjs";
import { loadHistory, appendHistory, recent } from "./history.mjs";

function parseArgs(argv) {
  const args = { post: false, theory: null, delete: null, ad: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--post") args.post = true;
    else if (argv[i] === "--theory") args.theory = argv[++i];
    else if (argv[i] === "--delete") args.delete = argv[++i];
    else if (argv[i] === "--ad") args.ad = true;
  }
  return args;
}

// Should this run be an ad rather than a concept post? We aim for one ad per
// `theoriesPerAd` concept posts, counting only posts made since ads were
// introduced (adBaselineNonAd) so the curated concept series runs first.
function shouldPostAd(history) {
  if (!config.ads?.length) return false;
  const ads = history.filter((h) => h.type === "ad").length;
  const nonAds = history.length - ads;
  const newConcepts = nonAds - config.adBaselineNonAd;
  return newConcepts >= (ads + 1) * config.theoriesPerAd;
}

// Pick the next ad in rotation and assemble its published text (body, then the
// supporting article, then hashtags).
function chooseAd(history) {
  const ads = history.filter((h) => h.type === "ad").length;
  const ad = config.ads[ads % config.ads.length];
  const tags = (ad.hashtags || []).join(" ");
  // Only ads with includeLink carry a source link (in the body, since
  // LinkedIn's comment API needs partner access we don't have). Others go
  // link-free so the feed isn't citing a study on every ad.
  const link =
    ad.includeLink && ad.article
      ? `${ad.article.title}\n${ad.article.url}`
      : null;
  const commentary = [ad.text, link, tags].filter(Boolean).join("\n\n");
  return { ad, commentary };
}

// Choose the next theory. In "rotate" mode we look at the last posted theory
// and advance to the next one in the list; in "random" mode we pick at random.
// An explicit --theory value matches by case-insensitive substring.
function chooseTheory(history, explicitQuery) {
  if (explicitQuery) {
    const q = explicitQuery.toLowerCase();
    const t = config.theories.find((t) => t.name.toLowerCase().includes(q));
    if (!t) throw new Error(`No theory matches "${explicitQuery}".`);
    return t;
  }
  if (config.selection === "random") {
    return config.theories[Math.floor(Math.random() * config.theories.length)];
  }
  // rotate: advance from the last *concept* posted (ignore ad entries, which
  // have no `theory`), and skip any theory posted in the recent window so we
  // don't repeat one that just went out.
  const posted = history.filter((h) => h.theory).map((h) => h.theory);
  const lastIdx = config.theories.findIndex((t) => t.name === posted.at(-1));
  const recent = new Set(posted.slice(-config.historyContext));
  for (let step = 1; step <= config.theories.length; step++) {
    const cand = config.theories[(lastIdx + step) % config.theories.length];
    if (!recent.has(cand.name)) return cand;
  }
  return config.theories[(lastIdx + 1) % config.theories.length];
}

async function main() {
  const args = parseArgs(process.argv);

  // Delete mode: remove a previously published post by URN, then exit.
  if (args.delete) {
    const token = process.env.LINKEDIN_ACCESS_TOKEN;
    if (!token) throw new Error("LINKEDIN_ACCESS_TOKEN is not set.");
    console.log(`Deleting ${args.delete}...`);
    await deletePost(token, args.delete);
    console.log("Deleted.");
    return;
  }

  const history = await loadHistory();

  // Ad path: an explicit --ad, or the cadence says it's an ad's turn (unless a
  // specific --theory was requested, which always produces a concept post).
  if (args.ad || (!args.theory && shouldPostAd(history))) {
    const { ad, commentary } = chooseAd(history);
    console.log(`Ad: ${ad.id}`);
    console.log("─".repeat(60));
    console.log(commentary);
    console.log("─".repeat(60));

    if (!args.post) {
      console.log("\nDry run — not published. Re-run with --post to publish.");
      return;
    }

    const token = process.env.LINKEDIN_ACCESS_TOKEN;
    if (!token) throw new Error("LINKEDIN_ACCESS_TOKEN is not set.");
    const authorUrn = await resolveAuthorUrn(token);
    console.log(`\nPublishing ad as ${authorUrn}...`);
    const postUrn = await publishPost(token, authorUrn, commentary);
    console.log(`Published: ${postUrn}`);

    await appendHistory({
      postedAt: new Date().toISOString(),
      type: "ad",
      ad: ad.id,
      article: ad.article.url,
      urn: postUrn,
    });
    console.log("Logged to data/history.json.");
    return;
  }

  const theory = chooseTheory(history, args.theory);

  console.log(`Theory: ${theory.name} (${theory.category})`);
  console.log("Generating post with Claude...\n");

  const post = await generatePost(theory, recent(history, config.historyContext));

  console.log("─".repeat(60));
  console.log(post.commentary);
  console.log("─".repeat(60));
  console.log(
    `\nTokens: ${post.usage.input_tokens} in / ${post.usage.output_tokens} out`,
  );

  if (!args.post) {
    console.log("\nDry run — not published. Re-run with --post to publish.");
    return;
  }

  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  if (!token) throw new Error("LINKEDIN_ACCESS_TOKEN is not set.");

  const authorUrn = await resolveAuthorUrn(token);
  console.log(`\nPublishing as ${authorUrn}...`);
  const postUrn = await publishPost(token, authorUrn, post.commentary);
  console.log(`Published: ${postUrn}`);

  await appendHistory({
    postedAt: new Date().toISOString(),
    type: "theory",
    theory: theory.name,
    category: theory.category,
    text: post.text,
    hashtags: post.hashtags,
    urn: postUrn,
  });
  console.log("Logged to data/history.json.");
}

main().catch((err) => {
  console.error("\nError:", err.message);
  process.exit(1);
});
