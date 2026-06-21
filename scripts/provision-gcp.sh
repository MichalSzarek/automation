#!/usr/bin/env bash
# One-time GCP provisioning for the AI News Brief workflow. Idempotent.
# Run with the data-concept-studio owner/editor identity:
#   gcloud config set account dataconceptstudio@gmail.com
#   gcloud config set project data-concept-studio
#   bash scripts/provision-gcp.sh
#
# Notes (verified 2026-06-21):
#  - Cloud TTS Long Audio has NO service agent; the *caller* (the VM SA via its metadata
#    token) writes the WAV, so only objectAdmin on the SA is needed (it already has it
#    project-wide). There is no roles/cloudtts.user role — the enabled API + cloud-platform
#    scope are sufficient.
set -euo pipefail

PROJECT="data-concept-studio"
BUCKET="dcs-ai-news-briefs"
BUCKET_LOCATION="europe-west1"
SA="maths-vm-sa@data-concept-studio.iam.gserviceaccount.com"
TTS_LOCATION="us"
TTS_VOICE="pl-PL-Wavenet-B"

echo "Project: $PROJECT | Bucket: gs://$BUCKET ($BUCKET_LOCATION) | SA: $SA"
echo "Identity: $(gcloud config get-value account 2>/dev/null)"

echo "== 1. enable APIs =="
gcloud services enable texttospeech.googleapis.com aiplatform.googleapis.com iamcredentials.googleapis.com \
  --project="$PROJECT"

echo "== 2. create private bucket (skip if exists) =="
gcloud storage buckets create "gs://${BUCKET}" --project="$PROJECT" --location="$BUCKET_LOCATION" \
  --uniform-bucket-level-access --public-access-prevention || true

echo "== 3. grant the VM SA object admin on the bucket (it also has it project-wide) =="
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${SA}" --role="roles/storage.objectAdmin"

echo "== 4. grant the SA token-creator on itself (for V4 signed URLs via signBlob) =="
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --member="serviceAccount:${SA}" --role="roles/iam.serviceAccountTokenCreator"

echo "== 5. verify Long Audio end to end (writes then deletes a probe WAV) =="
TOKEN="$(gcloud auth print-access-token)"
HTTP=$(curl -s -o /tmp/la_probe.json -w '%{http_code}' -X POST \
  "https://texttospeech.googleapis.com/v1/projects/${PROJECT}/locations/${TTS_LOCATION}:synthesizeLongAudio" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "x-goog-user-project: ${PROJECT}" \
  -d "{\"input\":{\"text\":\"test\"},\"voice\":{\"languageCode\":\"pl-PL\",\"name\":\"${TTS_VOICE}\"},\"audioConfig\":{\"audioEncoding\":\"LINEAR16\"},\"outputGcsUri\":\"gs://${BUCKET}/_probe.wav\"}")
echo "  synthesizeLongAudio HTTP $HTTP"; cat /tmp/la_probe.json; echo
sleep 5 && gcloud storage rm "gs://${BUCKET}/_probe.wav" 2>/dev/null || true

echo "Done. HTTP 200 with an operations/... name above means provisioning is complete."
echo "Remember: the 'MATHS Slack Bot' must be a member of #ai-news (C0BCWHAHJRW)."
