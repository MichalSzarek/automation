# AI News Brief → GCS + #ai-news Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `Personal Audio Brief` n8n workflow run end-to-end on the GCP VM n8n — GCP-native auth, Google Cloud TTS Long Audio → GCS, V4 signed link, and a headline digest delivered to Slack `#ai-news`.

**Architecture:** The workflow already lives on the VM n8n (`maths-vm`, reached via the IAP tunnel `localhost:15678 → maths-vm:5678`). The JSON is **generated** by `scripts/build-workflows.mjs` from `snippets/code/*.js` + inline node configs, so all edits land in source and are rebuilt with `npm run build:workflows`. We swap the local token broker for the GCE metadata service, replace ElevenLabs+S3 with Long-Audio-to-GCS, add a V4-signed-URL node group and a Slack node, and remove the RSS branch. Then deploy via the n8n MCP and smoke-test before activating.

**Tech Stack:** n8n 2.46.1 (VM), n8n Code/HTTP Request/Slack nodes, Google Vertex AI (Gemini 2.5 Flash/Pro), Google Cloud Text-to-Speech Long Audio API, Google Cloud Storage, IAM Credentials `signBlob`, GCE metadata service, Node ESM build scripts.

## Global Constraints

- **uv / pip:** N/A (this is the `automation` JS repo, not `maths`).
- **Source of truth:** never hand-edit `workflows/personal-audio-brief.json`; edit `scripts/build-workflows.mjs` + `snippets/code/*.js` then run `npm run build:workflows`. `npm test` (`scripts/validate-workflows.mjs`) must pass.
- **n8n Code-node sandbox:** assume **no `$helpers.httpRequest`** and **no `require()`** unless Task 1 proves otherwise. Network calls go in HTTP Request nodes; crypto is vendored pure-JS unless `require('crypto')` is proven available.
- **GCP project:** `data-concept-studio`. **GCP account for gcloud:** `dataconceptstudio@gmail.com` (verify before any state change). VM: `maths-vm`, zone `europe-west1-c`.
- **No stored keys:** auth is the GCE metadata service; signing is IAM `signBlob`. No service-account JSON in the repo or n8n.
- **Deploy/infra are execution-gated:** do NOT run `gcloud` state-changing commands, set VM env vars, deploy to n8n, or activate the workflow without explicit user go-ahead. Tasks that change live state are marked **[GATED]**.
- **Slack:** channel `#ai-news` = `C0BCWHAHJRW`; use the existing **"MATHS Slack Bot"** credential already on the VM n8n. The audio file is never uploaded to Slack — only the link.
- **Cadence/voice/format:** weekly `0 7 * * 1` Europe/Warsaw; Polish (`pl-PL`); audio is **LINEAR16 WAV** (no mp3/ffmpeg).
- **`lastRun` safety:** committed only after Slack delivery succeeds.
- **Resolved YouTube channel IDs** (use these verbatim in `.env.example`):
  | Handle | UC ID |
  |---|---|
  | @AndrejKarpathy | `UCXUPKJO5MZQN11PqgIvyuvQ` |
  | @3blue1brown | `UCYO_jab_esuFRV4b17AJtAw` |
  | @MachineLearningStreetTalk | `UCMLtBahI5DMrt0NPvDSoIRQ` |
  | @aiexplained-official | `UCNJ1Ymd5yFuUPtn21xtRbbw` |
  | @TwoMinutePapers | `UCbfYPyITQ-7l4upoX8nvctg` |
  | @ColeMedin | `UCMwVTLZIRRUyyVrkjDpn4pA` |
  | @IndyDevDan | `UC_x36zCEGilGpB1m-V4gmjg` |
  | @daveebbelaar | `UCn8ujwUInbJkBhffxqAPBVQ` |
  | @OpenAI | `UCXZCJLdBC09xxGZ6gcdrc6A` |
  | @GoogleDeepMind | `UCP7jMXSY2xbc3KCAE0MHQ-A` |
  | @anthropic-ai | `UCrDwWp7EBBv4NwvScIpBDOA` |
  | @jeremyphoward | resolve in Task 12 (fallback: drop) |
  | @aiengineerfoundation | resolve in Task 12 (fallback: drop) |

## File Map

- `scripts/build-workflows.mjs` — node graph generator (largest change: token node header, ingest/enrich/TTS/signing/Slack nodes, `mainChainNames`, connections, remove ElevenLabs/S3/RSS/chunk/register).
- `snippets/code/build-source-urls.js` — **new** — emit one item per YT feed + HN query URL.
- `snippets/code/parse-candidates.js` — **new** — parse YT XML + HN JSON responses, dedupe, filter by `lastRun`/`seenIds`.
- `snippets/code/enrich-hn.js` — **new** — strip fetched HN HTML → `content`.
- `snippets/code/enrich-yt.js` — **new** — YT placeholder `content`.
- `snippets/code/build-longaudio-request.js` — **new** — Long Audio request body + GCS object name.
- `snippets/code/poll-longaudio.js` — **new** — interpret `operations.get` result (done/error/continue).
- `snippets/code/build-signed-url.js` — **new** — V4 canonical request + string-to-sign (vendored SHA256).
- `snippets/code/assemble-signed-url.js` — **new** — hex(signature) → final signed URL.
- `snippets/code/build-slack-digest.js` — **new** — Slack `blocks` from summaries + signed link.
- `snippets/code/commit-state.js` — **modify** — drop episode coupling; keep `lastRun`+`seenIds`.
- `snippets/code/ingest-candidates.js`, `enrich-selected.js`, `chunk-script.js`, `register-episode.js`, `build-rss.js` — **delete** (logic moved/removed).
- `.env.example` — **modify** — GCP/GCS/TTS/signing/Slack vars; UC IDs; remove ElevenLabs/S3/RSS.
- `scripts/validate-workflows.mjs` — **modify** — required-files list + assertions.
- `README.md`, `docs/live-n8n.md` — **modify** — GCP/Slack flow.

---

## Phase 0 — Verify environment & lock unknowns

### Task 1: Probe the VM n8n Code-node sandbox (`$helpers` + `crypto`)

Decides whether the ingest/enrich refactor (assumed yes) is required and whether signing uses `require('crypto')` or vendored SHA256.

**Files:** none (MCP probe only).

- [ ] **Step 1: Create a throwaway probe workflow via MCP**

Use `n8n_create_workflow` with a single Manual Trigger → Code node whose `jsCode` is:

```javascript
const out = { helpers: false, httpReq: false, crypto: false, buffer: false };
try { out.helpers = typeof $helpers !== 'undefined'; } catch (_) {}
try { out.httpReq = typeof $helpers?.httpRequest === 'function'; } catch (_) {}
try { out.crypto = !!require('crypto').createHash; } catch (_) {}
try { out.buffer = typeof Buffer !== 'undefined'; } catch (_) {}
return [{ json: out }];
```

- [ ] **Step 2: Execute it and read the result**

Run it via `n8n_test_workflow` (or the n8n UI through the tunnel). Record `helpers/httpReq/crypto/buffer`.

