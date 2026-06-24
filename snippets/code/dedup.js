const s = $getWorkflowStaticData('global');
const seenIds = new Set(s.seenIds || []);
const byKey = new Map();

for (const item of $input.all().map(entry => entry.json)) {
  if (!item.id || seenIds.has(item.id)) continue;
  const key = item.url || `${item.source}:${item.id}`;
  if (!byKey.has(key)) byKey.set(key, item);
}

return [...byKey.values()].map(item => ({ json: item }));
