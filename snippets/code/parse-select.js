function contentFrom(response) {
  return response?.choices?.[0]?.message?.content
    || response?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('')
    || response?.message?.content
    || response?.text
    || response?.data
    || '';
}

const input = $input.first().json;
const body = typeof input === 'string' ? JSON.parse(input) : input;
const raw = contentFrom(body);
let parsed;

try {
  parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
} catch (error) {
  throw new Error(`LLM filter did not return valid JSON: ${error.message}. Raw: ${String(raw).slice(0, 500)}`);
}

const selected = new Map((parsed.selected || []).map(item => [String(item.id), item.reason || '']));
const candidates = $('Build filter input').first().json.candidateItems || [];

return candidates
  .filter(item => selected.has(String(item.id)))
  .map(item => ({ json: { ...item, reason: selected.get(String(item.id)) } }));
