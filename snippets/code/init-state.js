const s = $getWorkflowStaticData('global');
const now = Math.floor(Date.now() / 1000);
const lastRun = s.lastRun || (now - 7 * 24 * 3600);

s.pendingRun = now;

return [{
  json: {
    lastRun,
    now,
    cutoffIso: new Date(lastRun * 1000).toISOString()
  }
}];
