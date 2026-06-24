// Strip the HTML fetched by "Fetch article" into plain text content for the summarizer.
// Falls back to title+snippet if the fetch failed (HTTP node onError=continueRegularOutput).

function stripHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

return $input.all().map(entry => {
  const meta = entry.json;
  const fetched = typeof meta.data === 'string' ? stripHtml(meta.data).slice(0, 18000) : '';
  const content = (fetched || [meta.title, meta.snippet].filter(Boolean).join('\n\n')).slice(0, 18000);
  const { data, ...rest } = meta;
  return { json: { ...rest, content } };
});
