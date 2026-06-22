// Finance digest for #finance-news: headline list (title linked to its source — YouTube video
// or article) + signed audio link (mp3, ElevenLabs).
// NOTE: env access is blocked on this n8n -> channel id is literal.

const sig = $input.first().json;
const summaries = $('Parse summaries').all().map(i => i.json);
const enriched = $('Build summary input').first().json.enrichedItems || [];
const day = new Date(sig.generatedAt || Date.now()).toISOString().slice(0, 10);

const norm = t => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();
const urlById = new Map(enriched.map(i => [String(i.id), i.url]));
const urlByTitle = new Map(enriched.map(i => [norm(i.title), i.url]));
function cleanLabel(s) { return String(s || '').replace(/[*_~`<>|]/g, '').trim(); }
function cleanUrl(u) { return /^https?:\/\//i.test(String(u || '')) ? String(u).trim() : ''; }

const lines = summaries.slice(0, 8).map(s => {
  const title = cleanLabel(s.title || 'pozycja');
  const point = (s.bullets && s.bullets[0]) ? cleanLabel(s.bullets[0]) : '';
  const url = cleanUrl(urlById.get(String(s.id)) || urlByTitle.get(norm(s.title)) || s.source_url);
  const head = url ? `<${url}|${title}>` : `*${title}*`;
  return `• ${head}${point ? ' — ' + point : ''}`;
});

const body = lines.length ? lines.join('\n') : '_Brak nowych pozycji w tym tygodniu._';
const text = `📈 *Brief finansowy — ${day}*\n${body}\n\n🎧 <${sig.signedUrl}|Pobierz audio (mp3)> · link ważny 7 dni`;

const processedIds = enriched.map(i => i.id);

return [{
  json: {
    channel: 'C0BBWESNQ4B',
    text,
    processedIds,
    signedUrl: sig.signedUrl
  }
}];