- [ ] **Step 3: Decide the two branch points and write them into this plan**

- If `httpReq === true`: ingest/enrich may keep Code-node fetches (Tasks 5–6 "Variant B"). Otherwise use HTTP Request nodes (Variant A, default).
- If `crypto === true`: Task 8 uses `require('crypto')` for the SHA256 hash. Otherwise use the vendored SHA256 (default).
- Note `buffer` (needed in Task 9 for base64→hex). If `false`, Task 9 uses the vendored hex helper.

- [ ] **Step 4: Delete the probe workflow**

`n8n_delete_workflow` on the probe id. No commit (no repo change).

### Task 2: Confirm GCP facts (SA, roles, TTS endpoint/voice/location) — read-only

**Files:** none (read-only `gcloud`/`curl`).

- [ ] **Step 1: Confirm gcloud identity/project**

```bash
gcloud config get-value account   # expect dataconceptstudio@gmail.com
gcloud config get-value project   # expect data-concept-studio
```

- [ ] **Step 2: Get the VM service account email + scopes**

```bash
gcloud compute instances describe maths-vm --zone=europe-west1-c \
  --project=data-concept-studio \
  --format="value(serviceAccounts[0].email, serviceAccounts[0].scopes)"
```
Record the email as `SIGNER_SA`. Confirm scopes include `https://www.googleapis.com/auth/cloud-platform` (required for Vertex/TTS/IAM via the metadata token). If not, note it for Task 3.

- [ ] **Step 3: Check the SA's project roles**

```bash
SA=<SIGNER_SA>
gcloud projects get-iam-policy data-concept-studio \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:${SA}" \
  --format="value(bindings.role)"
```
Record which of these are already present: `roles/aiplatform.user`, a TTS role, `roles/iam.serviceAccountTokenCreator`. (Bucket-level `storage.objectAdmin` is granted on the bucket in Task 3.)

- [ ] **Step 4: Confirm a Long-Audio `pl-PL` voice + endpoint with a live dry call**

```bash
TOKEN=$(gcloud auth print-access-token)
# List pl-PL voices (confirm names like pl-PL-Wavenet-B / pl-PL-Standard-A exist):
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://texttospeech.googleapis.com/v1/voices?languageCode=pl-PL" | python3 -m json.tool | head -40
```
Then validate the Long Audio endpoint shape (this will 403 on bucket perms until Task 3, but confirms the endpoint/region/path are correct — a 400 "bad voice/location" tells us the value is wrong, a 403 on the *bucket* is expected pre-grant):

```bash
curl -s -X POST \
  "https://texttospeech.googleapis.com/v1/projects/data-concept-studio/locations/us:synthesizeLongAudio" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"input":{"text":"test"},"voice":{"languageCode":"pl-PL","name":"pl-PL-Wavenet-B"},"audioConfig":{"audioEncoding":"LINEAR16"},"outputGcsUri":"gs://dcs-ai-news-briefs/_probe.wav"}'
```
Record the working `TTS_LOCATION` (try `us`, then `eu`) and `TTS_VOICE`. If the endpoint must be regional (`https://<loc>-texttospeech.googleapis.com`), record that form for Task 7.

- [ ] **Step 5: Record the locked values** (paste into the Task 3/7/8 placeholders): `SIGNER_SA`, `TTS_LOCATION`, `TTS_VOICE`, regional-endpoint-needed (y/n), missing IAM roles.

### Task 3: **[GATED]** Provision GCS bucket + IAM grants

Run only after explicit user go-ahead. Uses values from Task 2.

**Files:** none (live `gcloud`).

- [ ] **Step 1: Create the private bucket**

```bash
gcloud storage buckets create gs://dcs-ai-news-briefs \
  --project=data-concept-studio --location=europe-west1 \
  --uniform-bucket-level-access --public-access-prevention
```

- [ ] **Step 2: Grant the VM SA object admin on the bucket**

```bash
SA=<SIGNER_SA>
gcloud storage buckets add-iam-policy-binding gs://dcs-ai-news-briefs \
  --member="serviceAccount:${SA}" --role="roles/storage.objectAdmin"
```

- [ ] **Step 3: Grant the Cloud TTS service agent object-create on the bucket**

```bash
PROJNUM=$(gcloud projects describe data-concept-studio --format="value(projectNumber)")
gcloud storage buckets add-iam-policy-binding gs://dcs-ai-news-briefs \
  --member="serviceAccount:service-${PROJNUM}@gcp-sa-texttospeech.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"
```

- [ ] **Step 4: Grant the SA token-creator on itself (for signBlob) + any missing roles from Task 2**

```bash
SA=<SIGNER_SA>
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --member="serviceAccount:${SA}" --role="roles/iam.serviceAccountTokenCreator"
# Only if Task 2 showed them missing:
gcloud projects add-iam-policy-binding data-concept-studio --member="serviceAccount:${SA}" --role="roles/aiplatform.user"
gcloud projects add-iam-policy-binding data-concept-studio --member="serviceAccount:${SA}" --role="roles/cloudtts.user"
```

- [ ] **Step 5: Enable APIs (idempotent)**

```bash
gcloud services enable texttospeech.googleapis.com aiplatform.googleapis.com iamcredentials.googleapis.com \
  --project=data-concept-studio
```

- [ ] **Step 6: Re-run the Task 2 Step 4 Long Audio probe** — expect it to now return an `operations/...` name (success). Clean up `_probe.wav`:

```bash
gcloud storage rm gs://dcs-ai-news-briefs/_probe.wav 2>/dev/null || true
```

---

## Phase 1 — Repo source: auth + ingest/enrich

### Task 4: Metadata-service token node

**Files:** Modify `scripts/build-workflows.mjs` (the `tokenNode` helper).

**Interfaces:**
- Produces: token nodes named `Get GCP token filter/summary/script` whose output `.json.access_token` is consumed by every Vertex/TTS/IAM HTTP node (unchanged downstream).

- [ ] **Step 1: Edit the `tokenNode` helper to use the metadata endpoint + header**

Replace the `tokenNode` function body's `parameters` with:

```javascript
    parameters: {
      method: 'GET',
      url: '={{$env.GCP_TOKEN_URL || "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"}}',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'Metadata-Flavor', value: 'Google' }
        ]
      },
      options: {
        response: { response: { responseFormat: 'json' } }
      }
    }
```

- [ ] **Step 2: Build + validate**

Run: `npm run build:workflows && npm test`
Expected: `workflow validation passed`, and `workflows/personal-audio-brief.json` now shows the metadata URL + `Metadata-Flavor` header on the three token nodes.

- [ ] **Step 3: Commit**

```bash
git add scripts/build-workflows.mjs workflows/personal-audio-brief.json
git commit -m "feat(auth): use GCE metadata service for GCP token nodes"
```

### Task 5: Ingest refactor — Build source URLs + HTTP fetch + Parse candidates

Replaces the network-in-Code `ingest-candidates.js`. (Variant A — HTTP Request nodes. If Task 1 proved `$helpers.httpRequest` works, you may instead keep `ingest-candidates.js` unchanged and skip to Task 7; record that decision in the commit message.)

