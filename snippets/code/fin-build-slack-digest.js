// Finance digest for #finance-news: headline list + signed audio link (mp3, ElevenLabs).
// NOTE: env access is blocked on this n8n -> channel id is literal.

const sig = $input.first().json;
const summaries = $('Parse summaries').all().map(i => i.json);
const day = new Date(sig.generatedAt || Date.now()).toISOString().slice(0, 10);

function clean(s) { return String(s || '').replace(/[*_~`<>]/g, '').trim(); }

const lines = summaries.slice(0, 8).map(s => {
  const title = clean(s.title || s.source_url || 'pozycja');
  const point = (s.bullets && s.bullets[0]) ? clean(s.bullets[0]) : '';
  return `• *${title}*${point ? ' — ' + point : ''}`;
});

const body = lines.length ? lines.join('\n') : '_Brak nowych pozycji w tym tygodniu._';
const text = `📈 *Brief finansowy — ${day}*\n${body}\n\n🎧 <${sig.signedUrl}|Pobierz audio (mp3)> · link ważny 7 dni`;

const processedIds = ($('Build summary input').first().json.enrichedItems || []).map(i => i.id);

return [{
  json: {
    channel: 'C0BBWESNQ4B',
    text,
    processedIds,
    signedUrl: sig.signedUrl
  }
}];
