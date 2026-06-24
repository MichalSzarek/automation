const items = $input.all().map(item => item.json);

if (!items.length) throw new Error('No enriched items to summarize');

const system = `Stresc ponizsza tresc do 2-4 punktow faktograficznych.
Zasady:
- Tylko fakty merytoryczne obecne w tresci; nie dodawaj wiedzy zewnetrznej; nie spekuluj.
- POMIJAJ fragmenty sponsorskie, reklamowe, prosby o subskrypcje i linki.
- Pierwszy punkt ma byc trescia (o czym to jest) — NIGDY "film/material dostepny na kanale X". Jesli tresci jest malo, napisz jedno konkretne zdanie o temacie na bazie tytulu i opisu.
- Kazdy punkt zwiezly, konkretny; zachowaj liczby i nazwy, jesli sa.
Zwroc JSON: {"summaries":[{"id":"...","source_url":"...","title":"...","bullets":["...","..."]}]}`;

return [{
  json: {
    enrichedItems: items,
    requestBody: {
      contents: [{
        role: 'user',
        parts: [{
          text: JSON.stringify(items.map(({ id, source, title, url, content }) => ({
            id,
            source,
            title,
            source_url: url,
            content
          })))
        }]
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
