# Spec wykonawczy: osobisty brief audio w n8n (YouTube + HackerNews → ElevenLabs)

> **Uwaga (2026-06-21):** część *delivery* tego dokumentu (ElevenLabs TTS, upload S3, prywatny feed RSS)
> została zastąpiona wariantem GCP-native: Google Cloud TTS Long Audio → GCS → podpisany link + digest na
> Slack `#ai-news`. Aktualny kontrakt: [docs/superpowers/specs/2026-06-21-gcp-audio-brief-slack-design.md](./docs/superpowers/specs/2026-06-21-gcp-audio-brief-slack-design.md)
> oraz plan [docs/superpowers/plans/2026-06-21-gcp-audio-brief-slack.md](./docs/superpowers/plans/2026-06-21-gcp-audio-brief-slack.md).
> Etapy ingest/filter/summarize/script pozostają aktualne.

Dokument przeznaczony dla agentów implementujących. n8n jest **self-hosted** (Docker).
Konwencje: każda faza ma `Cel`, `Node'y`, `Parametry`, `I/O` (schemat danych), `Uwagi`.
Wszędzie gdzie pojawia się `{{...}}` to placeholder do dostarczenia przez użytkownika (patrz sekcja "Sekrety i dane wejściowe").

Korekta wersji API (stan: 2026-06): `scribe_v1` jest **deprecated** → używać `scribe_v2`.
TTS domyślny model `eleven_multilingual_v2` (limit ~10 000 znaków/żądanie, język polski wspierany).

---

## Sekrety i dane wejściowe (do dostarczenia przez użytkownika)

| Klucz | Opis | Wymagane |
|---|---|---|
| `YT_CHANNEL_IDS` | lista `channel_id` kanałów do analizy (np. `["UCxxxx","UCyyyy"]`) | tak |
| `HN_TOPICS` | lista słów kluczowych do HackerNews (np. `["LLM","inference","RAG"]`) | tak |
| `INTEREST_PROFILE` | opis tekstowy zainteresowań do promptu selekcji | tak |
| `LLM_API_KEY` + `LLM_MODEL_CHEAP` + `LLM_MODEL_STRONG` | klucz + nazwy modeli (tani do filtra/streszczeń, mocny do scenariusza) | tak |
| `ELEVENLABS_API_KEY` | nagłówek `xi-api-key` | tak |
| `ELEVENLABS_VOICE_ID` | id głosu (Voice Design lub klon własny — NIE klon cudzego głosu) | tak |
| `STORAGE_*` | dane do bucketa z publicznym HTTPS (S3/R2/MinIO) | tak (dla RSS) |
| `N8N_WEBHOOK_URL` | publiczny URL instancji n8n (serwowanie feedu) | tak (dla RSS) |
| `FEED_TOKEN` | losowy token w query string feedu (prywatność) | tak (dla RSS) |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | alternatywna dostawa | opcjonalnie |

YouTube auth: **niepotrzebny** dla podejścia RSS. OAuth2 + YouTube Data API v3 tylko gdyby
wymagane było auto-zaciąganie realnych subskrypcji konta (`subscriptions.list`, ~1 unit/wywołanie, quota 10k/dzień).

---

## FAZA 0 — Przygotowanie obrazu i środowiska (DevOps)

**Cel:** n8n z dostępem do `yt-dlp`, `ffmpeg` i (opcjonalnie) community node ElevenLabs.

**Kroki:**
1. Rozszerz obraz n8n (Dockerfile):
   ```dockerfile
   FROM n8nio/n8n
   USER root
   RUN apk add --no-cache python3 ffmpeg curl \
     && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
     && chmod a+rx /usr/local/bin/yt-dlp
   USER node
   ```
   (dla obrazu opartego na Debianie zamień `apk add` na `apt-get update && apt-get install -y`).
2. Zmienne środowiskowe n8n:
   - `WEBHOOK_URL={{N8N_WEBHOOK_URL}}` (konieczne do feedu RSS)
   - `N8N_ENCRYPTION_KEY=...` (stałe między restartami)
   - `EXECUTIONS_DATA_PRUNE=true` (higiena)
