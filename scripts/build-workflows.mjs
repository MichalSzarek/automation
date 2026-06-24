import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const snippet = name => readFileSync(join(root, 'snippets', 'code', name), 'utf8');

// ====================== TTS engine toggle (per pipeline) ======================
// Default voice for both podcasts is ElevenLabs. Switch a pipeline to Google
// Cloud TTS (Long Audio) by setting its engine to 'google', then rebuild + deploy.
const AI_TTS_ENGINE = 'elevenlabs';   // 'elevenlabs' | 'google'
const FIN_TTS_ENGINE = 'elevenlabs';  // 'elevenlabs' | 'google'
const AI_VOICE = 'onwK4e9ZLuTAKqWW03F9';   // ElevenLabs voice (Daniel - Steady Broadcaster)
const FIN_VOICE = 'onwK4e9ZLuTAKqWW03F9';  // ElevenLabs voice (Daniel - Steady Broadcaster)
const GOOGLE_VOICE = 'pl-PL-Wavenet-B';    // used when engine === 'google'
const ELEVEN_CRED_ID = 'Z3FR1wCa5D4NlRQo'; // n8n httpHeaderAuth "ElevenLabs API"
const STORAGE_BUCKET = 'dcs-ai-news-briefs';
const SIGNER_SA = 'maths-vm-sa@data-concept-studio.iam.gserviceaccount.com';

function codeNode(id, name, file, position) {
  return { id, name, type: 'n8n-nodes-base.code', typeVersion: 2, position,
    parameters: { mode: 'runOnceForAllItems', jsCode: snippet(file) } };
}
function codeNodeInline(id, name, jsCode, position) {
  return { id, name, type: 'n8n-nodes-base.code', typeVersion: 2, position,
    parameters: { mode: 'runOnceForAllItems', jsCode } };
}

// GCP access token from the GCE metadata service (no stored key, no token broker).
function tokenNode(id, name, position) {
  return {
    id, name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position,
    retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
    parameters: {
      method: 'GET',
      url: 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Metadata-Flavor', value: 'Google' }] },
      options: { response: { response: { responseFormat: 'json' } } }
    }
  };
}

function llmNode(id, name, position, modelEnv, requestNodeName, tokenNodeName) {
  // $env is blocked in this n8n (N8N_BLOCK_ENV_ACCESS_IN_NODE), so model/project are literal.
  const model = modelEnv === 'LLM_MODEL_STRONG' ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
  return {
    id, name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position,
    retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
    parameters: {
      method: 'POST',
      url: `https://aiplatform.googleapis.com/v1/projects/data-concept-studio/locations/global/publishers/google/models/${model}:generateContent`,
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'Authorization', value: `=Bearer {{$node["${tokenNodeName}"].json.access_token}}` },
        { name: 'Content-Type', value: 'application/json' } ] },
      sendBody: true, specifyBody: 'json',
      jsonBody: `={{JSON.stringify($node["${requestNodeName}"].json.requestBody)}}`,
      options: {}
    }
  };
}

// Build a straight chain of `main` connections from an ordered list of node names.
function connect(names) {
  const connections = {};
  for (let i = 0; i < names.length - 1; i += 1) {
    connections[names[i]] = { main: [[{ node: names[i + 1], type: 'main', index: 0 }]] };
  }
  return connections;
}

// ---------- TTS section (engine-aware): Parse script -> ... -> Build signed url ----------
// Both engines expose a "Build TTS request" node carrying { bucket, objectName, gcsUri,
// show_notes, generatedAt, ts, requestBody } so the shared signing/poll snippets work.