**Files:**
- Create: `snippets/code/build-source-urls.js`, `snippets/code/parse-candidates.js`
- Delete: `snippets/code/ingest-candidates.js`
- Modify: `scripts/build-workflows.mjs`

**Interfaces:**
- Consumes: `$('Init state').first().json.lastRun` (epoch seconds), env `YT_CHANNEL_IDS`, `HN_TOPICS`, `HN_MIN_POINTS`; `$getWorkflowStaticData('global').seenIds`.
- Produces: candidate items `{ json: { source:'yt'|'hn', id, title, url, published, snippet, channel?, points?, objectID? } }` consumed by `Build filter input` (unchanged).

- [ ] **Step 1: Create `snippets/code/build-source-urls.js`**

```javascript
function parseJsonEnv(name, fallback) {
  const raw = $env[name];
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch (e) { throw new Error(`${name} must be valid JSON: ${e.message}`); }
}

const lastRun = $('Init state').first().json.lastRun;
const channelIds = parseJsonEnv('YT_CHANNEL_IDS', []);
const topics = parseJsonEnv('HN_TOPICS', []);
const minPoints = Number($env.HN_MIN_POINTS || 50);

const out = [];
for (const cid of channelIds) {
  const id = String(cid || '').trim();
  if (!id.startsWith('UC')) continue; // UC IDs only — handles are pre-resolved at setup
  out.push({ json: { kind: 'yt', url: `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(id)}` } });
}
for (const topic of topics) {
  const url = 'https://hn.algolia.com/api/v1/search_by_date'
    + `?tags=story&query=${encodeURIComponent(topic)}`
    + `&numericFilters=points>${minPoints},created_at_i>${lastRun}`;
  out.push({ json: { kind: 'hn', url } });
}
if (!out.length) throw new Error('No source URLs built (check YT_CHANNEL_IDS / HN_TOPICS)');
return out;
```

- [ ] **Step 2: Create `snippets/code/parse-candidates.js`**

Reuses the XML/HN helpers that were in `ingest-candidates.js` (copy them verbatim from git history of that file). Network is gone — it reads the HTTP node's `data`.

```javascript
function decodeXml(v){return String(v||'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");}
function textBetween(src,tag){const m=src.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,'i'));return m?decodeXml(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').trim()):'';}
function stripHtml(v){return String(v||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();}
function hnItemUrl(id){return `https://news.ycombinator.com/item?id=${encodeURIComponent(id)}`;}

const lastRun = $('Init state').first().json.lastRun;
const s = $getWorkflowStaticData('global');
const seenIds = new Set(s.seenIds || []);
const unique = new Map();

for (const entry of $input.all()) {
  const body = entry.json.data;                 // HTTP node text body
  const text = typeof body === 'string' ? body : JSON.stringify(body || '');
  const isXml = text.trimStart().startsWith('<');

  if (isXml) {
    for (const e of (text.match(/<entry>[\s\S]*?<\/entry>/gi) || [])) {
      const id = textBetween(e,'yt:videoId') || textBetween(e,'id').replace(/^yt:video:/,'');
      const published = textBetween(e,'published');
      const epoch = Math.floor(Date.parse(published)/1000);
      if (!id || !epoch || epoch <= lastRun || seenIds.has(id)) continue;
      const item = { source:'yt', id, title:textBetween(e,'title'),
        url:textBetween(e,'link') || `https://www.youtube.com/watch?v=${id}`,
        published, channel:textBetween(e,'name'), snippet:stripHtml(textBetween(e,'media:description')) };
      unique.set(`yt:${id}`, item);
    }
  } else {
    let json; try { json = typeof body === 'string' ? JSON.parse(body) : body; } catch { json = { hits: [] }; }
    for (const hit of json.hits || []) {
      const id = String(hit.objectID || '');
      if (!id || seenIds.has(id)) continue;
      unique.set(`hn:${id}`, { source:'hn', id, title:hit.title || hit.story_title || '',
        url:hit.url || hnItemUrl(id), published:hit.created_at, points:hit.points || 0,
        objectID:id, snippet:hit.story_text || '' });
    }
  }
}
return [...unique.values()].map(json => ({ json }));
```

- [ ] **Step 3: Wire the nodes in `scripts/build-workflows.mjs`**

Replace the `codeNode('ingest-candidates', ...)` entry with these three, and add an HTTP "fetch source" node. Insert in `generatorNodes` between `Init state` and `Build filter input`:

```javascript
  codeNode('build-source-urls', 'Build source URLs', 'build-source-urls.js', [-560, 0]),
  {
    id: 'fetch-source', name: 'Fetch source', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4,
    position: [-380, 0], retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
    parameters: {
      method: 'GET', url: '={{$json.url}}',
      options: { response: { response: { responseFormat: 'text' } }, batching: { batch: { batchSize: 4, batchInterval: 500 } } },
      // tolerate a single bad feed without failing the run:
      onError: 'continueRegularOutput'
    }
  },
  codeNode('parse-candidates', 'Parse candidates', 'parse-candidates.js', [-200, 0]),
