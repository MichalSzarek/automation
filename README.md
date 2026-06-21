# automation

Repo-managed n8n automation for Polish audio briefs, running **end-to-end on GCP**. Two parallel pipelines:

- **AI brief** — YouTube RSS + HackerNews -> Vertex Gemini -> Google Cloud TTS (Long Audio) -> GCS ->
  headline digest + signed audio link to Slack `#ai-news`.
- **Finance brief** — 3 PL finance YouTube channels + Bankier.pl/MarketWatch RSS -> Vertex Gemini ->
  **ElevenLabs** (mp3) -> GCS -> digest + signed link to Slack `#finance-news`.

Both generate `workflows/*.json` from `scripts/build-workflows.mjs` + `snippets/code/*.js`.

The execution contract lives in [n8n-brief-audio-spec.md](./n8n-brief-audio-spec.md).
Design + plan for the GCP/Slack rework: [docs/superpowers/specs](./docs/superpowers/specs) and
[docs/superpowers/plans](./docs/superpowers/plans).

The live n8n instance is the production n8n on the `maths-vm` VM (`data-concept-studio`), reached by the
same MCP that `../maths/.mcp.json` configures (an IAP tunnel `localhost:15678 -> maths-vm:5678`).

## Repository Layout

- `prompts/` - versioned LLM prompts for filtering, per-item summaries, and the final script.
- `snippets/code/` - JavaScript intended for n8n Code nodes.
- `workflows/` - generated n8n workflow export (`personal-audio-brief.json`).
- `fixtures/` - small payloads for local validation and prompt iteration.
- `scripts/` - workflow generation and validation helpers.

## Configuration

Everything in `.env.example` is also **baked as a node default**, so the workflow runs on the VM n8n
without setting any env vars (no container restart needed). Override in `.env` / the n8n runtime only to
change behaviour. Key values:

- `YT_CHANNEL_IDS` - pre-resolved `UC...` channel ids (handles are resolved once at setup).
- `HN_TOPICS`, `HN_MIN_POINTS`, `TOP_N`, `TARGET_WORDS`, `INTEREST_PROFILE` - selection + script tuning.
- `GCP_TOKEN_URL` - GCE metadata endpoint (default). No service-account key is stored anywhere.
- `AUDIO_BRIEF_GCP_PROJECT_ID`, `GCP_LOCATION`, `LLM_MODEL_CHEAP`, `LLM_MODEL_STRONG` - Vertex Gemini.
- `TTS_LOCATION`, `TTS_VOICE`, `STORAGE_BUCKET` - Cloud TTS Long Audio -> GCS (LINEAR16 WAV).
- `AUDIO_BRIEF_SIGNER_SA`, `SIGNED_URL_TTL_SECONDS`, `SIGNED_URL_REGION` - V4 signed URL via IAM signBlob.
- `SLACK_CHANNEL_ID`, `SLACK_CREDENTIAL_ID` - `#ai-news` + the n8n "MATHS Slack Bot" credential.

`INTEREST_PROFILE` is the natural-language taste profile used by the first LLM pass to rank relevance.

## Local Workflow Build

```bash
npm run build:workflows
npm test
```

`npm run build:workflows` regenerates `workflows/personal-audio-brief.json` from the snippets + node graph
in `scripts/build-workflows.mjs`. `npm test` validates JSON shape, required files, node-name invariants, and
required env keys. **Never hand-edit the generated JSON** — edit the snippets / build script and rebuild.

## GCP prerequisites (one-time)

- Bucket `gs://dcs-ai-news-briefs` (private, uniform access).
- APIs enabled: `texttospeech`, `aiplatform`, `iamcredentials`.
- VM service account (`maths-vm-sa@...`): `aiplatform.user`, `storage.objectAdmin` (already project-level),
  a TTS caller role, and `iam.serviceAccountTokenCreator` **on itself** (for signBlob). The Cloud TTS
  service agent needs object-create on the bucket.
- The Slack bot must be a member of `#ai-news`.

## n8n Deployment

Deploy the rebuilt JSON onto the existing workflow (`JdKu1ZzS1SFZ6Ysa`) via the n8n MCP
(`n8n_update_full_workflow`), keep it **inactive**, run `n8n_validate_workflow`, do one manual smoke run
(verify a `brief_<ts>.wav` in GCS + the Slack post + the signed link returns HTTP 200), then activate
(`POST /api/v1/workflows/<id>/activate`). See `docs/live-n8n.md`.

## Operational Notes

- YouTube uses channel RSS for discovery; HackerNews uses the public Algolia API. No API keys needed for either.
- GCP auth is the GCE metadata service — no stored key, no token broker on the VM.
- Audio is **LINEAR16 WAV** written straight to GCS by the Long Audio API (no ElevenLabs, no S3, no ffmpeg).
- The Slack message carries only the **signed link** to the WAV (valid 7 days) — the audio is never uploaded to Slack.
- `lastRun` is committed only after the Slack post succeeds, so a failed run re-processes its window.
- Generated WAV/MP3 files and `tmp/` belong outside git.
