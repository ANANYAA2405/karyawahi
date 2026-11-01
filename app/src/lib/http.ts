/**
 * Request checks for the plain POST route handlers (sign-in, sign-out, language). Server
 * actions get Next's own Origin check; these handlers do not, so they call this instead.
 */

function requestHost(headers: Headers): string | null {
  return headers.get('x-forwarded-host') ?? headers.get('host');
}

/**
 * True when a browser was made to send this request from another site. Browsers attach
 * Origin to every form POST, and Sec-Fetch-Site to every request; a request with neither
 * comes from a script (the test suites), which no other site can make a visitor's browser send.
 */
export function isCrossSite(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (origin === 'null') return true;
  if (origin) {
    try { return new URL(origin).host !== requestHost(req.headers); } catch { return true; }
  }
  return req.headers.get('sec-fetch-site') === 'cross-site';
}

export function isHttps(headers: Headers, url?: string): boolean {
  if (headers.get('x-forwarded-proto') === 'https') return true;
  try { return url ? new URL(url).protocol === 'https:' : false; } catch { return false; }
}

/** A path on this site to send the user to, or the fallback. Refuses other hosts and the
 *  '//host' and '/\host' forms that browsers read as another site. */
export function localPath(target: string | null | undefined, fallback = '/'): string {
  if (!target || !target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) return fallback;
  return target;
}

/** The path of an absolute URL (such as a Referer) when it points at this site, else the fallback. */
export function sameSitePath(url: string | null, headers: Headers, fallback = '/'): string {
  if (!url) return fallback;
  try {
    const u = new URL(url);
    return u.host === requestHost(headers) ? localPath(u.pathname + u.search, fallback) : fallback;
  } catch {
    return fallback;
  }
}
