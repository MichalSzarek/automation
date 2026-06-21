// Build the ElevenLabs TTS request for the finance brief + the GCS object name/carry.
// HARD CHARACTER CAP protects the ElevenLabs monthly quota (free tier).

const input = $input.first().json;
const generatedAt = input.generatedAt || new Date().toISOString();
const ts = Math.floor(Date.parse(generatedAt) / 1000);
const bucket = 'dcs-ai-news-briefs';
const objectName = `fin_brief_${ts}.mp3`;

const MAX_CHARS = 2600; // safety cap for the ElevenLabs free-tier quota
let script = String(input.script || '').trim();
if (!script) throw new Error('No script text for TTS');
if (script.length > MAX_CHARS) {
  // cut at the last sentence boundary before the cap
  const head = script.slice(0, MAX_CHARS);
  const cut = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  script = cut > 400 ? head.slice(0, cut + 1) : head;
}

return [{
  json: {
    script,
    chars: script.length,
    show_notes: input.show_notes || [],
    generatedAt, ts, bucket, objectName,
    gcsUri: `gs://${bucket}/${objectName}`,
    requestBody: {
      text: script,
      model_id: 'eleven_multilingual_v2',
      language_code: 'pl',
      voice_settings: { stability: 0.5, similarity_boost: 0.8 }
    }
  }
}];
