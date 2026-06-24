function hnItemUrl(objectID) {
  return `https://news.ycombinator.com/item?id=${encodeURIComponent(objectID)}`;
}

const hits = $input.first().json.hits || [];

return hits.map(hit => ({
  json: {
    source: 'hn',
    id: String(hit.objectID),
    title: hit.title || hit.story_title || '',
    url: hit.url || hnItemUrl(hit.objectID),
    published: hit.created_at,
    points: hit.points || 0,
    objectID: String(hit.objectID),
    snippet: hit.story_text || ''
  }
}));
