const text = String($input.first().json.stdout || $input.first().json.data || '');
const transcript = text
  .split(/\r?\n/)
  .filter(line => line.trim())
  .filter(line => !/^\d+$/.test(line.trim()))
  .filter(line => !/-->|WEBVTT|Kind:|Language:/i.test(line))
  .map(line => line.replace(/<[^>]+>/g, '').trim())
  .filter(Boolean)
  .join(' ')
  .replace(/\s+/g, ' ')
  .trim();

return [{ json: { ...$input.first().json, transcript } }];
