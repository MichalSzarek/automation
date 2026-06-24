// Finance filter: rank candidate items against a finance/markets interest profile.
// NOTE: env access is blocked on this n8n -> literals.

const items = $input.all().map(item => item.json);
const topN = 8;
const interestProfile = 'Inwestor/trader sledzacy rynki finansowe: akcje (GPW i rynki swiatowe), indeksy, makroekonomia, stopy procentowe i banki centralne (NBP, Fed, EBC), waluty (PLN, EUR, USD), surowce (ropa, zloto, gaz), obligacje, wyniki spolek, geopolityka wplywajaca na rynki. Preferuj konkret rynkowy i analize ponad clickbait, reklamy i tresci poradnikowe ogolne.';

if (!items.length) throw new Error('No candidate items found');

const system = `Jestes filtrem tresci dla cotygodniowego briefu finansowego. Profil odbiorcy:
${interestProfile}

Otrzymasz liste pozycji: id, source, title, snippet.
Zwroc wylacznie JSON:
{"selected":[{"id":"...","reason":"<max 12 slow>"}]}
Zasady: maksymalnie ${topN} pozycji; odrzuc reklamy, clickbait i duplikaty tematyczne; preferuj zgodnosc z profilem i swiezosc rynkowa. Bez komentarza poza JSON.`;

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
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingBudget: 0 },
        responseMimeType: 'application/json'
      }
    }
  }
}];
