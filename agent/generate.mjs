// Post generation via the Claude API.
//
// Given a theory and the recent post history, ask Claude for one original
// LinkedIn post that names and defines the theory, applies it to the author's
// industry, and lands a motivating takeaway — in the author's voice.
// Structured output gives us a clean object (text + hashtags).

import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.mjs";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

const POST_SCHEMA = {
  type: "object",
  properties: {
    text: {
      type: "string",
      description:
        "The LinkedIn post body, ready to publish verbatim. Starts with a " +
        "titled headline line. Does NOT include hashtags.",
    },
    hashtags: {
      type: "array",
      items: { type: "string" },
      description:
        "10-14 hashtags, each including the leading #, in PascalCase " +
        "(e.g. #ServiceExcellence). Mix the concept name, the industry, and " +
        "recurring themes.",
    },
  },
  required: ["text", "hashtags"],
  additionalProperties: false,
};

function buildPrompt(theory, recentPosts) {
  const avoid = recentPosts.length
    ? "You have recently posted the following. Do NOT repeat these headlines, " +
      "openings, examples, or closes — say something genuinely new:\n\n" +
      recentPosts
        .map((p, i) => `${i + 1}. [${p.theory || p.topic}] ${p.text}`)
        .join("\n\n")
    : "This is your first post in this run — set a strong, motivating tone.";

  return [
    `Write one LinkedIn post built around this concept:`,
    `**${theory.name}** (${theory.category}).`,
    theory.angle ? `Angle to take: ${theory.angle}` : "",
    "",
    "Name and define it plainly, then apply it to your industry (medical",
    "device / medical aesthetics / high-touch service, field service, customer",
    "experience, retention, service and operational excellence). Turn it into a",
    "motivating, practical lesson a service or field leader can act on.",
    "",
    "Follow your standard post structure:",
    "- Titled headline first line.",
    "- Industry-framed hook that raises a tension or question.",
    "- One line naming and defining the concept: 'This is the ... — ...'.",
    "- Concrete examples as '•' bullets, or parallel 'If X? Then Y.' lines,",
    "  set in real service/field situations.",
    "- A contrast (the opposite is true too), then a few stacked one-liners.",
    "- A 'What if ...' line that raises the reader's ambition.",
    "- A two-line motivating parallel close.",
    "- A closing engagement question, usually to 'your team'.",
    "",
    `Around ${config.targetWords} words. Plain text only: no markdown, no bold,`,
    "no headers. Do NOT put hashtags in the body; return them separately.",
    "Do NOT use em dashes or en dashes anywhere. Avoid AI-sounding filler.",
    "",
    avoid,
  ].join("\n");
}

// Belt-and-suspenders: strip any em/en/bar/figure dashes the model produced,
// replacing them with natural punctuation. Plain hyphens (compound words) are
// left untouched.
function stripDashes(text) {
  return text
    .replace(/\s*[—–―‒]\s*/g, ", ") // dash (spaced or not) -> comma
    .replace(/\s+,/g, ",") // tidy " ," -> ","
    .replace(/,\s*,/g, ",") // collapse ", ,"
    .replace(/,\s*([.!?])/g, "$1") // ", ." -> "."
    .replace(/[ \t]{2,}/g, " "); // collapse runs of spaces
}

export async function generatePost(theory, recentPosts = []) {
  const response = await client.messages.create({
    model: config.model,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: `${config.domain}\n\n${config.voice}`,
    output_config: { format: { type: "json_schema", schema: POST_SCHEMA } },
    messages: [{ role: "user", content: buildPrompt(theory, recentPosts) }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to generate this post (safety refusal).");
  }

  const block = response.content.find((b) => b.type === "text");
  if (!block) throw new Error("No text returned from Claude.");

  const parsed = JSON.parse(block.text);
  const text = stripDashes(parsed.text);
  const hashtags = (parsed.hashtags || []).join(" ").trim();

  // Compose the final published text: body, a blank line, then hashtags.
  const commentary = hashtags ? `${text}\n\n${hashtags}` : text;

  return {
    text,
    hashtags: parsed.hashtags || [],
    commentary,
    usage: response.usage,
  };
}

// ---------------------------------------------------------------------------
// Video scripts
// ---------------------------------------------------------------------------

// A frame is a stack of blocks rather than one lump of text, which is what lets
// a beat read as a designed layout: a statement, a qualifier, a punchline, each
// at its own weight. These names map 1:1 onto the typography in video.mjs.
const BLOCK_TYPES = [
  "headline", // the big statement, 1 to 3 lines
  "body",     // supporting line underneath, quieter
  "kicker",   // a short punchline, set bold and small
  "stat",     // a large numeral with a label above and a unit beside it
  "rule",     // a hairline divider between two stats
];

const VIDEO_SCHEMA = {
  type: "object",
  properties: {
    frames: {
      type: "array",
      minItems: 6,
      maxItems: 10,
      description: "The video's beats, in order.",
      items: {
        type: "object",
        properties: {
          blocks: {
            type: "array",
            minItems: 1,
            maxItems: 5,
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: BLOCK_TYPES },
                text: {
                  type: "string",
                  description:
                    "For headline/body/kicker. Wrap words in *asterisks* to set " +
                    "them in the accent colour. A '\\n' forces a line break.",
                },
                label: { type: "string", description: "stat only: the small line above the numeral." },
                value: { type: "string", description: "stat only: the numeral itself, e.g. '4'." },
                unit: { type: "string", description: "stat only: the words beside the numeral." },
                accent: {
                  type: "boolean",
                  description: "stat only: true makes the numeral gold, false greys it out.",
                },
              },
              required: ["type"],
              additionalProperties: false,
            },
          },
        },
        required: ["blocks"],
        additionalProperties: false,
      },
    },
  },
  required: ["frames"],
  additionalProperties: false,
};

