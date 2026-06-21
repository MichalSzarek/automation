// Finance brief sources: 3 Polish finance YouTube channels + finance-news RSS
// (Bankier.pl Polish + MarketWatch global). Fetch is done by the HTTP node downstream.
// NOTE: env access is blocked on this n8n (N8N_BLOCK_ENV_ACCESS_IN_NODE) -> literals.

const lastRun = $('Init state').first().json.lastRun;

const channelIds = [
  'UCgw_3Epv7swquSZyMDjYHTg', // @DNARynkow
  'UCtTpDSRTegHewCxP9GTUaXQ', // @FxMag
  'UCG4T6bLDq2TdAdRAp2GDOCw'  // @zawodinwestor
];

const newsFeeds = [
  'https://www.bankier.pl/rss/wiadomosci.xml',                       // Polish finance
  'https://feeds.content.dowjones.io/public/rss/mw_topstories'       // MarketWatch (global)
];

const out = [];
for (const cid of channelIds) {
  const id = String(cid || '').trim();
  if (!id.startsWith('UC')) continue;
  out.push({ json: { kind: 'yt', url: `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(id)}` } });
}
for (const url of newsFeeds) {
  out.push({ json: { kind: 'news', url } });
}

if (!out.length) throw new Error('No finance source URLs built');
return out;
