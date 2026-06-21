function contentFrom(response) {
  return response?.choices?.[0]?.message?.content
    || response?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('')
    || response?.message?.content
    || response?.text
    || response?.data
    || '';
}

const body = $input.first().json;
const raw = contentFrom(body);
let parsed;

try {
  parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
} catch (error) {
  throw new Error(`LLM script did not return valid JSON: ${error.message}. Raw: ${String(raw).slice(0, 500)}`);
}

if (!parsed.script) throw new Error('LLM script response is missing script');

return [{
  json: {
    script: parsed.script,
    show_notes: parsed.show_notes || [],
    generatedAt: new Date().toISOString()
  }
}];