function elevenRequestCode(objectPrefix) {
  return `const input = $input.first().json;
const generatedAt = input.generatedAt || new Date().toISOString();
const ts = Math.floor(Date.parse(generatedAt) / 1000);
const bucket = '${STORAGE_BUCKET}';
const objectName = \`${objectPrefix}_\${ts}.mp3\`;
const MAX_CHARS = 9500; // safety cap (~10 min of audio)
let script = String(input.script || '').trim();
if (!script) throw new Error('No script text for TTS');
if (script.length > MAX_CHARS) {
  const head = script.slice(0, MAX_CHARS);
  const cut = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  script = cut > 400 ? head.slice(0, cut + 1) : head;
}
return [{ json: { script, chars: script.length, show_notes: input.show_notes || [], generatedAt, ts, bucket, objectName,
  gcsUri: \`gs://\${bucket}/\${objectName}\`,
  requestBody: { text: script, model_id: 'eleven_multilingual_v2', language_code: 'pl', voice_settings: { stability: 0.5, similarity_boost: 0.8 } } } }];
`;
}

function googleRequestCode(objectPrefix) {
  return `const input = $input.first().json;
const generatedAt = input.generatedAt || new Date().toISOString();
const ts = Math.floor(Date.parse(generatedAt) / 1000);
const bucket = '${STORAGE_BUCKET}';
const objectName = \`${objectPrefix}_\${ts}.wav\`;
const script = String(input.script || '').trim();
if (!script) throw new Error('No script text for TTS');
return [{ json: { script, show_notes: input.show_notes || [], generatedAt, ts, bucket, objectName,
  gcsUri: \`gs://\${bucket}/\${objectName}\`,
  requestBody: { input: { text: script }, voice: { languageCode: 'pl-PL', name: '${GOOGLE_VOICE}' }, audioConfig: { audioEncoding: 'LINEAR16' }, outputGcsUri: \`gs://\${bucket}/\${objectName}\` } } }];
`;
}

