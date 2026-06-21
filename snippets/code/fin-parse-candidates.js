// Parse "Fetch source" responses: YouTube Atom feeds (<entry>) and RSS news feeds (<item>).
// Dedupe + filter by lastRun + seenIds. No network here (sandbox-safe).

function decodeXml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x[0-9a-f]+;/gi, ' ');
}
function textBetween(source, tag) {
  const m = source.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? decodeXml(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()) : '';
}
function attr(source, tag, name) {
  const m = source.match(new RegExp(`<${tag}[^>]*\\b${name}="([^"]*)"`, 'i'));
  return m ? decodeXml(m[1]) : '';
}
function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const lastRun = $('Init state').first().json.lastRun;
const s = $getWorkflowStaticData('global');
const seenIds = new Set(s.seenIds || []);
const unique = new Map();

for (const entry of $input.all()) {
  const body = entry.json.data;
  const text = typeof body === 'string' ? body : JSON.stringify(body || '');
  if (!text) continue;

  if (/<entry[\s>]/i.test(text)) {
    // YouTube Atom
    for (const node of (text.match(/<entry>[\s\S]*?<\/entry>/gi) || [])) {
      const id = textBetween(node, 'yt:videoId') || textBetween(node, 'id').replace(/^yt:video:/, '');
      const published = textBetween(node, 'published');
      const epoch = Math.floor(Date.parse(published) / 1000);
      if (!id || !epoch || epoch <= lastRun || seenIds.has(id)) continue;
      unique.set(`yt:${id}`, {
        source: 'yt', id,
        title: textBetween(node, 'title'),
        url: `https://www.youtube.com/watch?v=${id}`,
        published, channel: textBetween(node, 'name'),
        snippet: stripHtml(textBetween(node, 'media:description')).slice(0, 800)
      });
    }
  } else if (/<item[\s>]/i.test(text)) {
    // RSS news
    for (const node of (text.match(/<item[\s>][\s\S]*?<\/item>/gi) || [])) {
      const link = textBetween(node, 'link') || attr(node, 'guid', 'isPermaLink') && textBetween(node, 'guid');
      const guid = textBetween(node, 'guid') || link;
      const id = String(guid || link || '').trim();
      if (!id || seenIds.has(id)) continue;
      const pub = textBetween(node, 'pubDate');
      const epoch = Math.floor(Date.parse(pub) / 1000);
      if (epoch && epoch <= lastRun) continue; // skip clearly-old; undated items pass (seenIds dedups)
      unique.set(`news:${id}`, {
        source: 'news', id,
        title: stripHtml(textBetween(node, 'title')),
        url: link || id,
        published: pub,
        snippet: stripHtml(textBetween(node, 'description')).slice(0, 800)
      });
    }
  }
}

return [...unique.values()].map(json => ({ json }));
