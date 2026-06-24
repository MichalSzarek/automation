// Build the ElevenLabs Text-to-Dialogue request from the dialogue turns: speaker A -> male
// voice, speaker B -> female voice. One API call returns one two-voice mp3 (no concat).
// Named "Build TTS request" so the shared signing/upload nodes work unchanged.

const VOICE_A = 'onwK4e9ZLuTAKqWW03F9'; // male — Daniel (Steady Broadcaster)
const VOICE_B = 'EXAVITQu4vr4xnSDxMaL'; // female — Sarah (Professional)
const MAX_CHARS = 4700;                 // ElevenLabs Text-to-Dialogue hard limit is 5000 chars/request

const input = $input.first().json;
const generatedAt = input.generatedAt || new Date().toISOString();
const ts = Math.floor(Date.parse(generatedAt) / 1000);
const bucket = 'dcs-ai-news-briefs';
const objectName = `fin_podcast_${ts}.mp3`;

const inputs = [];
let total = 0;
for (const t of input.turns || []) {
  const text = String(t.text || '').trim();
  if (!text) continue;
  if (total + text.length > MAX_CHARS) break;
  total += text.length;
  inputs.push({ text, voice_id: t.speaker === 'B' ? VOICE_B : VOICE_A });
}

if (!inputs.length) throw new Error('No dialogue turns to synthesize');

return [{
  json: {
    chars: total,
    turns: inputs.length,
    show_notes: input.show_notes || [],
    generatedAt, ts, bucket, objectName,
    gcsUri: `gs://${bucket}/${objectName}`,
    requestBody: { model_id: 'eleven_v3', inputs }
  }
}];