function ttsSection(engine, idp, objectPrefix, voice, x0) {
  if (engine === 'elevenlabs') {
    const nodes = [
      codeNodeInline(`${idp}-tts-req`, 'Build TTS request', elevenRequestCode(objectPrefix), [x0, 0]),
      tokenNode(`${idp}-token-upload`, 'Get GCP token upload', [x0 + 180, 0]),
      {
        id: `${idp}-elevenlabs`, name: 'ElevenLabs TTS', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4,
        position: [x0 + 360, 0], retryOnFail: true, maxTries: 2, waitBetweenTries: 3000,
        credentials: { httpHeaderAuth: { id: ELEVEN_CRED_ID, name: 'ElevenLabs API' } },
        parameters: {
          method: 'POST', url: `https://api.elevenlabs.io/v1/text-to-speech/${voice}`,
          authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
          sendHeaders: true,
          headerParameters: { parameters: [{ name: 'Accept', value: 'audio/mpeg' }, { name: 'Content-Type', value: 'application/json' }] },
          sendBody: true, specifyBody: 'json',
          jsonBody: '={{JSON.stringify($node["Build TTS request"].json.requestBody)}}',
          options: { response: { response: { responseFormat: 'file', outputPropertyName: 'audio' } } }
        }
      },
      {
        id: `${idp}-gcs-upload`, name: 'Upload to GCS', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4,
        position: [x0 + 540, 0], retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
        parameters: {
          method: 'POST',
          url: '={{"https://storage.googleapis.com/upload/storage/v1/b/" + $node["Build TTS request"].json.bucket + "/o?uploadType=media&name=" + encodeURIComponent($node["Build TTS request"].json.objectName)}}',
          sendHeaders: true,
          headerParameters: { parameters: [
            { name: 'Authorization', value: '=Bearer {{$node["Get GCP token upload"].json.access_token}}' },
            { name: 'Content-Type', value: 'audio/mpeg' } ] },
          sendBody: true, contentType: 'binaryData', inputDataFieldName: 'audio', options: {}
        }
      }
    ];
    const conns = {
      'Parse script': { main: [[{ node: 'Build TTS request', type: 'main', index: 0 }]] },
      'Build TTS request': { main: [[{ node: 'Get GCP token upload', type: 'main', index: 0 }]] },
      'Get GCP token upload': { main: [[{ node: 'ElevenLabs TTS', type: 'main', index: 0 }]] },
      'ElevenLabs TTS': { main: [[{ node: 'Upload to GCS', type: 'main', index: 0 }]] },
      'Upload to GCS': { main: [[{ node: 'Build signed url', type: 'main', index: 0 }]] }
    };
    return { nodes, conns };
  }

  // engine === 'google' : Cloud TTS Long Audio (writes WAV to GCS) + polled LRO
  const nodes = [
    codeNodeInline(`${idp}-tts-req`, 'Build TTS request', googleRequestCode(objectPrefix), [x0, 0]),
    tokenNode(`${idp}-token-tts`, 'Get GCP token tts', [x0 + 180, 0]),
    {
      id: `${idp}-tts-long`, name: 'TTS synthesize long', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4,
      position: [x0 + 360, 0], retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
      parameters: {
        method: 'POST',
        url: 'https://texttospeech.googleapis.com/v1/projects/data-concept-studio/locations/us:synthesizeLongAudio',
        sendHeaders: true,
        headerParameters: { parameters: [
          { name: 'Authorization', value: '=Bearer {{$node["Get GCP token tts"].json.access_token}}' },
          { name: 'Content-Type', value: 'application/json' } ] },
        sendBody: true, specifyBody: 'json',
        jsonBody: '={{JSON.stringify($node["Build TTS request"].json.requestBody)}}', options: {}
      }
    },
    { id: `${idp}-wait`, name: 'Wait for TTS', type: 'n8n-nodes-base.wait', typeVersion: 1.1,
      position: [x0 + 540, 0], webhookId: `${idp}-tts-wait`, parameters: { amount: 15, unit: 'seconds' } },
    tokenNode(`${idp}-token-op`, 'Get GCP token op', [x0 + 720, 0]),
    {
      id: `${idp}-op-get`, name: 'Operation get', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4,
      position: [x0 + 900, 0], retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
      parameters: {
        method: 'GET',
        url: '={{"https://texttospeech.googleapis.com/v1/" + ($node["TTS synthesize long"].json.name || $json.operationName)}}',
        sendHeaders: true,
        headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{$node["Get GCP token op"].json.access_token}}' }] },
        options: { response: { response: { responseFormat: 'json' } } }
      }
    },
    codeNode(`${idp}-poll`, 'Poll long audio', 'poll-longaudio.js', [x0 + 1080, 0]),
    {
      id: `${idp}-done`, name: 'TTS done?', type: 'n8n-nodes-base.if', typeVersion: 2.3, position: [x0 + 1260, 0],
      parameters: { conditions: {
        options: { caseSensitive: true, typeValidation: 'strict', leftValue: '', version: 2 },
        combinator: 'and',
        conditions: [{ id: 'done', leftValue: '={{$json.done}}', rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }] } }
    }
  ];
  const conns = {
    'Parse script': { main: [[{ node: 'Build TTS request', type: 'main', index: 0 }]] },
    ...connect(['Build TTS request', 'Get GCP token tts', 'TTS synthesize long', 'Wait for TTS', 'Get GCP token op', 'Operation get', 'Poll long audio', 'TTS done?']),
    'TTS done?': { main: [
      [{ node: 'Build signed url', type: 'main', index: 0 }], // true  -> sign
      [{ node: 'Wait for TTS', type: 'main', index: 0 }]      // false -> poll again
    ] }
  };
  return { nodes, conns };
}

