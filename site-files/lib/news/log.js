'use strict';
// Structured one-line JSON logs: easy to filter in Vercel > Logs (search "automated-news").
function log(event, data = {}) {
  console.log(JSON.stringify({ scope: 'automated-news', event, at: new Date().toISOString(), ...data }));
}
function logError(event, err, data = {}) {
  console.error(JSON.stringify({ scope: 'automated-news', event, level: 'error', at: new Date().toISOString(),
    error: err && err.message ? err.message : String(err), ...data }));
}
module.exports = { log, logError };
