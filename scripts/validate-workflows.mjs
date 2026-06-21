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
  'snippets/code/build-longaudio-request.js',
  'snippets/code/poll-longaudio.js',
  'snippets/code/build-signed-url.js',
  'snippets/code/assemble-signed-url.js',
  'snippets/code/build-slack-digest.js',
  'snippets/code/commit-state.js',
  'workflows/personal-audio-brief.json'
];

let failures = 0;

function fail(message) {
  failures += 1;
  console.error(`FAIL ${message}`);
}

for (const file of requiredFiles) {
  if (!existsSync(join(root, file))) fail(`missing ${file}`);
}

for (const workflowFile of ['personal-audio-brief.json']) {
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

  // GCP/Slack delivery shape: Slack node present, legacy ElevenLabs/S3/RSS nodes gone.
  if (!names.has('Post to ai-news')) fail(`${workflowFile}: missing Slack node "Post to ai-news"`);
  if (!names.has('TTS synthesize long')) fail(`${workflowFile}: missing Long Audio node "TTS synthesize long"`);
  for (const banned of ['ElevenLabs TTS', 'Upload audio to S3', 'Build RSS', 'Respond RSS', 'Feed webhook']) {
    if (names.has(banned)) fail(`${workflowFile}: still contains removed node "${banned}"`);
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
