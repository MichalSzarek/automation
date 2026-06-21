// Compose the #ai-news message: a headline digest (one line per selected item) plus the
// signed audio link. Slack mrkdwn text mode is used (renders *bold* and <url|label> links);
// the audio file itself is never uploaded — only the link.

const sig = $input.first().json;
const summaries = $('Parse summaries').all().map(i => i.json);
const day = new Date(sig.generatedAt || Date.now()).toISOString().slice(0, 10);

function clean(s) { return String(s || '').replace(/[*_~`<>]/g, '').trim(); }

const lines = summaries.slice(0, 12).map(s => {
  const title = clean(s.title || s.source_url || 'pozycja');
  const point = (s.bullets && s.bullets[0]) ? clean(s.bullets[0]) : '';
  return `• *${title}*${point ? ' — ' + point : ''}`;
});

const body = lines.length ? lines.join('\n') : '_Brak nowych pozycji w tym tygodniu._';
const text = `🧠 *AI Brief — ${day}*\n${body}\n\n🎧 <${sig.signedUrl}|Pobierz audio (WAV)> · link ważny 7 dni`;

const processedIds = ($('Build summary input').first().json.enrichedItems || []).map(i => i.id);

return [{
  json: {
    channel: $env.SLACK_CHANNEL_ID || 'C0BCWHAHJRW',
    text,
    processedIds,
    signedUrl: sig.signedUrl
  }
}];
