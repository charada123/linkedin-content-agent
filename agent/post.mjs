// Entry point: pick a theory, generate a motivational post about it, and
// (optionally) publish it.
//
//   node post.mjs                    # dry run — generate and print, do NOT publish
//   node post.mjs --post             # generate AND publish to LinkedIn
//   node post.mjs --theory maslow    # force a theory (substring match)
//   node post.mjs --video            # force this post to be an explainer video
//   node post.mjs --no-video         # force plain text even if a video is due
//
// The dry-run default is a safety net: you never accidentally publish while
// testing. The scheduled GitHub Action passes --post explicitly.

import { readFile } from "node:fs/promises";

import { config } from "./config.mjs";
import { generatePost, generateVideoScript } from "./generate.mjs";
import { resolveAuthorUrn, publishPost, deletePost, uploadVideo } from "./linkedin.mjs";
import { renderVideo, defaultOutPath } from "./video.mjs";
import { loadHistory, appendHistory, recent } from "./history.mjs";

function parseArgs(argv) {
  const args = { post: false, theory: null, delete: null, ad: false, video: false, noVideo: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--post") args.post = true;
    else if (argv[i] === "--theory") args.theory = argv[++i];
    else if (argv[i] === "--delete") args.delete = argv[++i];
    else if (argv[i] === "--ad") args.ad = true;
    else if (argv[i] === "--video") args.video = true;
    else if (argv[i] === "--no-video") args.noVideo = true;
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

// Should this theory post be delivered as a video rather than plain text? Every
// `theoriesPerVideo`-th theory post becomes a video. Counting only theory-shaped
// posts (text or video) keeps this independent of the ad rhythm, so adding video
// does not shift when ads land.
function shouldPostVideo(history) {
  const delivered = history.filter(
    (h) => h.type === "theory" || h.type === "video",
  ).length;
  const sinceBaseline = delivered - config.videoBaselineTheories;
  if (sinceBaseline < 0) return false;
  // sinceBaseline counts posts already made, so this run is the next one.
  return (sinceBaseline + 1) % config.theoriesPerVideo === 0;
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
  const asVideo = args.video || (!args.noVideo && shouldPostVideo(history));

  console.log(`Theory: ${theory.name} (${theory.category})`);
  console.log(`Format: ${asVideo ? "explainer video" : "text"}`);
  console.log("Generating post with Claude...\n");

  const post = await generatePost(theory, recent(history, config.historyContext));

  console.log("─".repeat(60));
  console.log(post.commentary);
  console.log("─".repeat(60));
  console.log(
    `\nTokens: ${post.usage.input_tokens} in / ${post.usage.output_tokens} out`,
  );

  // Video posts carry the same written post as their commentary, plus a
  // rendered explainer of the same theory. The video is built even on a dry run
  // so you can watch it before committing to publish.
  let video = null;
  if (asVideo) {
    console.log("\nAdapting it into a video script...");
    const script = await generateVideoScript(theory, post.text);

    console.log("\nStoryboard:");
    for (const [i, frame] of script.frames.entries()) {
      const label = `${String(i + 1).padStart(2)}. [${frame.kind}]`.padEnd(18);
      console.log(`${label}${frame.text.replace(/\n/g, " / ")}`);
    }

    console.log("\nRendering with ffmpeg...");
    const rendered = await renderVideo(script.frames, defaultOutPath(theory.name));
    console.log(
      `Rendered ${rendered.path} ` +
        `(${rendered.frames} frames, ${rendered.seconds.toFixed(1)}s)`,
    );
    video = { ...rendered, frames: script.frames };
  }

  if (!args.post) {
    console.log("\nDry run — not published. Re-run with --post to publish.");
    return;
  }

  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  if (!token) throw new Error("LINKEDIN_ACCESS_TOKEN is not set.");

  const authorUrn = await resolveAuthorUrn(token);

  // A video has to be uploaded and fully processed before it can be attached.
  let media = null;
  if (video) {
    const bytes = await readFile(video.path);
    const videoUrn = await uploadVideo(token, authorUrn, bytes, (m) =>
      console.log(m),
    );
    media = { id: videoUrn, title: theory.name };
  }

  console.log(`\nPublishing as ${authorUrn}...`);
  const postUrn = await publishPost(token, authorUrn, post.commentary, media);
  console.log(`Published: ${postUrn}`);

  await appendHistory({
    postedAt: new Date().toISOString(),
    type: asVideo ? "video" : "theory",
    theory: theory.name,
    category: theory.category,
    text: post.text,
    hashtags: post.hashtags,
    urn: postUrn,
    ...(media
      ? {
          videoUrn: media.id,
          videoSeconds: Number(video.seconds.toFixed(1)),
          videoFrames: video.frames.length,
        }
      : {}),
  });
  console.log("Logged to data/history.json.");
}

main().catch((err) => {
  console.error("\nError:", err.message);
  process.exit(1);
});
