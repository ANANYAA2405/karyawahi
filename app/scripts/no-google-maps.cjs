/**
 * Keep the browser walkthroughs off Google Maps.
 *
 * The app draws its maps on Google Maps when a browser key is configured. A walkthrough loads
 * many map pages, and every load spends the key's daily quota (Google's free "Demo Key" has a
 * small one), so these runs would use it up and then fail on Google's own error. Blocking the
 * script makes the app fall back to the plain map (MapLibre), which is what is tested.
 *
 *   KV_GOOGLE_MAPS=on node scripts/e2e.cjs     to test against Google Maps on purpose
 */
const GOOGLE = /^https:\/\/(maps\.googleapis\.com|maps\.gstatic\.com)\//;

function blockGoogleMaps(browser) {
  if (process.env.KV_GOOGLE_MAPS === 'on') return browser;
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (opts = {}, ...rest) => {
    const ctx = await newContext(process.env.KV_BLOCK_SW === '1' ? { ...opts, serviceWorkers: 'block' } : opts, ...rest);
    await ctx.route(GOOGLE, (route) => route.abort());
    return ctx;
  };
  return browser;
}

/** True for the console error a blocked Google Maps request leaves behind (not a fault of the app). */
function isBlockedGoogle(msg) {
  return process.env.KV_GOOGLE_MAPS !== 'on' && GOOGLE.test(msg.location?.().url ?? '');
}

module.exports = { blockGoogleMaps, isBlockedGoogle };
