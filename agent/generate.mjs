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

// The beats an explainer video is allowed to use. These map 1:1 onto the
// typography in video.mjs, so the model is really choosing a layout per beat.
const FRAME_KINDS = [
  "title",      // the concept name, on its own
  "hook",       // the tension that makes it matter
  "definition", // the concept in plain terms
  "bullet",     // one concrete example from the field
  "contrast",   // the reverse case
  "closer",     // the two-line parallel payoff
  "cta",        // the closing question
];

const VIDEO_SCHEMA = {
  type: "object",
  properties: {
    frames: {
      type: "array",
      minItems: 6,
      maxItems: 10,
      description:
        "The video's beats, in order. Must open with a 'title' frame and end " +
        "with a 'cta' frame.",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: FRAME_KINDS },
          text: {
            type: "string",
            description:
              "The words on screen for this beat. Plain text. A single '\\n' " +
              "may be used in a 'closer' to split the two parallel lines.",
          },
        },
        required: ["kind", "text"],
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
    "compress the post down to its teaching spine and cut everything else.",
    "",
    "Rules:",
    `- Open with a "title" frame containing ONLY the concept name: ${theory.name}.`,
    '- Follow with a "hook" that states the tension in one short sentence.',
    '- Give one "definition" frame that defines the concept in plain terms.',
    '- Then 2 to 4 "bullet" frames, each ONE concrete medical device /',
    "  aesthetics field example. One idea per frame, never a list.",
    '- Optionally one "contrast" frame for the reverse case.',
    '- A "closer" frame with the two-line parallel payoff, the two lines',
    "  separated by a single newline.",
    '- End with a "cta" frame: the engagement question.',
    "",
    "Length is the hard part. Aim for 8 words per frame and never exceed about",
    "16, because long frames shrink the type until it is unreadable on a phone.",
    "Short, punchy, declarative lines. No hashtags, no markdown, no bullet",
    "characters (the video draws its own), no emoji, no em dashes or en dashes.",
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
  const frames = (parsed.frames || [])
    .map((f) => ({ kind: f.kind, text: stripDashes(f.text || "").trim() }))
    .filter((f) => f.text);

  if (!frames.length) throw new Error("Video script came back empty.");

  return { frames, usage: response.usage };
}
