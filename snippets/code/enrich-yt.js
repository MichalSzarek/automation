// YouTube items are not fetched (no transcript path here); build content from feed metadata.

return $input.all().map(entry => {
  const item = entry.json;
  const content = [
    item.title,
    item.channel ? `Channel: ${item.channel}` : '',
    item.snippet,
    'YouTube transcript enrichment is handled by the yt-dlp/Scribe path in the full deployment image.'
  ].filter(Boolean).join('\n\n').slice(0, 18000);
  return { json: { ...item, content } };
});
