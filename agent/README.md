# LinkedIn Content Agent

Generates original, **motivational** LinkedIn posts grounded in real
management, motivation, leadership, strategy, marketing, and finance **theories**
(70 of them) with the Claude API, and auto-publishes them on a schedule.

Each post teaches one real theory — Maslow's Hierarchy, Blue Ocean Strategy,
Servant Leadership, Prospect Theory, and so on — and turns it into a practical,
motivating takeaway.

- **Writes** each post fresh with Claude (Opus 5) in a voice you control.
- **Rotates** through the theory library and reads its own post history so it
  never repeats itself.
- **Publishes** to LinkedIn via the official Posts API.
- **Runs on a schedule** via GitHub Actions (or any cron), or on demand.

## How it works

```
config.mjs     the theory library, voice, length, video + LinkedIn settings
generate.mjs   asks Claude for one motivational post, and for video scripts
video.mjs      renders a video script into an MP4 with ffmpeg
linkedin.mjs   publishes to https://api.linkedin.com/rest/posts (text or video)
history.mjs    logs every post to data/history.json (audit + dedupe context)
post.mjs       ties it together: pick theory -> generate -> publish -> log
```

Each run picks the next theory in rotation, shows Claude the last several posts
so it stays fresh, generates a motivational post that teaches and applies it,
and (with `--post`) publishes it.

## Setup

```bash
cd agent
npm install
cp .env.example .env   # then fill in your keys
```

You need two credentials:

1. **`ANTHROPIC_API_KEY`** — from https://console.anthropic.com/
2. **`LINKEDIN_ACCESS_TOKEN`** — an OAuth 2.0 token with the `w_member_social`
   scope (add `openid` + `profile` if you want the agent to auto-detect your
   author URN). See _Getting a LinkedIn token_ below.

## Usage

```bash
# Dry run — generate and print a post, but DO NOT publish (safe default)
node post.mjs

# Publish for real
node post.mjs --post

# Force a specific theory (case-insensitive substring match)
node post.mjs --theory maslow
node post.mjs --theory "blue ocean" --post

# Force this run to be an explainer video, or force plain text
node post.mjs --video
node post.mjs --no-video --post
```

Note that `--video` on its own still renders the MP4 (into `agent/out/`) without
publishing, so you can watch it before deciding.

The theory library (70 theories across Management, Motivation, Leadership,
Strategy, Marketing, Organization, Entrepreneurship, and Finance) lives in the
`theories` array in `config.mjs` — add, remove, or reorder them there, or edit
the `voice` string to change how the posts sound.

## Explainer videos

Every third theory post goes out as a short silent explainer video instead of
plain text. The written post is unchanged and still becomes the commentary; the
video is an extra layer on top of it.

```
post generated -> Claude adapts it into frames -> ffmpeg renders an MP4
-> LinkedIn video upload -> post published with the video attached
```

The video is silent by design, because LinkedIn autoplays muted: anything that
matters has to be readable on screen.

### The visual language

1:1 square (1080x1080). Desktop LinkedIn renders the feed video player at 1:1,
so anything taller gets pillarboxed with hard black down both sides; a square
fills it exactly. Set `VIDEO_HEIGHT=1350` for 4:5 if you would rather have the
extra mobile feed height and accept the desktop bars. Pure-black ground, Inter set flush left and anchored to the top of
the frame, and a single gold accent used to pick out the words a sentence turns
on. A progress bar runs along the bottom, a LinkedIn watermark sits above it on
every frame, and the brand mark shows on the opening frame.

A frame is a **stack of blocks**, not one lump of centred text, so a beat can
read as a designed layout rather than a slide:

| Block | What it is |
| --- | --- |
| `headline` | The big statement, 1 to 3 lines |
| `body` | A quieter supporting line underneath |
| `kicker` | A short bold punchline |
| `stat` | A large numeral with a `label` above and a `unit` beside it |
| `rule` | A hairline divider, used between two stats |

Wrap words in `*asterisks*` to set them in gold: `bought the *same* platform`.
A `\n` forces a line break and is honoured, which is what keeps a two-line
parallel close on two lines. Type shrinks automatically to hold those breaks
and to cap how deep a block can run.

