// Commit the run window only after Slack delivery succeeded. Keeps lastRun + the rolling
// seenIds dedupe set. (Episode/RSS state was removed — Slack is the only delivery path.)

const s = $getWorkflowStaticData('global');
const fromSlack = $('Build Slack digest').first().json;
const processedIds = (fromSlack && fromSlack.processedIds) || [];

if (!s.pendingRun) throw new Error('pendingRun missing; refusing to commit lastRun');

s.lastRun = s.pendingRun;
s.seenIds = [...new Set([...(s.seenIds || []), ...processedIds])].slice(-2000);
delete s.pendingRun;

return [{ json: { ok: true, lastRun: s.lastRun, seenCount: s.seenIds.length } }];