3. (Opcjonalnie) Zainstaluj community node: Settings → Community nodes → `n8n-nodes-elevenlabs`.
   Alternatywa bez instalacji: zwykły `HTTP Request` do API ElevenLabs (preferowane dla determinizmu — spec poniżej używa HTTP).
4. Utwórz credentiale w n8n:
   - `LLM` — Header Auth (`Authorization: Bearer {{LLM_API_KEY}}`) lub natywny credential providera.
   - `ElevenLabs` — Header Auth (`xi-api-key: {{ELEVENLABS_API_KEY}}`).
   - `Storage` — AWS S3 (działa też z R2/MinIO przez custom endpoint).
   - `Telegram` (jeśli używany).

**Walidacja fazy:** w kontenerze `yt-dlp --version` i `ffmpeg -version` zwracają wynik.

---

## FAZA 1 — Trigger i stan

**Cel:** uruchomienie cykliczne + okno czasowe "od ostatniego runu".

**Node'y:** `Schedule Trigger` → `Code (init-state)`.

**Parametry:**
- Schedule: cron, np. `0 7 * * 1` (poniedziałek 07:00).
- Code (init-state):
  ```js
  const s = $getWorkflowStaticData('global');
  const now = Math.floor(Date.now()/1000);
  const lastRun = s.lastRun || (now - 7*24*3600); // domyślnie 7 dni wstecz
  s.pendingRun = now; // zatwierdzimy na końcu workflow
  return [{ json: { lastRun, now, cutoffIso: new Date(lastRun*1000).toISOString() } }];
  ```

**I/O:** out → `{ lastRun:int(epoch), now:int(epoch), cutoffIso:string }`.

**Uwaga:** `lastRun` zatwierdzamy dopiero w FAZIE 9 (po sukcesie), żeby błąd nie "zjadł" okna.

---

## FAZA 2 — Ingest źródeł i normalizacja

**Cel:** zebrać świeże elementy z kanałów YT i z HN, znormalizować do wspólnego schematu, deduplikować.

### 2A. YouTube (RSS per kanał — bez auth)
**Node'y:** `Code (fanout-channels)` → `Split In Batches` → `RSS Read` → `Filter (data)` → `Set (normalize-yt)`.
- `Code (fanout-channels)`: z `{{YT_CHANNEL_IDS}}` generuje listę itemów `{ url: "https://www.youtube.com/feeds/videos.xml?channel_id=" + id }`.
- `RSS Read`: URL = `{{$json.url}}`.
- `Filter (data)`: `new Date($json.isoDate).getTime()/1000 > {{lastRun}}`.
- `Set (normalize-yt)` → schemat:
  ```json
  { "source":"yt", "id":"<videoId z guid>", "title":"<title>", "url":"<link>",
    "published":"<isoDate>", "channel":"<author>", "snippet":"<contentSnippet (opis)>" }
  ```
  (videoId można wyciąć z `guid` postaci `yt:video:VIDEOID`).

### 2B. HackerNews (Algolia — bez auth)
**Node'y:** `Code (fanout-topics)` → `Split In Batches` → `HTTP Request (hn-search)` → `Code (flatten+normalize-hn)`.
- `HTTP Request (hn-search)`: GET
  `https://hn.algolia.com/api/v1/search_by_date?tags=story&query={{$json.topic}}&numericFilters=points>{{HN_MIN_POINTS|default 50}},created_at_i>{{lastRun}}`
- `Code (flatten+normalize-hn)` → dla każdego `hits[]`:
  ```json
  { "source":"hn", "id":"<objectID>", "title":"<title>", "url":"<url lub HN item url>",
    "published":"<created_at>", "points":<points>, "objectID":"<objectID>", "snippet":"" }
  ```

### 2C. Scalenie + dedup
**Node'y:** `Merge (append)` (2A+2B) → `Code (dedup)`.
- `Code (dedup)`: deduplikuj po `url` i po `id`; odfiltruj `id` obecne w `staticData.seenIds` (zbiór już przetworzonych). Zwróć tablicę unikalnych itemów.

