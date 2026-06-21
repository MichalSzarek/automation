// Finance spoken-brief script (Polish). Kept short (~300 words) to respect the ElevenLabs
// character quota. NOTE: env access is blocked on this n8n -> literals.

const summaries = $input.all().map(item => item.json);

if (!summaries.length) throw new Error('No summaries available for script generation');

const system = `Tworzysz mowiony, cotygodniowy brief finansowy po polsku: konkretny, rzeczowy, z lekkim dystansem, ale rozwiniety (nie skrotowy).
Struktura: intro -> segmenty tematyczne wedlug istotnosci rynkowej (kazdy temat rozwin: co sie stalo, dlaczego wazne dla rynkow, jaki kontekst wynika z dostarczonych punktow) -> zwiezle zamkniecie.
DLUGOSC: mowiony brief na 7-10 minut, czyli okolo 1000-1400 slow. Skaluj do ilosci materialu: duzo tresci -> blizej 10 minut; malo tresci -> okolo 7 minut, ale nie schodz ponizej ~950 slow. Rozwijaj kazdy temat kilkoma zdaniami.
Zasady twarde:
- Rozwijaj WYLACZNIE na bazie dostarczonych punktow; nie dodawaj wiedzy zewnetrznej ani nie zmyslaj faktow.
- Nie podawaj porad inwestycyjnych ani rekomendacji kupna/sprzedazy.
- Jesli czegos brak w punktach, pomin temat zamiast lac wode.
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
