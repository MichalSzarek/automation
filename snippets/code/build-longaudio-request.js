// Build the Google Cloud Text-to-Speech "Long Audio" request. Long Audio synthesizes
// arbitrarily long text and writes the result (LINEAR16 WAV) directly to GCS, so there is
// no chunk-size cap and no separate upload step.

const input = $input.first().json;
const generatedAt = input.generatedAt || new Date().toISOString();
const ts = Math.floor(Date.parse(generatedAt) / 1000);
const bucket = $env.STORAGE_BUCKET || 'dcs-ai-news-briefs';
const objectName = `brief_${ts}.wav`;
const script = String(input.script || '').trim();

if (!script) throw new Error('No script text for TTS');

return [{
  json: {
    script,
    show_notes: input.show_notes || [],
    generatedAt,
    ts,
    bucket,
    objectName,
    gcsUri: `gs://${bucket}/${objectName}`,
    requestBody: {
      input: { text: script },
      voice: {
        languageCode: 'pl-PL',
        name: $env.TTS_VOICE || 'pl-PL-Wavenet-B'
      },
      audioConfig: { audioEncoding: 'LINEAR16' },
      outputGcsUri: `gs://${bucket}/${objectName}`
    }
  }
}];