**I/O fazy:** tablica `Item[]` we wspólnym schemacie.

**Uwaga:** przy dużej liczbie tematów HN rozważ jeden zapytaniowy batch i lokalny filtr, by ograniczyć liczbę żądań.

---

## FAZA 3 — Selekcja trafności (tani LLM, pre-filtr)

**Cel:** wybrać top-N najtrafniejszych itemów; odrzucić szum/promo PRZED kosztowną transkrypcją.

**Node'y:** `Code (build-filter-input)` → `HTTP Request (LLM cheap)` → `Code (parse+select)`.

**Parametry — prompt (system):**
```
Jesteś filtrem treści dla codziennego briefu. Profil odbiorcy:
{{INTEREST_PROFILE}}
Otrzymasz listę pozycji (id, source, title, snippet). Zwróć WYŁĄCZNIE JSON:
{"selected":[{"id":"...","reason":"<max 12 słów>"}]}
Zasady: maksymalnie {{TOP_N|default 10}} pozycji; odrzuć materiały promocyjne,
clickbait, duplikaty tematyczne; preferuj zgodność z profilem. Bez komentarza poza JSON.
```
**Parametry — user message:** zserializowana lista `[{id, source, title, snippet}]`.

**I/O:** out → oryginalne itemy przefiltrowane do `selected.id`, z dołączonym `reason`.

**Uwaga:** wymuś JSON (`response_format` jeśli provider wspiera) i bezpieczny parse (try/catch, retry x1).

---

## FAZA 4 — Pogłębienie treści (tylko survivorzy)

**Cel:** pozyskać realną treść wybranych itemów.

### 4A. YouTube — transkrypt (najpierw napisy, fallback audio→Scribe)
**Node'y:** `Switch (source==yt)` → `Execute Command (captions)` → `IF (są napisy?)`
→ [tak] `Code (parse-vtt/srt)` / [nie] `Execute Command (audio)` → `HTTP Request (Scribe v2)`.

- `Execute Command (captions)`:
  ```
  yt-dlp --write-auto-subs --write-subs --sub-lang pl,en --skip-download \
    --convert-subs srt -o '/tmp/{{$json.id}}' 'https://www.youtube.com/watch?v={{$json.id}}' || true
  ```
- Jeśli plik `.srt` istnieje → `Code (parse-vtt/srt)` czyści znaczniki czasu → `transcript`.
- Fallback audio:
  ```
  yt-dlp -x --audio-format mp3 --audio-quality 5 -o '/tmp/{{$json.id}}.%(ext)s' \
    'https://www.youtube.com/watch?v={{$json.id}}'
  ```
- `HTTP Request (Scribe v2)`: POST `https://api.elevenlabs.io/v1/speech-to-text`
  - Header: `xi-api-key: {{ELEVENLABS_API_KEY}}`
  - Body: `multipart-form-data` → `model_id=scribe_v2`, `file=<binary /tmp/<id>.mp3>`, (opcj.) `language_code=pl`
  - Odpowiedź: `{ text: "<transkrypt>" }`.

### 4B. HackerNews — treść artykułu (+ opcjonalnie komentarze)
**Node'y:** `Switch (source==hn)` → `HTTP Request (fetch-article)` → `HTML (extract)` →
(opcj.) `HTTP Request (hn-item)`.
- `fetch-article`: GET `{{$json.url}}` (obsłuż błędy/paywall → pomiń, zostaw sam tytuł).
- `HTML (extract)`: wyciągnij główny tekst (selektor `article`/`main`, lub usługa readability).
- `hn-item` (opcj.): `https://hn.algolia.com/api/v1/items/{{$json.objectID}}` → top komentarze.

**I/O fazy:** itemy wzbogacone o `content` (transkrypt lub tekst artykułu).

**Uwaga (koszt/stabilność):** Scribe liczony per sekunda audio — limituj długość (np. obetnij audio >30 min). Napisy są darmowe, więc ścieżka "captions first" obniża koszt. Node `Execute Command` wymaga self-host (jest).

---

## FAZA 5 — Streszczenie per-item (tani LLM, token optimization)