Accent runs are drawn as separate `drawtext` calls positioned at measured
offsets, so text width has to be exact. `fontmetrics.mjs` reads the advance
widths out of the font file and, because FreeType grid-fits as it rasterises,
confirms them against ffmpeg itself in a single batched measuring pass.

### Cadence

Counted over theory posts only, so **adding video does not disturb the ad
rhythm**. With the defaults (an ad every 3rd post, a video every 3rd theory
post) four weeks of weekdays look like:

```
text  text  ad  VIDEO  text  ad  text  VIDEO  ad  text ...
```

which works out to about one video a week.

| Setting | Default | What it does |
| --- | --- | --- |
| `THEORIES_PER_VIDEO` | `3` | Every Nth theory post becomes a video |
| `VIDEO_BASELINE_THEORIES` | `14` | Theory posts made before video existed, so the counter starts from now |
| `VIDEO_WIDTH` / `VIDEO_HEIGHT` | `1080` / `1080` | Canvas size; `1350` gives 4:5 portrait |
| `VIDEO_BG` / `VIDEO_FG` / `VIDEO_ACCENT` | black / off-white / gold | Palette, as bare hex. The ground is pure black on purpose: it matches the letterbox the feed player pads with, so the padding is invisible |
| `VIDEO_BRAND` | `Harada Insights` | Brand mark on the opening frame |
| `VIDEO_WATERMARK` | `https://www.linkedin.com/in/kenzoharada` | Watermark on every frame; empty disables it |
| `VIDEO_WATERMARK_BADGE` | `true` | Draw the small `in` badge before the watermark |
| `VIDEO_FONT_DISPLAY` / `VIDEO_FONT_REGULAR` | Inter, then DejaVu | Font override |
| `VIDEO_TOP_ANCHOR` | `0.14` | Where the content block starts down the frame |

Rendering needs **ffmpeg** and **Inter** (`apt-get install ffmpeg fonts-inter`,
or `brew install ffmpeg font-inter`). The workflow installs both on every run,
and falls back to DejaVu if Inter is missing. Rendered files land in
`agent/out/`, which is git-ignored: the MP4 is an artifact of the run, not
something the repo keeps.

## Scheduled auto-posting (GitHub Actions)

`.github/workflows/linkedin-post.yml` posts once every weekday at 14:00 UTC.

1. In the repo: **Settings → Secrets and variables → Actions** and add:
   - `ANTHROPIC_API_KEY`
   - `LINKEDIN_ACCESS_TOKEN`
   - `LINKEDIN_AUTHOR_URN` (optional)
2. Adjust the `cron:` line in the workflow to your preferred cadence.
3. Trigger a manual run from the **Actions** tab (with the _dry run_ box ticked
   the first time) to confirm it works.

The manual run also takes a _force video_ box, which makes that run an explainer
video regardless of where the cadence has got to. Ticking _dry run_ always wins,
so you can preview an ad or a video without publishing either.

The workflow commits the updated `data/history.json` after each post so rotation
and dedupe persist across runs.

## Getting a LinkedIn token

1. Create an app at https://www.linkedin.com/developers/apps and request the
   **Share on LinkedIn** (`w_member_social`) and **Sign In with LinkedIn using
   OpenID Connect** products.
2. Run the OAuth 2.0 authorization-code flow with scopes
   `w_member_social openid profile` to obtain an access token.
3. Put the token in `LINKEDIN_ACCESS_TOKEN`.

Member access tokens are relatively short-lived (about 60 days). Refresh it on
that cadence, or use a LinkedIn refresh token to mint new ones.

## Notes

- Posts are published as `PUBLIC` by default — change `LINKEDIN_VISIBILITY` to
  `CONNECTIONS` to restrict.
- Video posts upload in chunks and then wait for LinkedIn to finish transcoding
  before publishing, so a video run takes a couple of minutes longer than a text
  one. Attaching a video before it reports `AVAILABLE` produces a broken player,
  so the wait is not optional.
- Nothing is published without the `--post` flag, so you can always preview
  first.
