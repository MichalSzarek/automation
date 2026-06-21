// Emit one item per source URL (YouTube channel RSS + HackerNews Algolia query).
// Network is performed by the downstream "Fetch source" HTTP Request node so this
// stays inside the n8n Code-node sandbox (no $helpers).

function parseJsonEnv(name, fallback) {
  const raw = $env[name];
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${name} must be valid JSON: ${error.message}`);
  }
}

const lastRun = $('Init state').first().json.lastRun;

// Pre-resolved UC channel ids (handles are resolved once at setup, never at runtime).
const channelIds = parseJsonEnv('YT_CHANNEL_IDS', [
  'UCXUPKJO5MZQN11PqgIvyuvQ', // @AndrejKarpathy
  'UCYO_jab_esuFRV4b17AJtAw', // @3blue1brown
  'UCMLtBahI5DMrt0NPvDSoIRQ', // @MachineLearningStreetTalk
  'UCNJ1Ymd5yFuUPtn21xtRbbw', // @aiexplained-official
  'UCbfYPyITQ-7l4upoX8nvctg', // @TwoMinutePapers
  'UCMwVTLZIRRUyyVrkjDpn4pA', // @ColeMedin
  'UC_x36zCEGilGpB1m-V4gmjg', // @IndyDevDan
  'UCn8ujwUInbJkBhffxqAPBVQ', // @daveebbelaar
  'UCXZCJLdBC09xxGZ6gcdrc6A', // @OpenAI
  'UCP7jMXSY2xbc3KCAE0MHQ-A', // @GoogleDeepMind
  'UCrDwWp7EBBv4NwvScIpBDOA'  // @anthropic-ai
]);

const topics = parseJsonEnv('HN_TOPICS', [
  'MCP', 'Model Context Protocol', 'Claude Code', 'Cursor', 'AI Agent', 'Agentic',
  'Ollama', 'vLLM', 'llama.cpp', 'quantization', 'local LLM', 'fine-tune', 'LoRA',
  'DSPy', 'transformer', 'open weights', 'context window', 'RAG', 'vector database',
  'embedding', 'semantic search', 'GraphRAG', 'LLM eval', 'prompt injection',
  'LLM security', 'benchmark'
]);

const minPoints = Number($env.HN_MIN_POINTS || 50);

const out = [];

for (const cid of channelIds) {
  const id = String(cid || '').trim();
  if (!id.startsWith('UC')) continue; // UC ids only — handles must be pre-resolved
  out.push({ json: { kind: 'yt', url: `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(id)}` } });
}

for (const topic of topics) {
  const url = 'https://hn.algolia.com/api/v1/search_by_date'
    + `?tags=story&query=${encodeURIComponent(topic)}`
    + `&numericFilters=points>${minPoints},created_at_i>${lastRun}`;
  out.push({ json: { kind: 'hn', url } });
}

if (!out.length) throw new Error('No source URLs built (check YT_CHANNEL_IDS / HN_TOPICS)');

return out;
