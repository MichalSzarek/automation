# Live n8n Deployment

Live n8n is the production instance on `maths-vm` (`data-concept-studio`), reached via the IAP tunnel
`localhost:15678 -> maths-vm:5678` that `../maths/.mcp.json` uses.

Imported workflows:

| Workflow | ID | Active |
|---|---:|---:|
| AI News Brief - GCS + Slack | `JdKu1ZzS1SFZ6Ysa` | **true** (live since 2026-06-21) |

GCP-native flow: Vertex Gemini (filter/summarize/script) -> Cloud TTS Long Audio -> GCS (WAV) ->
V4 signed link + headline digest to Slack `#ai-news` (`C0BCWHAHJRW`). Runs weekly, Mon 07:00 Europe/Warsaw.
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
