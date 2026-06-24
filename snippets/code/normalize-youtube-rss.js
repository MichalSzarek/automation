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
  return match ? decodeXml(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()) : '';
}

const xml = String($input.first().json.data || '');
const entries = xml.match(/<entry>[\s\S]*?<\/entry>/gi) || [];

return entries.map(entry => {
  const id = textBetween(entry, 'yt:videoId') || textBetween(entry, 'id').replace(/^yt:video:/, '');
  return {
    json: {
      source: 'yt',
      id,
      title: textBetween(entry, 'title'),
      url: textBetween(entry, 'link') || `https://www.youtube.com/watch?v=${id}`,
      published: textBetween(entry, 'published'),
      channel: textBetween(entry, 'name'),
      snippet: textBetween(entry, 'media:description')
    }
  };
});
