# Live n8n Deployment

Live n8n is the production instance on `maths-vm` (`data-concept-studio`), reached via the IAP tunnel
`localhost:15678 -> maths-vm:5678` that `../maths/.mcp.json` uses.

Imported workflows:

| Workflow | ID | Active |
|---|---:|---:|
| AI News Brief - GCS + Slack | `JdKu1ZzS1SFZ6Ysa` | **true** (live since 2026-06-21) |
| Finance Brief - GCS + Slack (ElevenLabs) | `49dxEXJVxTEQskov` | **true** (live since 2026-06-21) |

**AI brief** — Vertex Gemini (filter/summarize/script) -> Cloud TTS Long Audio -> GCS (WAV) ->
V4 signed link + digest to Slack `#ai-news` (`C0BCWHAHJRW`). Weekly, Mon 07:00 Europe/Warsaw.

**Finance brief** (parallel pipeline) — sources: 3 PL finance YouTube channels (DNA Rynków, FxMag,
Zawód Inwestor) + Bankier.pl / MarketWatch RSS -> Vertex Gemini (finance profile, short ~300-word PL script)
-> **ElevenLabs** `eleven_multilingual_v2` (voice Daniel, `language_code: pl`) mp3 -> GCS upload ->
V4 signed link + digest to Slack `#finance-news` (`C0BBWESNQ4B`). Weekly, Mon 08:00 Europe/Warsaw.
ElevenLabs key is an n8n `httpHeaderAuth` credential (`ElevenLabs API`, id `Z3FR1wCa5D4NlRQo`), domain-scoped
to `api.elevenlabs.io`; a hard char-cap in `fin-build-tts.js` protects the free-tier quota.

Config is baked as node literals (see runtime notes), so no n8n env vars / container restart are required.

## First-run verification (2026-06-21)

A full run completed end to end: `brief_1782042343.wav` (14.1 MB, RIFF/WAVE 16-bit mono 24 kHz) written to
`gs://dcs-ai-news-briefs`, a 10-item digest posted to `#ai-news`, and the V4 signed link returned **HTTP 200**.

## Runtime notes / gotchas (this instance)

- **`$env` is blocked** in Code nodes and expressions (`N8N_BLOCK_ENV_ACCESS_IN_NODE`): accessing `$env.X`
  *throws* ("access to env vars denied") — it does not fall through to a default. All config is therefore
  inlined as literals in the snippets / build script. `.env.example` is documentation only.
- **`saveDataSuccessExecution: none`**: successful executions are NOT persisted, so they do not appear in
  `GET /api/v1/executions`. Only errors are saved. Verify success via the GCS object + the Slack post, not
  the executions list.
- **Gemini 2.5 thinking tokens count against `maxOutputTokens`**: Flash spent ~3.9k "thought" tokens of a
  4096 cap and truncated the JSON. Fix: `generationConfig.thinkingConfig.thinkingBudget = 0` for the Flash
  filter/summarize calls and a bounded budget + higher cap for the Pro script call.
- **Cloud TTS Long Audio has no service agent**: the *caller* (the VM SA via its metadata token) writes the
  WAV, so only `roles/storage.objectAdmin` on the SA is needed (it already has it project-wide). There is no
  `roles/cloudtts.user` role; the enabled API + `cloud-platform` scope suffice.
- Re-registering the schedule needs a deactivate -> activate cycle, not just `PUT` + `activate`.

## Reproducing a manual run

The schedule trigger can't be triggered externally. To force a run, temporarily add a Webhook trigger ->
`Init state` (see `tmp/mksmoke.py` pattern), POST to `/webhook/<path>`, then restore. Provisioning lives in
`scripts/provision-gcp.sh`.
