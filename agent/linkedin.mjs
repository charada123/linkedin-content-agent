// LinkedIn publishing via the versioned Posts API.
//
// Requires an OAuth access token with the `w_member_social` scope (and
// `openid`/`profile` if you want the agent to resolve your author URN
// automatically). See README.md for how to obtain one.

import { config } from "./config.mjs";

const API_BASE = "https://api.linkedin.com";

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "X-Restli-Protocol-Version": "2.0.0",
    "LinkedIn-Version": config.linkedinApiVersion,
    "Content-Type": "application/json",
  };
}

// Resolve the posting identity. If LINKEDIN_AUTHOR_URN is set we trust it;
// otherwise we look the member up via the OpenID userinfo endpoint.
export async function resolveAuthorUrn(token) {
  if (process.env.LINKEDIN_AUTHOR_URN) return process.env.LINKEDIN_AUTHOR_URN;

  const res = await fetch(`${API_BASE}/v2/userinfo`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Could not resolve author URN via /v2/userinfo (${res.status}). ` +
        `Set LINKEDIN_AUTHOR_URN explicitly, or grant the openid/profile ` +
        `scopes. Response: ${body}`,
    );
  }
  const { sub } = await res.json();
  return `urn:li:person:${sub}`;
}

// Publish a post. Returns the created post's URN.
//
// `media` is optional: pass { id, title } to attach an already-uploaded video
// (see uploadVideo below). Omit it for a plain text post.
export async function publishPost(token, authorUrn, commentary, media = null) {
  const payload = {
    author: authorUrn,
    commentary,
    visibility: config.visibility,
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };

  if (media) {
    payload.content = { media: { id: media.id, title: media.title } };
  }

  const res = await fetch(`${API_BASE}/rest/posts`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LinkedIn post failed (${res.status}): ${body}`);
  }

  // LinkedIn returns the new post URN in the x-restli-id / x-linkedin-id header.
  return (
    res.headers.get("x-restli-id") ||
    res.headers.get("x-linkedin-id") ||
    "(unknown urn)"
  );
}

