// Finance spoken-brief script (Polish). Kept short (~300 words) to respect the ElevenLabs
// character quota. NOTE: env access is blocked on this n8n -> literals.

const summaries = $input.all().map(item => item.json);
const targetWords = 300;

if (!summaries.length) throw new Error('No summaries available for script generation');

const system = `Tworzysz mowiony, cotygodniowy brief finansowy po polsku: zwiezly, konkretny, rzeczowy, z lekkim dystansem.
Struktura: krotkie intro -> najwazniejsze tematy rynkowe wedlug istotnosci -> zwiezle zamkniecie.
Dlugosc docelowa: ${targetWords} slow (TWARDY limit, nie przekraczaj).
Zasady twarde:
- Uzywaj wylacznie dostarczonych punktow; nie dodawaj danych z pamieci.
- Nie podawaj porad inwestycyjnych ani rekomendacji kupna/sprzedazy.
- Jesli czegos brak w punktach, nie zmyslaj i pomin.
- Nie wstawiaj URL ani znacznikow zrodel do mowionego tekstu.
Zwroc JSON: {"script":"<czysty tekst do TTS>","show_notes":[{"title":"...","url":"..."}]}`;

return [{
  json: {
    summaries,
    requestBody: {
      contents: [{ role: 'user', parts: [{ text: JSON.stringify({ summaries }) }] }],
      systemInstruction: { parts: [{ text: system }] },
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 16384,
        thinkingConfig: { thinkingBudget: 2048 },
        responseMimeType: 'application/json'
      }
    }
  }
}];
