// Parse the dialogue script JSON: { turns: [{speaker, text}], show_notes: [...] }.

function contentFrom(response) {
  return response?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('')
    || response?.choices?.[0]?.message?.content
    || response?.text
    || '';
}

const body = $input.first().json;
const raw = contentFrom(body);
let parsed;
try {
  parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
} catch (error) {
  throw new Error(`Podcast script not valid JSON: ${error.message}. Raw: ${String(raw).slice(0, 500)}`);
}

const turns = (parsed.turns || [])
  .map(t => ({ speaker: String(t.speaker || 'A').toUpperCase() === 'B' ? 'B' : 'A', text: String(t.text || '').trim() }))
  .filter(t => t.text);

if (!turns.length) throw new Error('Podcast script has no dialogue turns');

return [{
  json: {
    turns,
    show_notes: parsed.show_notes || [],
    generatedAt: new Date().toISOString()
  }
}];