```

Update the `mainChainNames` array: replace `'Ingest candidates'` with the three names in order: `'Build source URLs'`, `'Fetch source'`, `'Parse candidates'`. (Reposition later nodes' x-coords if desired; not required for function.)

- [ ] **Step 4: Delete the old snippet**

```bash
git rm snippets/code/ingest-candidates.js
```

- [ ] **Step 5: Build + validate**

Run: `npm run build:workflows && npm test`
Expected: `workflow validation passed`; the JSON contains `Build source URLs → Fetch source → Parse candidates` chained into `Build filter input`.

- [ ] **Step 6: Commit**

```bash
git add scripts/build-workflows.mjs snippets/code/build-source-urls.js snippets/code/parse-candidates.js workflows/personal-audio-brief.json
git commit -m "feat(ingest): move source fetch into HTTP node (sandbox-safe); UC-id feeds"
```

### Task 6: Enrich refactor — HN article fetch via HTTP node

**Files:**
- Create: `snippets/code/enrich-hn.js`, `snippets/code/enrich-yt.js`
- Delete: `snippets/code/enrich-selected.js`
- Modify: `scripts/build-workflows.mjs`

**Interfaces:**
- Consumes: `Parse selected` items `{ source, id, title, url, snippet, reason, ... }`.
- Produces: items `{ ...item, content }` consumed by `Build summary input` (unchanged; it reads `id, source, title, url, content`).

- [ ] **Step 1: Create `snippets/code/enrich-hn.js`**

```javascript
function stripHtml(v){return String(v||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<noscript[\s\S]*?<\/noscript>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();}
return $input.all().map(entry => {
  const meta = entry.json;
  const fetched = typeof meta.data === 'string' ? stripHtml(meta.data).slice(0, 18000) : '';
  const content = (fetched || [meta.title, meta.snippet].filter(Boolean).join('\n\n')).slice(0, 18000);
  const { data, ...rest } = meta;
  return { json: { ...rest, content } };
});
```

- [ ] **Step 2: Create `snippets/code/enrich-yt.js`**

```javascript
return $input.all().map(entry => {
  const item = entry.json;
  const content = [
    item.title,
    item.channel ? `Channel: ${item.channel}` : '',
    item.snippet,
    'YouTube transcript enrichment is handled by the yt-dlp/Scribe path in the full deployment image.'
  ].filter(Boolean).join('\n\n').slice(0, 18000);
  return { json: { ...item, content } };
});
```

- [ ] **Step 3: Wire IF → (HTTP + enrich-hn) / enrich-yt → Merge in `scripts/build-workflows.mjs`**

Replace `codeNode('enrich-selected', ...)` with this node cluster (insert between `Parse selected` and `Build summary input`):

```javascript
  {
    id: 'route-source', name: 'Route source', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [420, 0],
    parameters: { conditions: { options: { caseSensitive: true, version: 2 }, combinator: 'and',
      conditions: [{ leftValue: '={{$json.source}}', rightValue: 'hn', operator: { type: 'string', operation: 'equals' } }] } }
  },
  {
    id: 'fetch-article', name: 'Fetch article', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4,
    position: [600, -100], retryOnFail: true, maxTries: 2, waitBetweenTries: 2000, onError: 'continueRegularOutput',
    parameters: { method: 'GET', url: '={{$json.url}}',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'User-Agent', value: 'audio-brief-bot/0.1' }] },
      options: { response: { response: { responseFormat: 'text' } }, timeout: 20000 } }
  },
  codeNode('enrich-hn', 'Enrich HN', 'enrich-hn.js', [780, -100]),
  codeNode('enrich-yt', 'Enrich YT', 'enrich-yt.js', [600, 120]),
  {
    id: 'merge-enriched', name: 'Merge enriched', type: 'n8n-nodes-base.merge', typeVersion: 3.2, position: [960, 0],
    parameters: { mode: 'append', numberInputs: 2 }
  },
```

Connections (add to the `connections` object explicitly — this branch is not a straight chain, so it is NOT covered by `connect(mainChainNames)`; remove `'Enrich selected'` from `mainChainNames` and instead end the pre-chain at `'Parse selected'` and resume the post-chain at `'Build summary input'`):

```javascript
  'Parse selected': { main: [[{ node: 'Route source', type: 'main', index: 0 }]] },
  'Route source': { main: [
    [{ node: 'Fetch article', type: 'main', index: 0 }],   // true  (hn)
    [{ node: 'Enrich YT', type: 'main', index: 0 }]        // false (yt)
  ] },
  'Fetch article': { main: [[{ node: 'Enrich HN', type: 'main', index: 0 }]] },
  'Enrich HN': { main: [[{ node: 'Merge enriched', type: 'main', index: 0 }]] },
  'Enrich YT': { main: [[{ node: 'Merge enriched', type: 'main', index: 1 }]] },
  'Merge enriched': { main: [[{ node: 'Build summary input', type: 'main', index: 0 }]] },
```

Split `mainChainNames` into `preChainNames` (`'Weekly schedule'` … `'Parse selected'`) and `postChainNames` (`'Build summary input'` … `'Commit state'`), and build connections as `{ ...connect(preChainNames), ...<the explicit branch above>, ...connect(postChainNames) }`.

- [ ] **Step 4: Delete the old snippet**

```bash
git rm snippets/code/enrich-selected.js
```

- [ ] **Step 5: Build + validate**

Run: `npm run build:workflows && npm test`
Expected: pass; JSON shows `Parse selected → Route source → (Fetch article→Enrich HN | Enrich YT) → Merge enriched → Build summary input`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(enrich): route HN through HTTP fetch node, YT placeholder, merge"
```

---

## Phase 2 — Repo source: TTS → GCS, signed URL, Slack

### Task 7: Long Audio request + LRO poll loop

**Files:**
- Create: `snippets/code/build-longaudio-request.js`, `snippets/code/poll-longaudio.js`
- Delete: `snippets/code/chunk-script.js`
- Modify: `scripts/build-workflows.mjs` (remove `Chunk script` + `ElevenLabs TTS` + `Upload audio to S3`; add the TTS + poll nodes)

**Interfaces:**
- Consumes: `Parse script` item `{ script, show_notes, generatedAt }`.
- Produces: after poll, an item carrying `{ script, show_notes, generatedAt, objectName, gcsUri, bucket }` for the signing group.

- [ ] **Step 1: Create `snippets/code/build-longaudio-request.js`**

```javascript
const input = $input.first().json;
const generatedAt = input.generatedAt || new Date().toISOString();
const ts = Math.floor(Date.parse(generatedAt) / 1000);
const bucket = $env.STORAGE_BUCKET || 'dcs-ai-news-briefs';
const objectName = `brief_${ts}.wav`;
const script = String(input.script || '').trim();
if (!script) throw new Error('No script text for TTS');

return [{
  json: {
    script, show_notes: input.show_notes || [], generatedAt, ts, bucket, objectName,
    gcsUri: `gs://${bucket}/${objectName}`,
    requestBody: {
      input: { text: script },
      voice: { languageCode: 'pl-PL', name: $env.TTS_VOICE || 'pl-PL-Wavenet-B' },
      audioConfig: { audioEncoding: 'LINEAR16' },
      outputGcsUri: `gs://${bucket}/${objectName}`
    }
  }
}];
```

- [ ] **Step 2: Create `snippets/code/poll-longaudio.js`** (interprets `operations.get`)

```javascript
const op = $input.first().json;
if (op.error) throw new Error(`Long Audio failed: ${JSON.stringify(op.error)}`);
const carry = $('Build LongAudio request').first().json;
if (op.done === true) {
  return [{ json: { ...carry, done: true } }];
}
return [{ json: { ...carry, done: false, operationName: op.name || carry.operationName } }];
```

- [ ] **Step 3: Add the TTS + poll nodes in `scripts/build-workflows.mjs`**

Remove the `chunk-script`, `elevenlabs-tts`, and `upload-audio` node objects. After `Parse script`, insert:

```javascript
  codeNode('build-longaudio-request', 'Build LongAudio request', 'build-longaudio-request.js', [2560, 0]),
  tokenNode('gcp-token-tts', 'Get GCP token tts', [2740, 0]),
  {
    id: 'tts-longaudio', name: 'TTS synthesize long', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4,
    position: [2920, 0], retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
    parameters: {
      method: 'POST',
      url: `={{(($env.TTS_LOCATION||'us')) && 'https://texttospeech.googleapis.com/v1/projects/' + ($env.AUDIO_BRIEF_GCP_PROJECT_ID||'data-concept-studio') + '/locations/' + ($env.TTS_LOCATION||'us') + ':synthesizeLongAudio'}}`,
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'Authorization', value: '=Bearer {{$node["Get GCP token tts"].json.access_token}}' },
        { name: 'Content-Type', value: 'application/json' } ] },
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{JSON.stringify($node["Build LongAudio request"].json.requestBody)}}',
      options: {}
    }
  },
  {
    id: 'wait-tts', name: 'Wait for TTS', type: 'n8n-nodes-base.wait', typeVersion: 1.1,
    position: [3100, 0], parameters: { amount: 15, unit: 'seconds' }
  },
  tokenNode('gcp-token-op', 'Get GCP token op', [3280, 0]),
  {
    id: 'op-get', name: 'Operation get', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4,
    position: [3460, 0], retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
    parameters: {
      method: 'GET',
      url: '={{"https://texttospeech.googleapis.com/v1/" + ($node["TTS synthesize long"].json.name || $json.operationName)}}',
      sendHeaders: true,
      headerParameters: { parameters: [ { name: 'Authorization', value: '=Bearer {{$node["Get GCP token op"].json.access_token}}' } ] },
      options: { response: { response: { responseFormat: 'json' } } }
    }
  },
  codeNode('poll-longaudio', 'Poll long audio', 'poll-longaudio.js', [3640, 0]),
  {
    id: 'tts-done', name: 'TTS done?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [3820, 0],
    parameters: { conditions: { options: { caseSensitive: true, version: 2 }, combinator: 'and',
      conditions: [{ leftValue: '={{$json.done}}', rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }] } }
  },
