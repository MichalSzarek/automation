# Design — AI News Brief → GCS + #ai-news (end-to-end on GCP)

**Date:** 2026-06-21
**Repo:** `automation` (this repo) · **Branch:** `feat/gcp-audio-brief-slack`
**Workflow:** `Personal Audio Brief - Generator + RSS Feed` (n8n id `JdKu1ZzS1SFZ6Ysa`)
**Supersedes delivery half of:** [`n8n-brief-audio-spec.md`](../../../n8n-brief-audio-spec.md) (ingest/filter/summarize/script stages are retained)

---

## 1. Context & current state

The workflow already exists on the **production VM n8n** (`maths-vm`, project `data-concept-studio`,
zone `europe-west1-c`), reached over an **IAP tunnel**: `localhost:15678 → maths-vm:5678`
(`gcloud compute start-iap-tunnel maths-vm 5678 --local-host-port=127.0.0.1:15678`). The n8n MCP that
`../maths/.mcp.json` configures points at that tunnel, so the same MCP edits the VM n8n directly.

The workflow is **inactive** and **wired for local dev**, not GCP:

- GCP auth via a **local token broker** `http://host.docker.internal:9999/token` (the dev box).
- TTS via **ElevenLabs** (`eleven_multilingual_v2`), output mp3.
- Storage via an **S3** node (`publicRead`) to an S3-compatible bucket.
- Delivery via a **private RSS podcast feed** (webhook `audio-brief/feed`, token-gated).

The JSON in `workflows/personal-audio-brief.json` is **generated** by
[`scripts/build-workflows.mjs`](../../../scripts/build-workflows.mjs) from `snippets/code/*.js` (Code-node
bodies) + inline structural nodes. **Source of truth = the build script + snippets + `.env.example`**, not
the hand-edited JSON. `npm run build:workflows` regenerates the JSON; `npm test`
(`scripts/validate-workflows.mjs`) checks shape + required files.

The ingest / filter / enrich / summarize / script stages work and are **kept**. Only auth, TTS, storage,
and delivery change.

## 2. Goal

Make the brief run **end-to-end autonomously on GCP** and deliver to Slack:

1. Runs on the VM n8n on the weekly schedule with **no dependency on the dev laptop** (no local token broker).
2. Produces the spoken Polish brief as audio in **Google Cloud Storage**.
3. Posts a **headline digest + a link to the audio** to Slack **`#ai-news` (`C0BCWHAHJRW`)**.
   The audio file itself is **not** uploaded to Slack — only the link.

## 3. Locked decisions

| Decision | Choice |
|---|---|
| Deploy target | **Existing VM n8n** (already hosts the workflow via the IAP tunnel) |
| TTS engine | **Google Cloud Text-to-Speech — Long Audio** (`synthesizeLongAudio`), writes **directly to GCS** |
| Audio format | **LINEAR16 WAV** (Long Audio does not emit mp3; acceptable for a link, no ffmpeg) |
| Slack content | **Headline digest** (date header + one line per selected item) **+ audio link** |
| RSS feed | **Dropped** (Slack is the only delivery path) |
| Cadence | **Weekly**, Mon 07:00 Europe/Warsaw (unchanged) |
| Audio link | **V4 signed URL, 7-day TTL** (private bucket) |
| YouTube channels | **Pre-resolved to `UC…` channel IDs** at setup (removes the runtime handle-resolve fetch) |
| GCP auth | **GCE metadata service** (no stored key, no broker) |

## 4. Target architecture (VM n8n, weekly)

```
Weekly schedule (Mon 07:00 Warsaw)
  → Init state                       (static-data lastRun / pendingRun)
  → Build source URLs                (pure JS — YT UC feeds + HN Algolia query URLs)
  → Split Out → HTTP Request → Aggregate → Parse + dedupe candidates
  → Build filter input
  → Metadata token → Vertex Gemini Flash (filter) → Parse selected
  → Split Out (HN only) → HTTP Request (article text) → Merge → Enrich
  → Build summary input → token → Gemini Flash (summarize) → Parse summaries
  → Build script input  → token → Gemini Pro   (PL script + show_notes) → Parse script
  → Build LongAudio request → token → TTS synthesizeLongAudio (LRO)
  → Poll operation (Wait + operations.get loop) until done   [WAV now in GCS]
  → Build V4 string-to-sign (pure-JS SHA256) → IAM signBlob → Assemble signed URL
  → Build Slack digest → Slack post #ai-news
  → Commit state                     (lastRun + seenIds)
```