// Shared signing + slack + commit nodes (post-TTS). slackNode is pipeline-specific.
function signSlackCommit(idp, slackPostName, slackDigestFile, x0) {
  return [
    codeNode(`${idp}-build-signed-url`, 'Build signed url', 'build-signed-url.js', [x0, -160]),
    tokenNode(`${idp}-token-sign`, 'Get GCP token sign', [x0 + 180, -160]),
    {
      id: `${idp}-sign-blob`, name: 'Sign blob', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4,
      position: [x0 + 360, -160], retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
      parameters: {
        method: 'POST',
        url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${SIGNER_SA}:signBlob`,
        sendHeaders: true,
        headerParameters: { parameters: [
          { name: 'Authorization', value: '=Bearer {{$node["Get GCP token sign"].json.access_token}}' },
          { name: 'Content-Type', value: 'application/json' } ] },
        sendBody: true, specifyBody: 'json',
        jsonBody: '={{JSON.stringify({ payload: $node["Build signed url"].json.payloadB64 })}}',
        options: { response: { response: { responseFormat: 'json' } } }
      }
    },
    codeNode(`${idp}-assemble-signed-url`, 'Assemble signed url', 'assemble-signed-url.js', [x0 + 540, -160]),
    codeNode(`${idp}-build-slack-digest`, 'Build Slack digest', slackDigestFile, [x0 + 720, -160]),
    {
      id: `${idp}-slack-post`, name: slackPostName, type: 'n8n-nodes-base.slack', typeVersion: 2.4,
      position: [x0 + 900, -160],
      credentials: { slackApi: { id: 'wzM8zIUgZuaGOwgg', name: 'MATHS Slack Bot' } },
      parameters: {
        resource: 'message', operation: 'post', select: 'channel',
        channelId: { __rl: true, mode: 'id', value: '={{$json.channel}}' },
        text: '={{$json.text}}',
        otherOptions: { unfurl_links: false, unfurl_media: false }
      }
    },
    codeNode(`${idp}-commit-state`, 'Commit state', 'commit-state.js', [x0 + 1080, -160])
  ];
}
function signSlackConns(slackPostName) {
  return connect(['Build signed url', 'Get GCP token sign', 'Sign blob', 'Assemble signed url', 'Build Slack digest', slackPostName, 'Commit state']);
}

// ============================== AI brief pipeline ==============================
const aiTts = ttsSection(AI_TTS_ENGINE, 'ai', 'brief', AI_VOICE, 2820);

const aiNodes = [
  { id: 'schedule', name: 'Weekly schedule', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.3,
    position: [-960, 0], parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 7 * * 1' }] } } },
  codeNode('init-state', 'Init state', 'init-state.js', [-780, 0]),
  codeNode('build-source-urls', 'Build source URLs', 'build-source-urls.js', [-600, 0]),
  {
    id: 'fetch-source', name: 'Fetch source', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4,
    position: [-420, 0], retryOnFail: true, maxTries: 3, waitBetweenTries: 2000, onError: 'continueRegularOutput',
    parameters: { method: 'GET', url: '={{$json.url}}',
      options: { response: { response: { responseFormat: 'text' } }, batching: { batch: { batchSize: 4, batchInterval: 500 } } } }
  },
  codeNode('parse-candidates', 'Parse candidates', 'parse-candidates.js', [-240, 0]),
  codeNode('build-filter-input', 'Build filter input', 'build-filter-input.js', [-60, 0]),
  tokenNode('gcp-token-filter', 'Get GCP token filter', [120, 0]),
  llmNode('llm-filter', 'LLM filter cheap', [300, 0], 'LLM_MODEL_CHEAP', 'Build filter input', 'Get GCP token filter'),
  codeNode('parse-select', 'Parse selected', 'parse-select.js', [480, 0]),
  {
    id: 'route-source', name: 'Route source', type: 'n8n-nodes-base.if', typeVersion: 2.3, position: [660, 0],
    parameters: { conditions: {
      options: { caseSensitive: true, typeValidation: 'strict', leftValue: '', version: 2 },
      combinator: 'and',
      conditions: [{ id: 'is-hn', leftValue: '={{$json.source}}', rightValue: 'hn', operator: { type: 'string', operation: 'equals' } }] } }
  },
  {
    id: 'fetch-article', name: 'Fetch article', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4,
    position: [840, -140], retryOnFail: true, maxTries: 2, waitBetweenTries: 2000, onError: 'continueRegularOutput',
    parameters: { method: 'GET', url: '={{$json.url}}', sendHeaders: true,
      headerParameters: { parameters: [{ name: 'User-Agent', value: 'audio-brief-bot/0.1' }] },
      options: { response: { response: { responseFormat: 'text' } }, timeout: 20000 } }
  },
  codeNode('enrich-hn', 'Enrich HN', 'enrich-hn.js', [1020, -140]),
  codeNode('enrich-yt', 'Enrich YT', 'enrich-yt.js', [840, 140]),
  { id: 'merge-enriched', name: 'Merge enriched', type: 'n8n-nodes-base.merge', typeVersion: 3.2, position: [1200, 0],
    parameters: { mode: 'append', numberInputs: 2 } },
  codeNode('build-summary-input', 'Build summary input', 'build-summary-input.js', [1380, 0]),
  tokenNode('gcp-token-summary', 'Get GCP token summary', [1560, 0]),
  llmNode('llm-summary', 'LLM summarize cheap', [1740, 0], 'LLM_MODEL_CHEAP', 'Build summary input', 'Get GCP token summary'),
  codeNode('parse-summaries', 'Parse summaries', 'parse-summaries.js', [1920, 0]),
  codeNode('build-script-input', 'Build script input', 'build-script-input.js', [2100, 0]),
  tokenNode('gcp-token-script', 'Get GCP token script', [2280, 0]),
  llmNode('llm-script', 'LLM script strong', [2460, 0], 'LLM_MODEL_STRONG', 'Build script input', 'Get GCP token script'),
  codeNode('parse-script', 'Parse script', 'parse-script.js', [2640, 0]),
  ...aiTts.nodes,
  ...signSlackCommit('ai', 'Post to ai-news', 'build-slack-digest.js', AI_TTS_ENGINE === 'google' ? 4260 : 3600)
];

const aiConnections = {
  ...connect(['Weekly schedule', 'Init state', 'Build source URLs', 'Fetch source', 'Parse candidates',
    'Build filter input', 'Get GCP token filter', 'LLM filter cheap', 'Parse selected']),
  'Parse selected': { main: [[{ node: 'Route source', type: 'main', index: 0 }]] },
  'Route source': { main: [
    [{ node: 'Fetch article', type: 'main', index: 0 }], // true (hn)
    [{ node: 'Enrich YT', type: 'main', index: 0 }]       // false (yt)
  ] },
  'Fetch article': { main: [[{ node: 'Enrich HN', type: 'main', index: 0 }]] },
  'Enrich HN': { main: [[{ node: 'Merge enriched', type: 'main', index: 0 }]] },
  'Enrich YT': { main: [[{ node: 'Merge enriched', type: 'main', index: 1 }]] },
  'Merge enriched': { main: [[{ node: 'Build summary input', type: 'main', index: 0 }]] },
  ...connect(['Build summary input', 'Get GCP token summary', 'LLM summarize cheap', 'Parse summaries',
    'Build script input', 'Get GCP token script', 'LLM script strong', 'Parse script']),
  ...aiTts.conns,
  ...signSlackConns('Post to ai-news')
};

const aiWorkflow = {
  name: 'AI News Brief - GCS + Slack',
  nodes: aiNodes,
  connections: aiConnections,
  settings: { executionOrder: 'v1', timezone: 'Europe/Warsaw', saveDataErrorExecution: 'all', saveDataSuccessExecution: 'none' }
};

mkdirSync(join(root, 'workflows'), { recursive: true });
writeFileSync(join(root, 'workflows', 'personal-audio-brief.json'), `${JSON.stringify(aiWorkflow, null, 2)}\n`);
console.log(`built workflows/personal-audio-brief.json (TTS: ${AI_TTS_ENGINE})`);

// ============================== Finance brief pipeline ==============================
// Sources: 3 PL finance YouTube channels + Bankier.pl/MarketWatch RSS.
const finTts = ttsSection(FIN_TTS_ENGINE, 'fin', 'fin_brief', FIN_VOICE, 2200);

const finNodes = [
  { id: 'fin-schedule', name: 'Weekly schedule', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.3,
    position: [-1040, 0], parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 8 * * 1' }] } } },
  codeNode('fin-init-state', 'Init state', 'init-state.js', [-860, 0]),
  codeNode('fin-build-source-urls', 'Build source URLs', 'fin-build-source-urls.js', [-680, 0]),
  {
    id: 'fin-fetch-source', name: 'Fetch source', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4,
    position: [-500, 0], retryOnFail: true, maxTries: 3, waitBetweenTries: 2000, onError: 'continueRegularOutput',
    parameters: { method: 'GET', url: '={{$json.url}}', sendHeaders: true,
      headerParameters: { parameters: [{ name: 'User-Agent', value: 'finance-brief-bot/0.1' }] },
      options: { response: { response: { responseFormat: 'text' } }, batching: { batch: { batchSize: 3, batchInterval: 500 } } } }
  },
  codeNode('fin-parse-candidates', 'Parse candidates', 'fin-parse-candidates.js', [-320, 0]),
  codeNode('fin-build-filter-input', 'Build filter input', 'fin-build-filter-input.js', [-140, 0]),
  tokenNode('fin-token-filter', 'Get GCP token filter', [40, 0]),
  llmNode('fin-llm-filter', 'LLM filter cheap', [220, 0], 'LLM_MODEL_CHEAP', 'Build filter input', 'Get GCP token filter'),
  codeNode('fin-parse-select', 'Parse selected', 'parse-select.js', [400, 0]),
  codeNode('fin-enrich', 'Enrich', 'fin-enrich.js', [580, 0]),
  codeNode('fin-build-summary-input', 'Build summary input', 'build-summary-input.js', [760, 0]),
  tokenNode('fin-token-summary', 'Get GCP token summary', [940, 0]),
  llmNode('fin-llm-summary', 'LLM summarize cheap', [1120, 0], 'LLM_MODEL_CHEAP', 'Build summary input', 'Get GCP token summary'),
  codeNode('fin-parse-summaries', 'Parse summaries', 'parse-summaries.js', [1300, 0]),
  codeNode('fin-build-script-input', 'Build script input', 'fin-build-script-input.js', [1480, 0]),
  tokenNode('fin-token-script', 'Get GCP token script', [1660, 0]),
  llmNode('fin-llm-script', 'LLM script strong', [1840, 0], 'LLM_MODEL_STRONG', 'Build script input', 'Get GCP token script'),
  codeNode('fin-parse-script', 'Parse script', 'parse-script.js', [2020, 0]),
  ...finTts.nodes,
  ...signSlackCommit('fin', 'Post to finance-news', 'fin-build-slack-digest.js', FIN_TTS_ENGINE === 'google' ? 3640 : 2980)
];

const finConnections = {
  ...connect(['Weekly schedule', 'Init state', 'Build source URLs', 'Fetch source', 'Parse candidates',
    'Build filter input', 'Get GCP token filter', 'LLM filter cheap', 'Parse selected', 'Enrich',
    'Build summary input', 'Get GCP token summary', 'LLM summarize cheap', 'Parse summaries',
    'Build script input', 'Get GCP token script', 'LLM script strong', 'Parse script']),
  ...finTts.conns,
  ...signSlackConns('Post to finance-news')
};

const finWorkflow = {
  name: 'Finance Brief - GCS + Slack',
  nodes: finNodes,
  connections: finConnections,
  settings: { executionOrder: 'v1', timezone: 'Europe/Warsaw', saveDataErrorExecution: 'all', saveDataSuccessExecution: 'none' }
};

writeFileSync(join(root, 'workflows', 'finance-brief.json'), `${JSON.stringify(finWorkflow, null, 2)}\n`);
console.log(`built workflows/finance-brief.json (TTS: ${FIN_TTS_ENGINE})`);
