# TODO: rozszerzyć podcast finansowy do 7-10 min (dwa głosy)

**Status (2026-06-25):** ODŁOŻONE (decyzja: zostajemy na ~5,5-6 min). Wrócić, gdy będzie większy
limit ElevenLabs.

## Cel
Dwugłosowy podcast finansowy (`finance-podcast.json`, wf `MmYZf4DBwLoKMrfT`, → #finance-news,
pon. 09:00) wydłużyć z obecnych **~5,5-6 min** do **7-10 min**, zachowując naturalny dialog
dwóch głosów (A = męski Daniel `onwK4e9ZLuTAKqWW03F9`, B = damski Sarah `EXAVITQu4vr4xnSDxMaL`).

## Stan obecny (działa)
- Jedno wywołanie **ElevenLabs Text-to-Dialogue** (`eleven_v3`) → jeden plik mp3, dwa głosy.
- Skrypt dialogu: Gemini 2.5 Pro, deterministyczna długość (`pod-build-script-input.js`:
  „DOKŁADNIE 20-24 wypowiedzi × 30-45 słów" ≈ 5,5 min).
- `pod-build-dialogue.js` tnie dialog do ≤4700 znaków (cap), bo API ma twardy limit.

## Dlaczego 7-10 min jest zablokowane (3 ściany — NIE odkrywać od nowa)
1. **Text-to-Dialogue ma limit 5000 znaków / request** → jedno wywołanie to maks ~6 min
   (`text_too_long` / `max_character_limit_exceeded`, „Please use Studio for long form TTS").
2. **ElevenLabs Studio API = tylko whitelist** → `403 invalid_subscription`
   („contact our sales team"). Niedostępne na Starterze ani przez zwykły upgrade.
3. **Sklejanie audio wewnątrz n8n niemożliwe** → ten n8n trzyma binaria na **dysku**
   (filesystem mode); w węźle Code `binary.audio.data` to NIE są bajty, a odczyt wymaga
   `$helpers.getBinaryDataBuffer` (zablokowane w sandboxie). Próba dała pusty 62-bajtowy WAV.
   Bajtowe sklejanie mp3 też nie działa (nagłówki ID3/Xing → odtwarzacz widzi tylko 1. fragment).

## Rekomendowana droga: GCS compose (bez nowej infry, bez ffmpeg, bezszwowo)
Zweryfikowane lokalnie: **surowy PCM łączy się bezszwowo** (headerless) → jeden WAV.
Sekwencja w n8n:
1. `pod-build-dialogue.js`: podziel dialog na segmenty ≤4700 zn., 1 item / segment.
2. Dialogue TTS per segment z `?output_format=pcm_24000`, Accept `audio/pcm` → surowy PCM,
   upload KAŻDEGO segmentu osobno do GCS (`seg_<ts>_<i>.pcm`) — to omija odczyt binariów w Code.
3. Zbierz rozmiary segmentów (z odpowiedzi upload `size`), zbuduj 44-bajtowy nagłówek WAV
   (PCM 16-bit mono 24000 Hz, `dataLen` = suma rozmiarów) w węźle Code (czyste bajty → base64,
   bez czytania binariów), upload jako `hdr_<ts>.wav`.
4. **`objects.compose`** (`POST .../b/<bucket>/o/<dest>/compose`, do 32 źródeł):
   `[hdr, seg_0, seg_1, ...]` → `fin_podcast_<ts>.wav`. Sprzątnij segmenty/nagłówek.
5. Reszta bez zmian: podpisany link + digest do #finance-news.
- Snapshot odrzuconej wersji segmentowej + `pod-concat-pcm.js` jest w historii gita gałęzi
  `feat/finance-podcast` (przed rewertem) — można podejrzeć logikę nagłówka WAV.

Alternatywa: mała usługa Cloud Run z ffmpeg (czyste, ale nowa infra na GCP).

## WARUNEK WSTĘPNY: limit ElevenLabs
- Plan **Starter = 33 702 znaki/mc** jest za mały na 3 cotygodniowe podcasty/briefy NA ElevenLabs,
  a tym bardziej na 7-10 min dialog (~9-11k zn./odcinek, eleven_v3 ~0,5 kredyta/znak).
- Najpierw **upgrade ElevenLabs** (np. Creator 100k/mc), potem budowa GCS-compose.
- Limit resetuje się ~11 lipca 2026.

## Pliki
`scripts/build-workflows.mjs` (sekcja „Finance podcast pipeline"),
`snippets/code/pod-build-script-input.js`, `pod-build-dialogue.js`, `pod-parse-script.js`,
`pod-build-slack-digest.js`. PR #3 (`feat/finance-podcast`).
