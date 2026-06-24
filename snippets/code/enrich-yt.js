// YouTube items: build content from the video's own description (media:description in the
// feed). Strip sponsor URLs so the summarizer focuses on the actual topic. No placeholder
// meta-text (it used to make the LLM think there was no content -> generic "video available").

function stripUrls(s) {
  return String(s || '').replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();
}

return $input.all().map(entry => {
  const item = entry.json;
  const desc = stripUrls(item.snippet || '');
  const content = [
    item.title,
    item.channel ? `Kanal YouTube: ${item.channel}` : '',
    desc
  ].filter(Boolean).join('\n\n').slice(0, 18000);
  return { json: { ...item, content } };
});
