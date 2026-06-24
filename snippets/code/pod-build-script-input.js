// Two-host conversational finance podcast script (Polish). Produces a natural dialogue
// between a male host (A) and a female expert (B), in the style of a Polish economic podcast.
// NOTE: env access is blocked on this n8n -> literals.

const summaries = $input.all().map(item => item.json);
if (!summaries.length) throw new Error('No summaries available for podcast script');

const system = `Tworzysz odcinek PODCASTU EKONOMICZNEGO po polsku — naturalna rozmowe dwojga prowadzacych:
- A: GOSPODARZ (glos meski) — prowadzi, wprowadza tematy, dopytuje, syntetyzuje, reaguje.
- B: EKSPERTKA (glos damski) — analizuje, dodaje kontekst, liczby i konsekwencje, czasem polemizuje.
Styl jak dobry polski podcast ekonomiczny: swobodny ale merytoryczny, analityczny, konkretny, z danymi (liczby, procenty, nazwy spolek/instytucji). To ma byc PRAWDZIWA ROZMOWA — reaguja na siebie, dopytuja, rozwijaja watki, czasem sie nie zgadzaja — a nie dwa osobne monologi.
Struktura: krotkie intro (przywitanie + zapowiedz tematow) -> 3-5 tematow rynkowych wg waznosci, kazdy rozwijany w kilku wymianach zdan -> krotkie podsumowanie i pozegnanie.
DLUGOSC — TRZYMAJ SIE SCISLE: napisz DOKLADNIE 20-24 wypowiedzi (turns), naprzemiennie A i B. KAZDA wypowiedz ma miec 30-45 slow (2-4 zdania) — nie krotsze. To daje odcinek okolo 6 minut (~750-820 slow lacznie, max 4700 znakow). Wybierzcie 3-4 najwazniejsze tematy i rozwijajcie kazdy w 4-6 wymianach. Pierwsza wypowiedz to intro (przywitanie + zapowiedz), ostatnia to krotkie zamkniecie i pozegnanie.
Zasady twarde:
- Opieraj sie WYLACZNIE na dostarczonych punktach; nie zmyslaj faktow ani liczb; nie dodawaj wiedzy zewnetrznej.
- Nie podawaj porad inwestycyjnych ani rekomendacji kupna/sprzedazy.
- Kazda kwestia (turn) to jedna naturalna wypowiedz, 1-4 zdania; naprzemiennie A i B, ale nie sztywno.
- W polu "text" wpisz WYLACZNIE wypowiadane slowa — bez imion, didaskaliow, oznaczen mowcy czy URL.
Zwroc WYLACZNIE JSON: {"turns":[{"speaker":"A","text":"..."},{"speaker":"B","text":"..."}],"show_notes":[{"title":"...","url":"..."}]}`;

return [{
  json: {
    summaries,
    requestBody: {
      contents: [{ role: 'user', parts: [{ text: JSON.stringify({ summaries }) }] }],
      systemInstruction: { parts: [{ text: system }] },
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 16384,
        thinkingConfig: { thinkingBudget: 2048 },
        responseMimeType: 'application/json'
      }
    }
  }
}];
