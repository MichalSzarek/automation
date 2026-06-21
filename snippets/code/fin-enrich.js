// Finance enrich: build content from title + source + snippet (no article fetch — RSS
// descriptions / video metadata are enough and avoid paywall/JS-fetch failures).

return $input.all().map(entry => {
  const item = entry.json;
  const content = [
    item.title,
    item.channel ? `Kanal: ${item.channel}` : (item.source === 'news' ? 'Zrodlo: wiadomosci rynkowe' : ''),
    item.snippet
  ].filter(Boolean).join('\n\n').slice(0, 6000);
  return { json: { ...item, content } };
});
