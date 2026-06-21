const items = $input.all().map(item => item.json);
const topN = Number($env.TOP_N || 10);
const interestProfile = $env.INTEREST_PROFILE || 'Software builder focused on practical AI systems: LLM architecture, agents, coding workflows, local inference, model optimization, RAG/data pipelines, evaluation, security, and production engineering. Prefer technically deep, implementation-oriented material over hype, launches without substance, or generic business commentary.';

if (!items.length) throw new Error('No candidate items found');

const system = `Jestes filtrem tresci dla codziennego briefu. Profil odbiorcy:
${interestProfile}

Otrzymasz liste pozycji: id, source, title, snippet.
Zwroc wylacznie JSON:
{"selected":[{"id":"...","reason":"<max 12 slow>"}]}
Zasady: maksymalnie ${topN} pozycji; odrzuc materialy promocyjne, clickbait i duplikaty tematyczne; preferuj zgodnosc z profilem. Bez komentarza poza JSON.`;

return [{
  json: {
    candidateItems: items,
    requestBody: {
      contents: [{
        role: 'user',
        parts: [{ text: JSON.stringify(items.map(({ id, source, title, snippet }) => ({ id, source, title, snippet }))) }]
      }],
      systemInstruction: { parts: [{ text: system }] },
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: Number($env.GEMINI_MAX_OUTPUT_TOKENS || 4096),
        responseMimeType: 'application/json'
      }
    }
  }
}];
