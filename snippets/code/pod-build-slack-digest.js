// Podcast digest for #finance-news: episode header, topics discussed (linked to sources),
// and the signed audio link (two-voice mp3). NOTE: env blocked -> channel id literal.

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
  const title = cleanLabel(s.title || 'temat');
  const url = cleanUrl(urlById.get(String(s.id)) || urlByTitle.get(norm(s.title)) || s.source_url);
  return url ? `• <${url}|${title}>` : `• ${title}`;
});

const body = lines.length ? lines.join('\n') : '_Brak nowych tematow w tym tygodniu._';
const text = `🎙️ *Podcast Ekonomiczny — ${day}*\n_Rozmowa dwojga prowadzących o tym, co dzieje się na rynkach._\n\n*W tym odcinku:*\n${body}\n\n🎧 <${sig.signedUrl}|Posłuchaj / pobierz odcinek> · link ważny 7 dni`;

const processedIds = enriched.map(i => i.id);

return [{
  json: {
    channel: 'C0BBWESNQ4B',
    text,
    processedIds,
    signedUrl: sig.signedUrl
  }
}];
