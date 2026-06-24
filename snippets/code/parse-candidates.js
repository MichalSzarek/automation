// Parse the responses produced by "Fetch source" (one item per source URL).
// YouTube feeds come back as Atom XML, HackerNews as Algolia JSON. Detect by content,
// dedupe, and filter against lastRun + seenIds. No network here (sandbox-safe).

function decodeXml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function textBetween(source, tag) {
  const match = source.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!match) return '';
  return decodeXml(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim());
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hnItemUrl(objectID) {
  return `https://news.ycombinator.com/item?id=${encodeURIComponent(objectID)}`;
}

const lastRun = $('Init state').first().json.lastRun;
const staticData = $getWorkflowStaticData('global');
const seenIds = new Set(staticData.seenIds || []);
const unique = new Map();

for (const entry of $input.all()) {
  const body = entry.json.data;
  const text = typeof body === 'string' ? body : JSON.stringify(body || '');
  if (!text) continue;
  const isXml = text.trimStart().startsWith('<');

  if (isXml) {
    for (const node of (text.match(/<entry>[\s\S]*?<\/entry>/gi) || [])) {
      const id = textBetween(node, 'yt:videoId') || textBetween(node, 'id').replace(/^yt:video:/, '');
      const published = textBetween(node, 'published');
      const publishedEpoch = Math.floor(Date.parse(published) / 1000);
      if (!id || !publishedEpoch || publishedEpoch <= lastRun || seenIds.has(id)) continue;
      unique.set(`yt:${id}`, {
        source: 'yt',
        id,
        title: textBetween(node, 'title'),
        url: textBetween(node, 'link') || `https://www.youtube.com/watch?v=${id}`,
        published,
        channel: textBetween(node, 'name'),
        snippet: stripHtml(textBetween(node, 'media:description'))
      });
    }
  } else {
    let json;
    try {
      json = typeof body === 'string' ? JSON.parse(body) : body;
    } catch (error) {
      json = { hits: [] };
    }
    for (const hit of json.hits || []) {
      const id = String(hit.objectID || '');
      if (!id || seenIds.has(id)) continue;
      unique.set(`hn:${id}`, {
        source: 'hn',
        id,
        title: hit.title || hit.story_title || '',
        url: hit.url || hnItemUrl(id),
        published: hit.created_at,
        points: hit.points || 0,
        objectID: id,
        snippet: hit.story_text || ''
      });
    }
  }
}

return [...unique.values()].map(json => ({ json }));