```

Connections for the poll loop (add explicitly; `TTS done?` false-branch loops back to `Wait for TTS`):

```javascript
  'Parse script': { main: [[{ node: 'Build LongAudio request', type: 'main', index: 0 }]] },
  'Build LongAudio request': { main: [[{ node: 'Get GCP token tts', type: 'main', index: 0 }]] },
  'Get GCP token tts': { main: [[{ node: 'TTS synthesize long', type: 'main', index: 0 }]] },
  'TTS synthesize long': { main: [[{ node: 'Wait for TTS', type: 'main', index: 0 }]] },
  'Wait for TTS': { main: [[{ node: 'Get GCP token op', type: 'main', index: 0 }]] },
  'Get GCP token op': { main: [[{ node: 'Operation get', type: 'main', index: 0 }]] },
  'Operation get': { main: [[{ node: 'Poll long audio', type: 'main', index: 0 }]] },
  'Poll long audio': { main: [[{ node: 'TTS done?', type: 'main', index: 0 }]] },
  'TTS done?': { main: [
    [{ node: 'Build signed url', type: 'main', index: 0 }],  // true  → signing (Task 8)
    [{ node: 'Wait for TTS', type: 'main', index: 0 }]       // false → loop
  ] },
```

Remove `'Chunk script'`, `'ElevenLabs TTS'`, `'Upload audio to S3'` from the chain. The post-chain now flows `… → Parse script` then the explicit TTS block above into `Build signed url`.

- [ ] **Step 4: Delete the old snippet**

```bash
git rm snippets/code/chunk-script.js
```

- [ ] **Step 5: Build + validate**

Run: `npm run build:workflows && npm test`
Expected: pass; JSON shows the TTS+poll loop and no ElevenLabs/S3/chunk nodes. (`Build signed url` is added in Task 8; until then `npm test`'s connection-target check will FAIL on the missing `Build signed url` node — implement Task 8 in the same working session and validate at Task 8 Step 5. To keep Task 7 independently green, temporarily point the `TTS done?` true branch at `Commit state`, then repoint in Task 8.)

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(tts): Google Long Audio → GCS with LRO poll loop; drop ElevenLabs+S3"
```

### Task 8: V4 signed URL — build canonical request + signBlob

**Files:**
- Create: `snippets/code/build-signed-url.js`, `snippets/code/assemble-signed-url.js`
- Modify: `scripts/build-workflows.mjs`

**Interfaces:**
- Consumes: poll output `{ bucket, objectName, ... }`.
- Produces: item with `signedUrl` (+ carried `show_notes`, `generatedAt`, `objectName`) consumed by Task 9.

> **Branch (from Task 1):** if `crypto === true`, replace the vendored `sha256hex` with `require('crypto').createHash('sha256').update(canonical).digest('hex')`. Default below assumes no `crypto`.

- [ ] **Step 1: Create `snippets/code/build-signed-url.js`** (vendored SHA256 + V4 canonical)

```javascript
// --- vendored SHA-256 (hex), no deps ---
function sha256hex(ascii){
  function rotr(n,x){return (x>>>n)|(x<<(32-n));}
  const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
  const bytes=[]; for(let i=0;i<ascii.length;i++){let c=ascii.charCodeAt(i);
    if(c<128)bytes.push(c);else if(c<2048){bytes.push(192|(c>>6),128|(c&63));}
    else{bytes.push(224|(c>>12),128|((c>>6)&63),128|(c&63));}}
  const l=bytes.length; bytes.push(0x80); while((bytes.length%64)!==56)bytes.push(0);
  const bl=l*8; for(let i=7;i>=0;i--)bytes.push((bl/Math.pow(2,i*8))&0xff);
  const w=new Array(64);
  for(let j=0;j<bytes.length;j+=64){
    for(let i=0;i<16;i++)w[i]=(bytes[j+i*4]<<24)|(bytes[j+i*4+1]<<16)|(bytes[j+i*4+2]<<8)|(bytes[j+i*4+3]);
    for(let i=16;i<64;i++){const s0=rotr(7,w[i-15])^rotr(18,w[i-15])^(w[i-15]>>>3);const s1=rotr(17,w[i-2])^rotr(19,w[i-2])^(w[i-2]>>>10);w[i]=(w[i-16]+s0+w[i-7]+s1)|0;}
    let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
    for(let i=0;i<64;i++){const S1=rotr(6,e)^rotr(11,e)^rotr(25,e);const ch=(e&f)^(~e&g);const t1=(h+S1+ch+K[i]+w[i])|0;const S0=rotr(2,a)^rotr(13,a)^rotr(22,a);const mj=(a&b)^(a&c)^(b&c);const t2=(S0+mj)|0;h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;}
    h0=(h0+a)|0;h1=(h1+b)|0;h2=(h2+c)|0;h3=(h3+d)|0;h4=(h4+e)|0;h5=(h5+f)|0;h6=(h6+g)|0;h7=(h7+h)|0;
  }
  const toHex=n=>('00000000'+((n>>>0).toString(16))).slice(-8);
  return [h0,h1,h2,h3,h4,h5,h6,h7].map(toHex).join('');
}
function enc(s){return encodeURIComponent(s).replace(/[!*'()]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());}
function encPath(p){return p.split('/').map(enc).join('/');}
function pad(n){return String(n).padStart(2,'0');}

const carry = $input.first().json;
const sa = $env.AUDIO_BRIEF_SIGNER_SA;
if (!sa) throw new Error('AUDIO_BRIEF_SIGNER_SA not set');
const bucket = carry.bucket;
const object = carry.objectName;
const ttl = Math.min(Number($env.SIGNED_URL_TTL_SECONDS || 604800), 604800);
const region = $env.SIGNED_URL_REGION || 'auto';

const now = new Date();
const datestamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth()+1)}${pad(now.getUTCDate())}`;
const reqTs = `${datestamp}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
const scope = `${datestamp}/${region}/storage/goog4_request`;
const credential = `${sa}/${scope}`;
const host = 'storage.googleapis.com';
const canonicalUri = `/${bucket}/${encPath(object)}`;

const qsPairs = [
  ['X-Goog-Algorithm','GOOG4-RSA-SHA256'],
  ['X-Goog-Credential', credential],
  ['X-Goog-Date', reqTs],
  ['X-Goog-Expires', String(ttl)],
  ['X-Goog-SignedHeaders','host']
].map(([k,v]) => [enc(k), enc(v)]).sort((a,b)=>a[0]<b[0]?-1:1);
const canonicalQuery = qsPairs.map(([k,v]) => `${k}=${v}`).join('&');

const canonicalRequest = ['GET', canonicalUri, canonicalQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
const stringToSign = ['GOOG4-RSA-SHA256', reqTs, scope, sha256hex(canonicalRequest)].join('\n');

// signBlob wants base64 of the bytes to sign:
function b64(str){ // ascii/utf8 → base64 without Buffer dependency
  const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes=[]; for(let i=0;i<str.length;i++){let c=str.charCodeAt(i); if(c<128)bytes.push(c); else if(c<2048){bytes.push(192|(c>>6),128|(c&63));} else {bytes.push(224|(c>>12),128|((c>>6)&63),128|(c&63));}}
  let out=''; for(let i=0;i<bytes.length;i+=3){const b0=bytes[i],b1=bytes[i+1],b2=bytes[i+2];out+=chars[b0>>2]+chars[((b0&3)<<4)|((b1||0)>>4)]+(i+1<bytes.length?chars[((b1&15)<<2)|((b2||0)>>6)]:'=')+(i+2<bytes.length?chars[b2&63]:'=');}
  return out;
}

return [{ json: { ...carry, signer: sa, host, canonicalUri, canonicalQuery, scope,
  baseUrl: `https://${host}${canonicalUri}?${canonicalQuery}`,
  payloadB64: b64(stringToSign) } }];