**Cel:** zredukować surowe treści do faktów ZANIM trafią do modelu piszącego scenariusz.

**Node'y:** `Loop` → `HTTP Request (LLM cheap)` → `Code (collect)`.

**Prompt (system):**
```
Streść poniższą treść do 3–5 punktów faktograficznych. Zasady:
- TYLKO fakty obecne w treści; nie dodawaj wiedzy zewnętrznej; nie spekuluj.
- Każdy punkt zwięzły, konkretny (liczby/nazwy jeśli są).
Zwróć JSON: {"id":"{{id}}","source_url":"{{url}}","bullets":["...","..."]}.
```
**I/O:** tablica `{ id, source_url, bullets[] }` (zwięzła — kilkaset tokenów zamiast tysięcy).

**Uwaga:** to krok groundingu #1 i główny lever kosztowy promptów scenariusza.

---

## FAZA 6 — Scenariusz briefu (mocny LLM)

**Cel:** złożyć z punktów spójny, mówiony scenariusz w formacie użytkownika.

**Node'y:** `Code (aggregate-bullets)` → `HTTP Request (LLM strong)` → `Code (parse-script)`.

**Prompt (system):**
```
Tworzysz mówiony brief po polsku w stylu: zwięzły, konkretny, z lekkim dystansem (jak dobry
host podcastu ekonomiczno-technologicznego). Struktura: krótkie intro → segmenty tematyczne
uporządkowane wg ważności → zwięzłe zamknięcie. Długość docelowa: {{TARGET_WORDS|default 1000}} słów.
Zasady twarde:
- Używaj WYŁĄCZNIE dostarczonych punktów (bullets). Nie dodawaj faktów spoza nich.
- Jeśli czegoś brak w punktach — nie zmyślaj, pomiń.
- Nie wstawiaj URL ani znaczników źródeł do mówionego tekstu.
Zwróć JSON:
{"script":"<czysty tekst do TTS>",
 "show_notes":[{"title":"...","url":"..."}]}
```
**Parametry — user message:** zagregowane `bullets` + `source_url` per item.

**I/O:** `{ script:string, show_notes:[{title,url}] }`.

**Uwaga (limit TTS):** jeśli `script` > 9500 znaków, podziel na segmenty po zdaniach (patrz FAZA 7 — chunking z `previous_text`/`next_text`).

---

## FAZA 7 — TTS (ElevenLabs)

**Cel:** wygenerować MP3 głosem użytkownika.

**Node'y:** `Code (chunk-script)` → `Loop` → `HTTP Request (TTS)` → `Code (concat?)` → `ffmpeg (concat)`.

**HTTP Request (TTS):** POST `https://api.elevenlabs.io/v1/text-to-speech/{{ELEVENLABS_VOICE_ID}}`
- Headers: `xi-api-key: {{ELEVENLABS_API_KEY}}`, `Accept: audio/mpeg`, `Content-Type: application/json`
- Body:
  ```json
  {
    "text": "{{chunk}}",
    "model_id": "eleven_multilingual_v2",
    "language_code": "pl",
    "voice_settings": { "stability": 0.5, "similarity_boost": 0.8 },
    "previous_text": "{{poprzedni chunk lub ''}}",
    "next_text": "{{następny chunk lub ''}}"
  }
  ```
- Response: binary `audio/mpeg` → trzymaj jako binary property.

**Łączenie chunków (jeśli >1):** zapisz pliki do `/tmp`, połącz:
```
ffmpeg -f concat -safe 0 -i /tmp/list.txt -c copy /tmp/brief_{{now}}.mp3
```

**I/O:** binary `brief_<timestamp>.mp3`.

**Uwaga:** `previous_text`/`next_text` zapewniają płynne łączenie segmentów (intonacja na granicach).
Multilingual v2 ma limit ~10 000 znaków/żądanie. Dla niskiej latencji można rozważyć `eleven_flash_v2_5` (niższa jakość prozodii) — dla briefu offline preferuj `multilingual_v2`/`eleven_v3`.

---

## FAZA 8 — Dostawa

Wybierz jedną z opcji.

