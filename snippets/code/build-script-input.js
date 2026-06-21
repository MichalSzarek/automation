const summaries = $input.all().map(item => item.json);
const targetWords = Number($env.TARGET_WORDS || 1000);

if (!summaries.length) throw new Error('No summaries available for script generation');

const system = `Tworzysz mowiony brief po polsku w stylu: zwiezly, konkretny, z lekkim dystansem.
Struktura: krotkie intro -> segmenty tematyczne wedlug waznosci -> zwiezle zamkniecie.
Dlugosc docelowa: ${targetWords} slow.
Zasady twarde:
- Uzywaj wylacznie dostarczonych punktow.
- Jesli czegos brak w punktach, nie zmyslaj i pomin.
- Nie wstawiaj URL ani znacznikow zrodel do mowionego tekstu.
Zwroc JSON: {"script":"<czysty tekst do TTS>","show_notes":[{"title":"...","url":"..."}]}`;

return [{
  json: {
    summaries,
    requestBody: {
      contents: [{
        role: 'user',
        parts: [{ text: JSON.stringify({ summaries }) }]
      }],
      systemInstruction: { parts: [{ text: system }] },
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: Number($env.GEMINI_MAX_OUTPUT_TOKENS || 4096),
        responseMimeType: 'application/json'
      }
    }
  }
}];