```

- [ ] **Step 2: Create `snippets/code/assemble-signed-url.js`**

```javascript
const carry = $('Build signed url').first().json;
const resp = $input.first().json;            // signBlob response
const signedBlobB64 = resp.signedBlob;
if (!signedBlobB64) throw new Error(`signBlob returned no signedBlob: ${JSON.stringify(resp).slice(0,300)}`);

// base64 → bytes → hex (no Buffer dependency)
const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const clean = signedBlobB64.replace(/=+$/,'');
let bits=0, val=0, hex='';
for (const ch of clean){ val=(val<<6)|chars.indexOf(ch); bits+=6; if(bits>=8){bits-=8; hex+=('0'+(((val>>bits)&0xff).toString(16))).slice(-2);} }

const signedUrl = `${carry.baseUrl}&X-Goog-Signature=${hex}`;
return [{ json: { signedUrl, objectName: carry.objectName, gcsUri: carry.gcsUri,
  show_notes: carry.show_notes, generatedAt: carry.generatedAt, ts: carry.ts } }];
```

- [ ] **Step 3: Wire signing nodes in `scripts/build-workflows.mjs`** (after the TTS loop's true branch)

```javascript
  codeNode('build-signed-url', 'Build signed url', 'build-signed-url.js', [4000, -120]),
  tokenNode('gcp-token-sign', 'Get GCP token sign', [4180, -120]),
  {
    id: 'sign-blob', name: 'Sign blob', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4,
    position: [4360, -120], retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
    parameters: {
      method: 'POST',
      url: '={{"https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/" + encodeURIComponent($env.AUDIO_BRIEF_SIGNER_SA) + ":signBlob"}}',
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'Authorization', value: '=Bearer {{$node["Get GCP token sign"].json.access_token}}' },
        { name: 'Content-Type', value: 'application/json' } ] },
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{JSON.stringify({ payload: $node["Build signed url"].json.payloadB64 })}}',
      options: { response: { response: { responseFormat: 'json' } } }
    }
  },
  codeNode('assemble-signed-url', 'Assemble signed url', 'assemble-signed-url.js', [4540, -120]),
```

Connections:

```javascript
  'Build signed url': { main: [[{ node: 'Get GCP token sign', type: 'main', index: 0 }]] },
  'Get GCP token sign': { main: [[{ node: 'Sign blob', type: 'main', index: 0 }]] },
  'Sign blob': { main: [[{ node: 'Assemble signed url', type: 'main', index: 0 }]] },
  'Assemble signed url': { main: [[{ node: 'Build Slack digest', type: 'main', index: 0 }]] },
```

(If Task 7 Step 5 temporarily pointed `TTS done?` true → `Commit state`, repoint it to `Build signed url` now.)

- [ ] **Step 4: Build + validate**

Run: `npm run build:workflows && npm test`
Expected: pass (all connection targets resolve once Task 9's `Build Slack digest` exists; if running Task 8 alone, temporarily point `Assemble signed url` → `Commit state`).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(sign): V4 signed GCS URL via vendored SHA256 + IAM signBlob"
```

### Task 9: Slack digest + post to #ai-news

**Files:**
- Create: `snippets/code/build-slack-digest.js`
- Modify: `scripts/build-workflows.mjs`

**Interfaces:**
- Consumes: `Assemble signed url` output + `$('Parse summaries').all()` for per-item lines.
- Produces: posts to Slack; passes `{ processedIds }` to `Commit state`.

- [ ] **Step 1: Create `snippets/code/build-slack-digest.js`**