### 8A. Telegram (prosto)
**Node'y:** `Telegram (sendAudio)` — `chatId={{TELEGRAM_CHAT_ID}}`, binary = MP3, `caption` = lista `show_notes` (tytuł + URL).

### 8B. Prywatny feed RSS podcastu (rekomendowane)
**Krok 1 — upload MP3 (publiczny URL):**
`HTTP Request`/`AWS S3 (upload)` → bucket `{{STORAGE_*}}`, ACL public-read, zwróć
`enclosureUrl = {{STORAGE_PUBLIC_BASE}}/brief_<timestamp>.mp3`.

**Krok 2 — zapis epizodu do rejestru:** dopisz `{title, pubDate, enclosureUrl, length, descriptionHtml}`
do magazynu (np. JSON `feed/episodes.json` w buckecie lub tabela DB).

**Krok 3 — serwowanie feedu (osobny workflow):**
**Node'y:** `Webhook (GET /feed)` → `IF (token=={{FEED_TOKEN}})` → `Code (build-rss)` → `Respond to Webhook`.
- `Code (build-rss)` buduje RSS 2.0 + iTunes:
  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
   <channel>
    <title>Mój brief</title>
    <link>...</link>
    <description>Prywatny brief AI</description>
    <language>pl-pl</language>
    <itunes:explicit>false</itunes:explicit>
    <!-- per epizod: -->
    <item>
      <title>{{title}}</title>
      <pubDate>{{RFC822 date}}</pubDate>
      <enclosure url="{{enclosureUrl}}" length="{{bytes}}" type="audio/mpeg"/>
      <guid isPermaLink="false">{{timestamp}}</guid>
      <description>{{descriptionHtml z linkami show_notes}}</description>
    </item>
   </channel>
  </rss>
  ```
- `Respond to Webhook`: `Content-Type: application/rss+xml`.

**Subskrypcja:** w Pocket Casts/Apple Podcasts dodaj URL
`{{N8N_WEBHOOK_URL}}/webhook/feed?token={{FEED_TOKEN}}`.

---

## FAZA 9 — Stan, idempotencja, obserwowalność

**Cel:** nie przetwarzać dwa razy, nie tracić okna przy błędzie, alertować.

**Kroki:**
1. Po sukcesie dostawy: `Code (commit-state)`:
   ```js
   const s = $getWorkflowStaticData('global');
   s.lastRun = s.pendingRun;
   s.seenIds = [...new Set([...(s.seenIds||[]), ...processedIds])].slice(-2000);
   return [{json:{ok:true}}];
   ```
2. `Error Trigger` (osobny workflow) → `Telegram`/email z treścią błędu.
3. Guardraile kosztów: limit `TOP_N`, limit długości audio przed Scribe, log liczby znaków TTS (1 kredyt/znak).

---

## Kolejność uruchamiania i testy

1. FAZA 0 → walidacja `yt-dlp`/`ffmpeg`.
2. FAZA 1–2 osobno — sprawdź, że ingest zwraca znormalizowane itemy.
3. FAZA 3 na zrzucie z FAZY 2 — sprawdź sensowność selekcji.
4. FAZA 4 na 1 filmie YT (captions) i 1 z fallbackiem audio→Scribe.
5. FAZA 5–6 — sprawdź grounding (czy scenariusz nie zawiera faktów spoza bullets).
6. FAZA 7 na krótkim tekście — potem pełny scenariusz + chunking.
7. FAZA 8B — najpierw upload+publiczny URL, potem feed; subskrypcja w apce.
8. FAZA 9 — symuluj błąd (zły URL) i sprawdź, że `lastRun` się NIE commituje.

## Otwarte decyzje (do ustawienia)
- `TOP_N`, `HN_MIN_POINTS`, `TARGET_WORDS`, częstotliwość crona.
- Model TTS: `eleven_multilingual_v2` (jakość) vs `eleven_v3` (ekspresja, limit 3000 zn./żądanie → więcej chunków).
- Dostawa: 8A (Telegram) vs 8B (prywatny RSS).
- Język transkrypcji: stały `pl`/`en` vs auto-detekcja Scribe.
