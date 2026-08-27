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
post generated -> Claude distills it into on-screen beats -> ffmpeg renders
an MP4 -> LinkedIn video upload -> post published with the video attached
```

The video is deliberately silent and text-driven, because LinkedIn autoplays
muted: anything that matters has to be readable on screen. Each beat is a
`title`, `hook`, `definition`, `bullet`, `contrast`, `closer` or `cta`, and each
maps to its own typography in `video.mjs`. A run takes roughly 6 seconds to
render on a GitHub runner.

Cadence is counted over theory posts only, so **adding video does not disturb
the ad rhythm**. With the defaults (an ad every 3rd post, a video every 3rd
theory post) four weeks of weekdays look like:

```
text  text  ad  VIDEO  text  ad  text  VIDEO  ad  text ...
```

which works out to about one video a week.

| Setting | Default | What it does |
| --- | --- | --- |
| `THEORIES_PER_VIDEO` | `3` | Every Nth theory post becomes a video |
| `VIDEO_BASELINE_THEORIES` | `14` | Theory posts made before video existed, so the counter starts from now |
| `VIDEO_BG` / `VIDEO_FG` / `VIDEO_ACCENT` | navy / near-white / gold | Palette, as bare hex |
| `VIDEO_WIDTH` / `VIDEO_HEIGHT` | `1080` | Canvas size (square by default) |
| `VIDEO_FONT` / `VIDEO_FONT_BOLD` | DejaVu, then Liberation | Font override |

Rendering needs **ffmpeg** on `PATH` (`apt-get install ffmpeg fonts-dejavu-core`,
or `brew install ffmpeg`). The workflow installs it on every run. Rendered files
land in `agent/out/`, which is git-ignored: the MP4 is an artifact of the run,
not something the repo keeps.

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