function buildVideoPrompt(theory, postText) {
  return [
    "Below is a LinkedIn post you just wrote. Adapt it into a short silent",
    "explainer video that teaches the same concept.",
    "",
    "The video autoplays with the sound off, so every word has to be ON SCREEN",
    "and readable at a glance while someone scrolls. This is not a transcript:",
    "compress the post to its teaching spine and cut everything else.",
    "",
    "Each frame is a stack of blocks:",
    '  headline  the big statement. 1 to 3 lines, under 12 words.',
    '  body      a quieter supporting line under the headline.',
    '  kicker    a short bold punchline, under 6 words.',
    '  stat      a big numeral: needs label, value, unit, and accent.',
    '  rule      a hairline divider, only ever between two stats.',
    "",
    "Most frames are a headline alone, or a headline plus a body. Use a kicker",
    "only when a beat genuinely lands on a punchline.",
    "",
    "Put *asterisks* around the one or two words a sentence turns on. They render",
    "in gold. Do not mark up more than a few words per frame, and never a whole",
    "line, or the emphasis stops meaning anything.",
    "",
    "Structure the video like this:",
    `  1. Open on a headline naming the concept: ${theory.name}.`,
    "  2. A frame that states the tension in the field.",
    "  3. A frame defining the concept in plain terms.",
    "  4. Two or three frames, each ONE concrete medical device / aesthetics",
    "     example. One idea per frame, never a list.",
    "  5. Optionally one frame for the reverse case.",
    "  6. A frame with the two-line parallel close, as a headline using \\n.",
    "  7. A final frame with the engagement question.",
    "",
    "If, and only if, the post contains a genuine contrast of two numbers, you",
    "may use one frame of two stat blocks separated by a rule, with the first",
    "stat accent true and the second accent false. Never invent numbers to fill",
    "this. Most theories have none, and that is fine: skip it.",
    "",
    "Keep every line short. A headline over about 12 words shrinks until it is",
    "unreadable on a phone. No hashtags, no markdown besides the asterisks, no",
    "bullet characters, no emoji, no em dashes or en dashes.",
    "",
    "The post to adapt:",
    "",
    postText,
  ].join("\n");
}

// Turn a finished post into a beat-by-beat video script. Returns frames ready
// to hand to renderVideo().
export async function generateVideoScript(theory, postText) {
  const response = await client.messages.create({
    model: config.model,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    system: `${config.domain}\n\n${config.voice}`,
    output_config: { format: { type: "json_schema", schema: VIDEO_SCHEMA } },
    messages: [{ role: "user", content: buildVideoPrompt(theory, postText) }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to generate this video script (safety refusal).");
  }

  const block = response.content.find((b) => b.type === "text");
  if (!block) throw new Error("No video script returned from Claude.");

  const parsed = JSON.parse(block.text);

  // Strip dashes from every piece of copy, and drop blocks the model left empty
  // (a headline with no text would render as a silent gap).
  const clean = (t) => stripDashes(String(t || "")).trim();
  const frames = (parsed.frames || [])
    .map((f) => ({
      blocks: (f.blocks || [])
        .map((b) => {
          if (b.type === "rule") return { type: "rule" };
          if (b.type === "stat") {
            return {
              type: "stat",
              label: clean(b.label),
              value: clean(b.value),
              unit: clean(b.unit),
              accent: b.accent !== false,
            };
          }
          return { type: b.type, text: clean(b.text) };
        })
        .filter((b) => b.type === "rule" || b.text || b.value),
    }))
    .filter((f) => f.blocks.length);

  if (!frames.length) throw new Error("Video script came back empty.");

  return { frames, usage: response.usage };
}
