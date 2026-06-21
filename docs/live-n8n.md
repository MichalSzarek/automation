# Live n8n Deployment

Live n8n is the production instance on `maths-vm` (`data-concept-studio`), reached via the IAP tunnel
`localhost:15678 -> maths-vm:5678` that `../maths/.mcp.json` uses.

Imported workflows:

| Workflow | ID | Active |
|---|---:|---:|
| AI News Brief - GCS + Slack | `JdKu1ZzS1SFZ6Ysa` | false |

GCP-native flow: Vertex Gemini (filter/summarize/script) -> Cloud TTS Long Audio -> GCS (WAV) ->
V4 signed link + headline digest to Slack `#ai-news` (`C0BCWHAHJRW`). Config is baked as node defaults,
so no n8n env vars / container restart are required.

Keep inactive until:

- GCP prerequisites exist: bucket `gs://dcs-ai-news-briefs`; APIs `texttospeech`/`aiplatform`/`iamcredentials`
  enabled; `maths-vm-sa@...` has a TTS caller role + `iam.serviceAccountTokenCreator` on itself; the Cloud
  TTS service agent can write the bucket.
- The "MATHS Slack Bot" credential (`wzM8zIUgZuaGOwgg`) exists and the bot is a member of `#ai-news`.
- `n8n_validate_workflow` on `JdKu1ZzS1SFZ6Ysa` is clean (a cycle warning on the TTS poll loop is expected).
- A manual smoke run succeeds end to end: a `brief_<ts>.wav` lands in GCS, the signed URL returns HTTP 200,
  and the digest appears in `#ai-news`.

Activate with `POST /api/v1/workflows/JdKu1ZzS1SFZ6Ysa/activate` (not PATCH).
