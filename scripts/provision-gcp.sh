#!/usr/bin/env bash
# One-time GCP provisioning for the AI News Brief workflow. Idempotent.
# Run with the data-concept-studio owner/editor identity:
#   gcloud config set account dataconceptstudio@gmail.com
#   gcloud config set project data-concept-studio
#   bash scripts/provision-gcp.sh
set -euo pipefail

PROJECT="${AUDIO_BRIEF_GCP_PROJECT_ID:-data-concept-studio}"
BUCKET="${STORAGE_BUCKET:-dcs-ai-news-briefs}"
BUCKET_LOCATION="${BUCKET_LOCATION:-europe-west1}"
SA="${AUDIO_BRIEF_SIGNER_SA:-maths-vm-sa@data-concept-studio.iam.gserviceaccount.com}"

echo "Project: $PROJECT | Bucket: gs://$BUCKET ($BUCKET_LOCATION) | SA: $SA"
echo "Identity: $(gcloud config get-value account 2>/dev/null)"

echo "== 1. enable APIs =="
gcloud services enable texttospeech.googleapis.com aiplatform.googleapis.com iamcredentials.googleapis.com \
  --project="$PROJECT"

echo "== 2. create Cloud TTS service identity (agent) =="
gcloud beta services identity create --service=texttospeech.googleapis.com --project="$PROJECT" || true
PROJNUM="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
TTS_AGENT="service-${PROJNUM}@gcp-sa-texttospeech.iam.gserviceaccount.com"

echo "== 3. create private bucket (skip if exists) =="
gcloud storage buckets create "gs://${BUCKET}" --project="$PROJECT" --location="$BUCKET_LOCATION" \
  --uniform-bucket-level-access --public-access-prevention || true

echo "== 4. grant bucket access =="
# SA already has project-level storage.objectAdmin, but make the intent explicit on the bucket:
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${SA}" --role="roles/storage.objectAdmin"
# Cloud TTS service agent must be able to write the synthesized WAV:
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${TTS_AGENT}" --role="roles/storage.objectAdmin"

echo "== 5. grant SA the roles it is missing =="
# signBlob (V4 signed URLs) — token-creator on itself:
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --member="serviceAccount:${SA}" --role="roles/iam.serviceAccountTokenCreator"
# Cloud TTS caller (aiplatform.user is already present):
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${SA}" --role="roles/cloudtts.user" || \
  echo "  (roles/cloudtts.user not grantable here — TTS may already be callable via the enabled API)"

echo "== 6. verify Long Audio endpoint (writes a probe WAV, then deletes it) =="
TOKEN="$(gcloud auth print-access-token)"
HTTP=$(curl -s -o /tmp/la_probe.json -w '%{http_code}' -X POST \
  "https://texttospeech.googleapis.com/v1/projects/${PROJECT}/locations/${TTS_LOCATION:-us}:synthesizeLongAudio" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"input\":{\"text\":\"test\"},\"voice\":{\"languageCode\":\"pl-PL\",\"name\":\"${TTS_VOICE:-pl-PL-Wavenet-B}\"},\"audioConfig\":{\"audioEncoding\":\"LINEAR16\"},\"outputGcsUri\":\"gs://${BUCKET}/_probe.wav\"}")
echo "  synthesizeLongAudio HTTP $HTTP"; cat /tmp/la_probe.json; echo
gcloud storage rm "gs://${BUCKET}/_probe.wav" 2>/dev/null || true

echo "Done. If step 6 returned an operations/... name (HTTP 200), provisioning is complete."