// Delete a post you authored, by its URN (e.g. urn:li:share:123...).
export async function deletePost(token, postUrn) {
  const res = await fetch(
    `${API_BASE}/rest/posts/${encodeURIComponent(postUrn)}`,
    { method: "DELETE", headers: authHeaders(token) },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LinkedIn delete failed (${res.status}): ${body}`);
  }
  return true;
}

// Add a comment to a post (e.g. a source link in the first comment, which
// tends to get better reach than an outbound link in the post body).
export async function commentOnPost(token, authorUrn, postUrn, text) {
  const res = await fetch(
    `${API_BASE}/rest/socialActions/${encodeURIComponent(postUrn)}/comments`,
    {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        actor: authorUrn,
        object: postUrn,
        message: { text },
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LinkedIn comment failed (${res.status}): ${body}`);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Video upload
// ---------------------------------------------------------------------------
//
// Video is a four-step dance, quite unlike a text post:
//   1. initializeUpload  -> LinkedIn hands back a video URN and one upload URL
//                           per chunk of the file.
//   2. PUT each chunk    -> every response carries an ETag we have to keep.
//   3. finalizeUpload    -> hand back the ETags, in order, to assemble the file.
//   4. poll the video    -> LinkedIn transcodes asynchronously; the post will be
//                           rejected if we attach the video before it is ready.
// Only then can the video URN be attached to a post.

const UPLOAD_STATUS_POLL_MS = 5000;
const UPLOAD_STATUS_MAX_ATTEMPTS = 60; // ~5 minutes

async function initializeUpload(token, ownerUrn, fileSizeBytes) {
  const res = await fetch(`${API_BASE}/rest/videos?action=initializeUpload`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      initializeUploadRequest: {
        owner: ownerUrn,
        fileSizeBytes,
        uploadCaptions: false,
        uploadThumbnail: false,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LinkedIn initializeUpload failed (${res.status}): ${body}`);
  }

  const { value } = await res.json();
  if (!value?.video || !value?.uploadInstructions?.length) {
    throw new Error(
      `LinkedIn initializeUpload returned no upload instructions: ${JSON.stringify(value)}`,
    );
  }
  return value;
}

// Upload one byte range and return its ETag. LinkedIn rejects the finalize call
// if any part id is missing or out of order, so this throws loudly rather than
// returning something empty.
async function uploadPart(token, instruction, buffer, index) {
  const chunk = buffer.subarray(instruction.firstByte, instruction.lastByte + 1);

  const res = await fetch(instruction.uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
    },
    body: chunk,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LinkedIn chunk ${index} upload failed (${res.status}): ${body}`);
  }

  const etag = res.headers.get("etag");
  if (!etag) {
    throw new Error(
      `LinkedIn chunk ${index} upload returned no ETag header, so the upload ` +
        "cannot be finalized.",
    );
  }
  // Some edges quote the ETag; LinkedIn wants the bare value back.
  return etag.replace(/^"|"$/g, "");
}

async function finalizeUpload(token, videoUrn, uploadToken, uploadedPartIds) {
  const res = await fetch(`${API_BASE}/rest/videos?action=finalizeUpload`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      finalizeUploadRequest: {
        video: videoUrn,
        uploadToken: uploadToken || "",
        uploadedPartIds,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LinkedIn finalizeUpload failed (${res.status}): ${body}`);
  }
}

// Poll until LinkedIn has finished transcoding. Attaching a video that is still
// PROCESSING produces a post with a broken player, so this is not optional.
async function waitForVideo(token, videoUrn, onTick = () => {}) {
  for (let attempt = 1; attempt <= UPLOAD_STATUS_MAX_ATTEMPTS; attempt++) {
    const res = await fetch(
      `${API_BASE}/rest/videos/${encodeURIComponent(videoUrn)}`,
      { headers: authHeaders(token) },
    );

    if (res.ok) {
      const { status } = await res.json();
      if (status === "AVAILABLE") return status;
      if (status === "PROCESSING_FAILED") {
        throw new Error(`LinkedIn failed to process the video (${videoUrn}).`);
      }
      onTick(status, attempt);
    }

    await new Promise((r) => setTimeout(r, UPLOAD_STATUS_POLL_MS));
  }

  throw new Error(
    `Video ${videoUrn} was still not AVAILABLE after ` +
      `${(UPLOAD_STATUS_POLL_MS * UPLOAD_STATUS_MAX_ATTEMPTS) / 1000}s.`,
  );
}

/**
 * Upload a local video file and return its URN, ready to attach to a post.
 *
 * @param {string} token       LinkedIn access token
 * @param {string} ownerUrn    the posting identity (same URN used as author)
 * @param {Buffer} buffer      the video file's bytes
 * @param {(msg: string) => void} log  progress reporter
 */
export async function uploadVideo(token, ownerUrn, buffer, log = () => {}) {
  const init = await initializeUpload(token, ownerUrn, buffer.length);
  const parts = init.uploadInstructions;
  log(`Uploading ${(buffer.length / 1024 / 1024).toFixed(2)} MB in ${parts.length} part(s)...`);

  // Sequential on purpose: the part ids must line up with the instruction order,
  // and these files are small enough that parallelism buys nothing.
  const uploadedPartIds = [];
  for (const [index, instruction] of parts.entries()) {
    uploadedPartIds.push(await uploadPart(token, instruction, buffer, index));
  }

  await finalizeUpload(token, init.video, init.uploadToken, uploadedPartIds);
  log("Upload finalized. Waiting for LinkedIn to process the video...");

  await waitForVideo(token, init.video, (status, attempt) => {
    if (attempt === 1 || attempt % 6 === 0) log(`  status: ${status}`);
  });
  log("Video is AVAILABLE.");

  return init.video;
}