**Removed nodes:** `Chunk script`, `ElevenLabs TTS`, `Upload audio to S3`, `Register episode` (RSS half),
`Feed webhook`, `Build RSS`, `Respond RSS`.

## 5. Component details

### 5.1 Auth — metadata service
Replace the token node URL + add a header. Default becomes:
```
GET http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token
Header: Metadata-Flavor: Google
```
Response shape is unchanged (`{access_token, expires_in, token_type}`), so every downstream
`Bearer {{$node["…"].json.access_token}}` reference keeps working. URL stays env-overridable
(`GCP_TOKEN_URL`) so local dev can still point at the broker.

### 5.2 Ingest / enrich — sandbox-safe HTTP (conditional refactor)
**Risk (verify first):** the VM n8n Code-node sandbox may not expose `$helpers.httpRequest`
(prior experience: `$helpers is not defined`). The current `ingest-candidates.js` and `enrich-selected.js`
make network calls **inside Code nodes**.

- **Verification (impl step #1):** run a one-node `$helpers.httpRequest` probe on the VM n8n. If it works,
  keep the Code-node fetches and skip the refactor.
- **If unavailable (assumed):** move network calls into **HTTP Request nodes**:
  - *Ingest:* `Build source URLs` (pure JS, emits one item per YT feed + HN query URL) → **Split Out** →
    **HTTP Request** → **Aggregate** → `Parse + dedupe candidates` (pure-JS XML/JSON parse, no network).
  - *Enrich:* **Split Out** the selected HN items → **HTTP Request** (article HTML) → **Merge** back →
    `Enrich` strips HTML (pure JS). YouTube items keep the existing placeholder text (no fetch).
- YouTube handles are pre-resolved to `UC…` IDs in `YT_CHANNEL_IDS`, so no runtime resolve fetch.

### 5.3 TTS — Google Cloud Long Audio → GCS
`Build LongAudio request` (pure JS) builds:
```jsonc
{
  "input":  { "text": "<script>" },
  "voice":  { "languageCode": "pl-PL", "name": "<pl-PL voice>" },
  "audioConfig": { "audioEncoding": "LINEAR16" },
  "outputGcsUri": "gs://<STORAGE_BUCKET>/brief_<ts>.wav"
}
```
`POST https://texttospeech.googleapis.com/v1/projects/<project>/locations/<loc>:synthesizeLongAudio`
returns an **LRO** (`operations/…`). A **poll loop** (`operations.get` + `Wait`, ~15 s, bounded
iterations) waits for `done:true`. Long Audio writes the WAV straight to the bucket — **no upload node**.
Voice name + the exact regional endpoint/location are confirmed against current GCP docs at implementation
time (Long Audio is region-scoped, e.g. `us`/`eu`; the voice must be one Long Audio supports).

### 5.4 Signed URL — V4 via IAM signBlob (no stored key)
Most intricate node group. Keeps the no-stored-key philosophy:
1. `Build V4 string-to-sign` (pure JS, **vendored SHA256** — the sandbox has no `crypto`) — builds the V4
   canonical request for a `GET` on the object with `X-Goog-Expires` (≤ 604800 s = 7 days),
   `host = storage.googleapis.com`, payload hash `UNSIGNED-PAYLOAD`; produces the base64 string-to-sign.
2. **HTTP Request** → `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/<SIGNER_SA>:signBlob`
   (`Bearer` metadata token) → returns the RSA-SHA256 signature.
3. `Assemble signed URL` (pure JS) → hex-encodes the signature and appends `&X-Goog-Signature=…` to the
   canonical URL.

*Escape hatch:* if signing proves brittle in the sandbox, flipping to a **public-read object + plain
`https://storage.googleapis.com/<bucket>/<obj>` link** is a one-node change. We build **signed** as chosen;
this is documented only as a fallback.

### 5.5 Slack delivery
New **Slack** node (`message → post`) to `#ai-news` (`C0BCWHAHJRW`) using the existing
**"MATHS Slack Bot"** credential on the VM n8n. `Build Slack digest` (pure JS) composes:
- Header: `🧠 AI Brief — <YYYY-MM-DD>`
- One bullet per selected item: `• <title> — <one-line point>` (from `summaries` / `show_notes`)
- Footer: `🎧 <signed audio URL>`

Uses Slack `blocks`/`mrkdwn` (links not unfurled into the audio file). Bot must be a member of `#ai-news`.

### 5.6 State
`Commit state` keeps `lastRun` (committed **after** Slack success) + `seenIds` dedupe (last 2000).
`Register episode` is removed (it only fed the dropped RSS feed). No episode list is needed.

## 6. Source-of-truth changes (in this repo)

- **`scripts/build-workflows.mjs`** — metadata token node; remove ElevenLabs/S3/RSS/`Chunk script`/`Register
  episode`; add ingest Split Out + HTTP + Aggregate, enrich Split Out + HTTP + Merge, Long Audio + poll loop,
  signed-URL group, Slack node; update `mainChainNames` + connections.
- **`snippets/code/`** — new/updated: `build-source-urls.js`, `parse-candidates.js` (split from
  `ingest-candidates.js`), `enrich-selected.js` (HTTP-node form), `build-longaudio-request.js`,
  `build-signed-url.js` (+ vendored SHA256), `assemble-signed-url.js`, `build-slack-digest.js`,
  `commit-state.js` (drop episode coupling). Remove `chunk-script.js`, `register-episode.js`, `build-rss.js`.
- **`.env.example`** — remove ElevenLabs/S3/RSS/`STORAGE_PUBLIC_BASE`/`FEED_*`; add `GCP_TOKEN_URL`
  (metadata default), `STORAGE_BUCKET`, `AUDIO_BRIEF_SIGNER_SA`, `TTS_LOCATION`, `TTS_VOICE`,
  `SIGNED_URL_TTL_SECONDS`, `SLACK_CHANNEL_ID=C0BCWHAHJRW`; convert `YT_CHANNEL_IDS` to `UC…` IDs.
- **`scripts/validate-workflows.mjs`** — update required-files list + remove RSS/ElevenLabs assertions; add
  checks for Slack node + bucket env.
- **`README.md`, `docs/live-n8n.md`** — reflect GCP/Slack flow; drop RSS URL + yt-dlp/ffmpeg image deps
  (no longer needed at runtime). VM n8n container image is **not** modified by this work.

## 7. Infra prerequisites (one-time, `data-concept-studio`) — execution gated

Listed for the plan; **not auto-applied**. Proposed via `gcloud` for speed, with a `maths-iac` follow-up note.
- Create bucket **`gs://dcs-ai-news-briefs`** (uniform bucket-level access, private, region `europe-west1`).
- Enable **Text-to-Speech API**; confirm **Vertex AI** enabled.
- Grant the VM service account: `roles/aiplatform.user` (Gemini), TTS caller
  (`roles/cloudtts.user` / `texttospeech.longaudiosynthesize`), `roles/storage.objectAdmin` on the bucket,
  and **`roles/iam.serviceAccountTokenCreator` on itself** (signBlob). Ensure the **TTS service agent** has
  object-create on the bucket.
- Set the new env vars on the VM n8n runtime (compose `.env` on `maths-vm`).

## 8. Risks & verifications

1. **`$helpers` in Code nodes (highest):** verify on the VM n8n before building; design assumes refactor.
2. **Long Audio region/voice:** confirm endpoint location + a supported `pl-PL` voice at build.
3. **V4 signing in sandbox:** vendored SHA256 + signBlob; public-read fallback documented.
4. **Metadata token scope:** the VM SA token must carry `cloud-platform` scope for Vertex/TTS/IAM —
   verify the SA's roles/scopes.
5. **`lastRun` safety:** committed only after Slack success, so a failed run re-processes the window.
6. **Manual smoke run:** one HN + one YouTube item end-to-end → WAV in GCS + Slack post, before activation.

## 9. Out of scope

- mp3 transcoding / multi-part audio concat (WAV accepted; no ffmpeg).
- RSS / podcast-app subscription.
- Modifying the VM n8n container image or the trading workflows.
- Codifying infra in `maths-iac` (noted as a follow-up; `gcloud` for now).

## 10. Acceptance criteria

- VM n8n runs the workflow on schedule with **no** dependency on the dev laptop / local token broker.
- A run produces a `brief_<ts>.wav` in `gs://dcs-ai-news-briefs`.
- `#ai-news` receives a headline digest + a working **7-day signed link** to that WAV; the audio file is not
  uploaded to Slack.
- `npm run build:workflows` + `npm test` pass; the regenerated JSON is what's deployed to the VM n8n.
- Workflow is left **inactive** until the manual smoke run passes; activation is a final, explicit step.
