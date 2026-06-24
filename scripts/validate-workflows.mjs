import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const requiredFiles = [
  'n8n-brief-audio-spec.md',
  '.env.example',
  'prompts/filter.md',
  'prompts/summarize.md',
  'prompts/script.md',
  'snippets/code/init-state.js',
  'snippets/code/build-source-urls.js',
  'snippets/code/parse-candidates.js',
  'snippets/code/enrich-hn.js',
  'snippets/code/enrich-yt.js',
  'snippets/code/poll-longaudio.js',
  'snippets/code/build-signed-url.js',
  'snippets/code/assemble-signed-url.js',
  'snippets/code/build-slack-digest.js',
  'snippets/code/commit-state.js',
  'snippets/code/fin-build-source-urls.js',
  'snippets/code/fin-parse-candidates.js',
  'snippets/code/fin-build-filter-input.js',
  'snippets/code/fin-enrich.js',
  'snippets/code/fin-build-script-input.js',
  'snippets/code/fin-build-slack-digest.js',
  'snippets/code/pod-build-script-input.js',
  'snippets/code/pod-parse-script.js',
  'snippets/code/pod-build-dialogue.js',
  'snippets/code/pod-build-slack-digest.js',
  'workflows/personal-audio-brief.json',
  'workflows/finance-brief.json',
  'workflows/finance-podcast.json'
];

// per-workflow required + banned node names (engine-agnostic: both pipelines expose a
// unified "Build TTS request" node regardless of TTS engine).
const workflowChecks = {
  'personal-audio-brief.json': { require: ['Post to ai-news', 'Build TTS request', 'Build signed url'], ban: ['Upload audio to S3', 'Build RSS', 'Respond RSS', 'Feed webhook', 'Smoke webhook', 'Post to finance-news'] },
  'finance-brief.json': { require: ['Post to finance-news', 'Build TTS request', 'Build signed url'], ban: ['Smoke webhook', 'Post to ai-news'] },
  'finance-podcast.json': { require: ['Post to podcast', 'Build TTS request', 'Dialogue TTS', 'Build signed url'], ban: ['Smoke webhook', 'Post to ai-news', 'Post to finance-news'] }
};

let failures = 0;

function fail(message) {
  failures += 1;
  console.error(`FAIL ${message}`);
}

for (const file of requiredFiles) {
  if (!existsSync(join(root, file))) fail(`missing ${file}`);
}

for (const workflowFile of Object.keys(workflowChecks)) {
  const workflowPath = join(root, 'workflows', workflowFile);
  if (!existsSync(workflowPath)) continue;
  const workflow = JSON.parse(readFileSync(workflowPath, 'utf8'));

  if (!workflow.name) fail(`${workflowFile}: missing name`);
  if (!Array.isArray(workflow.nodes) || workflow.nodes.length === 0) fail(`${workflowFile}: missing nodes`);
  if (!workflow.connections || typeof workflow.connections !== 'object') fail(`${workflowFile}: missing connections`);
  if (workflow.settings?.executionOrder !== 'v1') fail(`${workflowFile}: executionOrder must be v1`);

  const names = new Set(workflow.nodes.map(node => node.name));
  for (const [source, config] of Object.entries(workflow.connections || {})) {
    if (!names.has(source)) fail(`${workflowFile}: connection source not found: ${source}`);
    for (const output of config.main || []) {
      for (const target of output || []) {
        if (!names.has(target.node)) fail(`${workflowFile}: connection target not found: ${target.node}`);
      }
    }
  }

  for (const node of workflow.nodes) {
    if (!node.id || !node.name || !node.type || !node.typeVersion || !Array.isArray(node.position)) {
      fail(`${workflowFile}: invalid node shell for ${node.name || node.id || '<unknown>'}`);
    }
    if (node.type === 'n8n-nodes-base.code' && !node.parameters?.jsCode) {
      fail(`${workflowFile}: code node missing jsCode: ${node.name}`);
    }
  }

  if (JSON.stringify(workflow).includes('$env')) fail(`${workflowFile}: references $env (blocked on this n8n)`);
  for (const req of workflowChecks[workflowFile].require) {
    if (!names.has(req)) fail(`${workflowFile}: missing required node "${req}"`);
  }
  for (const banned of workflowChecks[workflowFile].ban) {
    if (names.has(banned)) fail(`${workflowFile}: contains banned node "${banned}"`);
  }
}

const envExample = readFileSync(join(root, '.env.example'), 'utf8');
for (const key of ['YT_CHANNEL_IDS', 'HN_TOPICS', 'INTEREST_PROFILE', 'AUDIO_BRIEF_GCP_PROJECT_ID', 'STORAGE_BUCKET', 'AUDIO_BRIEF_SIGNER_SA', 'TTS_VOICE', 'SLACK_CHANNEL_ID']) {
  if (!envExample.includes(`${key}=`)) fail(`.env.example missing ${key}`);
}

if (failures > 0) {
  process.exit(1);
}

console.log('workflow validation passed');