```javascript
const sig = $input.first().json;
const summaries = $('Parse summaries').all().map(i => i.json);
const day = new Date(sig.generatedAt || Date.now()).toISOString().slice(0, 10);

const lines = summaries.slice(0, 12).map(s => {
  const point = (s.bullets && s.bullets[0]) ? String(s.bullets[0]) : '';
  const title = String(s.title || s.source_url || 'item');
  return `• *${title.replace(/[*_~`]/g,'')}*${point ? ' — ' + point : ''}`;
});

const text = `🧠 *AI Brief — ${day}*\n${lines.join('\n')}\n\n🎧 <${sig.signedUrl}|Audio (WAV, link 7 dni)>`;

const blocks = [
  { type: 'section', text: { type: 'mrkdwn', text: `🧠 *AI Brief — ${day}*` } },
  { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') || '_Brak nowych pozycji._' } },
  { type: 'context', elements: [{ type: 'mrkdwn', text: `🎧 <${sig.signedUrl}|Pobierz audio (WAV)> · ważne 7 dni` }] }
];

const processedIds = ($('Build summary input').first().json.enrichedItems || []).map(i => i.id);
return [{ json: { channel: $env.SLACK_CHANNEL_ID || 'C0BCWHAHJRW', text, blocks, processedIds, signedUrl: sig.signedUrl } }];
```

- [ ] **Step 2: Add the Slack node in `scripts/build-workflows.mjs`**

```javascript
  codeNode('build-slack-digest', 'Build Slack digest', 'build-slack-digest.js', [4720, -120]),
  {
    id: 'slack-post', name: 'Post to ai-news', type: 'n8n-nodes-base.slack', typeVersion: 2.3,
    position: [4900, -120],
    credentials: { slackApi: { id: '={{$env.SLACK_CREDENTIAL_ID || ""}}', name: 'MATHS Slack Bot' } },
    parameters: {
      resource: 'message', operation: 'post',
      select: 'channel', channelId: { __rl: true, mode: 'id', value: '={{$json.channel}}' },
      messageType: 'block', blocksUi: '={{JSON.stringify($json.blocks)}}',
      text: '={{$json.text}}',
      otherOptions: { unfurl_links: false, unfurl_media: false }
    }
  },
```

Connections:

```javascript
  'Build Slack digest': { main: [[{ node: 'Post to ai-news', type: 'main', index: 0 }]] },
  'Post to ai-news': { main: [[{ node: 'Commit state', type: 'main', index: 0 }]] },
```

> **Note:** the Slack credential reference may need the live credential **id** (not just name) to bind. Task 11/12 confirms the exact credential id via `n8n_get_workflow` on an existing Slack-using workflow and pins `SLACK_CREDENTIAL_ID`. The `n8n-change-flow` skill applies when editing live n8n.

- [ ] **Step 3: Build + validate**

Run: `npm run build:workflows && npm test`
Expected: pass; the full chain resolves end to end into `Commit state`.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(slack): post headline digest + signed audio link to #ai-news"
```

### Task 10: Commit-state cleanup + remove RSS/register

**Files:**
- Modify: `snippets/code/commit-state.js`
- Delete: `snippets/code/register-episode.js`, `snippets/code/build-rss.js`
- Modify: `scripts/build-workflows.mjs` (remove `Register episode`, `Feed webhook`, `Build RSS`, `Respond RSS` nodes + their connections)

**Interfaces:**
- Consumes: `Build Slack digest` output `{ processedIds }` (via the Slack node passthrough) — Slack node forwards its input item; if it does not, read `$('Build Slack digest').first().json.processedIds`.

- [ ] **Step 1: Replace `snippets/code/commit-state.js`**

```javascript
const s = $getWorkflowStaticData('global');
const fromSlack = $('Build Slack digest').first().json;
const processedIds = (fromSlack && fromSlack.processedIds) || [];

if (!s.pendingRun) throw new Error('pendingRun missing; refusing to commit lastRun');

s.lastRun = s.pendingRun;
s.seenIds = [...new Set([...(s.seenIds || []), ...processedIds])].slice(-2000);
delete s.pendingRun;

return [{ json: { ok: true, lastRun: s.lastRun, seenCount: s.seenIds.length } }];
```

- [ ] **Step 2: Remove RSS + register nodes from `scripts/build-workflows.mjs`**

Delete the `register-episode` codeNode, and the `feed-webhook`, `build-rss`, `respond-rss` node objects. Remove `'Register episode'` from the chain and delete the `...connect(['Feed webhook','Build RSS','Respond RSS'])` line from `connections`. Update the workflow `name` to `AI News Brief - GCS + Slack`.

- [ ] **Step 3: Delete old snippets**

```bash
git rm snippets/code/register-episode.js snippets/code/build-rss.js
```

- [ ] **Step 4: Build + validate**

Run: `npm run build:workflows && npm test`
Expected: pass; JSON has no `Feed webhook`/`Build RSS`/`Respond RSS`/`Register episode`; `Commit state` is the terminal node.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor(state): drop RSS+episode, commit lastRun/seenIds after Slack"
```

---

## Phase 3 — Repo housekeeping

### Task 11: `.env.example`, validator, docs

**Files:** Modify `.env.example`, `scripts/validate-workflows.mjs`, `README.md`, `docs/live-n8n.md`.

- [ ] **Step 1: Rewrite `.env.example`**

Remove `ELEVENLABS_*`, `STORAGE_PUBLIC_BASE`, `STORAGE_REGION/ENDPOINT/ACCESS_KEY_ID/SECRET_ACCESS_KEY/CREDENTIAL_NAME`, `FEED_*`, `N8N_WEBHOOK_URL`/`WEBHOOK_URL`. Set `YT_CHANNEL_IDS` to the resolved UC IDs. Add:

```bash
# GCP auth — GCE metadata service on the VM (override only for local dev with a token broker)
GCP_TOKEN_URL=http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token
AUDIO_BRIEF_GCP_PROJECT_ID=data-concept-studio
GCP_LOCATION=global
LLM_MODEL_CHEAP=gemini-2.5-flash
LLM_MODEL_STRONG=gemini-2.5-pro
GEMINI_MAX_OUTPUT_TOKENS=4096

# Google Cloud TTS Long Audio → GCS
TTS_LOCATION=us            # confirmed in Task 2
TTS_VOICE=pl-PL-Wavenet-B  # confirmed in Task 2
STORAGE_BUCKET=dcs-ai-news-briefs

# V4 signed URL
AUDIO_BRIEF_SIGNER_SA=<vm-service-account-email>   # from Task 2
SIGNED_URL_TTL_SECONDS=604800
SIGNED_URL_REGION=auto

# Slack
SLACK_CHANNEL_ID=C0BCWHAHJRW
SLACK_CREDENTIAL_ID=        # n8n credential id of "MATHS Slack Bot" (Task 12)

# YouTube channels (resolved UC ids)
YT_CHANNEL_IDS=["UCXUPKJO5MZQN11PqgIvyuvQ","UCYO_jab_esuFRV4b17AJtAw","UCMLtBahI5DMrt0NPvDSoIRQ","UCNJ1Ymd5yFuUPtn21xtRbbw","UCbfYPyITQ-7l4upoX8nvctg","UCMwVTLZIRRUyyVrkjDpn4pA","UC_x36zCEGilGpB1m-V4gmjg","UCn8ujwUInbJkBhffxqAPBVQ","UCXZCJLdBC09xxGZ6gcdrc6A","UCP7jMXSY2xbc3KCAE0MHQ-A","UCrDwWp7EBBv4NwvScIpBDOA"]
```

Keep `AUDIO_BRIEF_CRON`, `HN_TOPICS`, `HN_MIN_POINTS`, `TOP_N`, `TARGET_WORDS`, `INTEREST_PROFILE`.

- [ ] **Step 2: Update `scripts/validate-workflows.mjs`**

In `requiredFiles`, remove `build-rss.js`/`ingest-candidates.js`-coupled entries and add the new snippets: `snippets/code/build-source-urls.js`, `snippets/code/parse-candidates.js`, `snippets/code/build-longaudio-request.js`, `snippets/code/build-signed-url.js`, `snippets/code/build-slack-digest.js`, `snippets/code/commit-state.js`. In the env-key loop, replace `ELEVENLABS_API_KEY`/`FEED_TOKEN`/`GCP_TOKEN_URL` assertions with: `STORAGE_BUCKET`, `AUDIO_BRIEF_SIGNER_SA`, `TTS_VOICE`, `SLACK_CHANNEL_ID`. Add an assertion that the workflow contains a node named `Post to ai-news` and none named `ElevenLabs TTS`/`Build RSS`:

```javascript
const wfNames = new Set(JSON.parse(readFileSync(join(root,'workflows','personal-audio-brief.json'),'utf8')).nodes.map(n=>n.name));
if (!wfNames.has('Post to ai-news')) fail('workflow missing Slack node Post to ai-news');
for (const banned of ['ElevenLabs TTS','Build RSS','Upload audio to S3']) if (wfNames.has(banned)) fail(`workflow still contains ${banned}`);
```

- [ ] **Step 3: Update `README.md` + `docs/live-n8n.md`**

README: replace the "private RSS feed" framing with "GCP-native: Vertex Gemini → Cloud TTS Long Audio → GCS → Slack #ai-news"; drop the RSS URL section and the yt-dlp/ffmpeg image note (not needed at runtime). `docs/live-n8n.md`: replace the "Keep inactive until" list with the GCS/Slack prerequisites (bucket + IAM from Task 3, env vars from Task 12, smoke run from Task 13) and update the workflow name.

- [ ] **Step 4: Build + validate**

Run: `npm run build:workflows && npm test`
Expected: `workflow validation passed`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "docs+config: GCP/Slack env, validator, README/live-n8n"
```

---

## Phase 4 — Deploy, smoke, activate

### Task 12: **[GATED]** Deploy the rebuilt workflow to the VM n8n + set env

Run only after explicit user go-ahead.

**Files:** none (live n8n via MCP + VM env).

- [ ] **Step 1: Resolve the two pending YT handles (or drop them)**

```bash
for h in jeremyphoward aiengineerfoundation; do
  curl -sL -A "Mozilla/5.0" "https://www.youtube.com/@${h}" | grep -oE '"externalId":"UC[A-Za-z0-9_-]{22}"' | head -1
done
```
Append any resolved UC ids to `YT_CHANNEL_IDS`. If still blocked, leave them out (11 channels is fine).

- [ ] **Step 2: Find the Slack credential id**

Use `n8n_list_workflows` + `n8n_get_workflow` on an existing Slack-posting workflow (e.g. the equity approval handler) to read the `credentials.slackApi.id` of "MATHS Slack Bot". Set `SLACK_CREDENTIAL_ID` accordingly (in the workflow JSON credential stub and/or VM env).

- [ ] **Step 3: Set the VM n8n env vars**

Set the Phase 3 env keys in the n8n runtime on `maths-vm` (the compose `.env` for the n8n container), then restart n8n. Do NOT put secrets in the repo. Confirm `metadata.google.internal` is reachable from inside the n8n container:

```bash
gcloud compute ssh maths-vm --zone=europe-west1-c --command \
  "docker exec \$(docker ps --filter name=n8n -q) sh -c 'wget -qO- --header=\"Metadata-Flavor: Google\" http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email'"
```
Expected: prints the VM SA email.

- [ ] **Step 4: Deploy the rebuilt JSON to the existing workflow id**

Follow the `maths-trading-pack:n8n-change-flow` skill: GET the current workflow (`n8n_get_workflow JdKu1ZzS1SFZ6Ysa`) as a backup, then `n8n_update_full_workflow` with the new `name` + `nodes` + `connections` + minimal `settings` from `workflows/personal-audio-brief.json`. Keep it **inactive**.

- [ ] **Step 5: Validate on the server**

Run `n8n_validate_workflow` on `JdKu1ZzS1SFZ6Ysa`. Expected: no errors (cycle warning on the TTS poll loop is expected/acceptable).

### Task 13: **[GATED]** Smoke run

- [ ] **Step 1: Narrow the window for a cheap run**

Temporarily set `HN_MIN_POINTS` high (e.g. `300`) and `YT_CHANNEL_IDS` to a single active channel, or set the static `lastRun` back ~2 days so a few items appear. Keep `TOP_N=3`.

- [ ] **Step 2: Manually execute the workflow** (n8n UI through the tunnel, or `n8n_test_workflow`). Watch each node.

- [ ] **Step 3: Verify the audio landed in GCS**

```bash
gcloud storage ls gs://dcs-ai-news-briefs/
```
Expected: a `brief_<ts>.wav` object.

- [ ] **Step 4: Verify the signed URL works**

Copy the `Assemble signed url` output and:

```bash
curl -sI "<signedUrl>" | head -1
```
Expected: `HTTP/2 200`. If `403 SignatureDoesNotMatch`, set `SIGNED_URL_REGION=europe-west1` (or `us`) and re-run — the credential-scope region is the only knob; iterate until 200.

- [ ] **Step 5: Verify Slack** — `#ai-news` shows the digest with a clickable audio link; the link plays/downloads the WAV; no audio file is attached.

- [ ] **Step 6: Restore production knobs** (`HN_MIN_POINTS`, `YT_CHANNEL_IDS`, `TOP_N`) and reset `lastRun` if you moved it.

### Task 14: **[GATED]** Activate + finish branch

- [ ] **Step 1: Activate the workflow**

`POST /api/v1/workflows/JdKu1ZzS1SFZ6Ysa/activate` (per memory: activation is POST, not PATCH). Confirm `active: true` via `n8n_get_workflow ... minimal`.

- [ ] **Step 2: Update `docs/live-n8n.md`** with `Active: true`, the run date, and the resolved env values (no secrets). Commit.

- [ ] **Step 3: Open the PR**

```bash
git push -u origin feat/gcp-audio-brief-slack
gh pr create --title "GCP-native AI news brief → GCS + #ai-news Slack" \
  --body "Implements docs/superpowers/specs/2026-06-21-gcp-audio-brief-slack-design.md"
```
(Confirm the base branch — `automation` default is `main`; ask the user before merging.)

---

## Self-Review

**Spec coverage:** §3 decisions → metadata auth (T4), Long Audio→GCS (T7), WAV (T7), signed URL (T8), Slack digest (T9), drop RSS (T10), weekly cadence (unchanged), UC ids (T5/T11). §5 components → all mapped to tasks. §6 source changes → T4–T11. §7 infra → T2/T3. §8 risks → T1 (`$helpers`/`crypto` probe), T2 (voice/region/scope), T8+T13 (signing verify-loop), T13 smoke. §10 acceptance → T13/T14.

**Placeholder scan:** code is provided in full for every snippet and node; the only deferred values are `SIGNER_SA`, `TTS_LOCATION`, `TTS_VOICE`, `SLACK_CREDENTIAL_ID`, and the 2 unresolved UC ids — each has an explicit task + command that produces the concrete value before it is consumed.

**Type consistency:** carry object fields are consistent across the TTS→sign→assemble→slack chain (`objectName`, `gcsUri`, `bucket`, `show_notes`, `generatedAt`, `ts`, `signedUrl`, `processedIds`). `Build LongAudio request` is the node name referenced by `poll-longaudio.js` and `Operation get`. `Build signed url` / `Assemble signed url` / `Build Slack digest` names match between snippets, node defs, and connections.
