/**
 * The phone's location, read once, at the moment proof is handed in. Browser only.
 *
 * Nothing watches the position and nothing is read in the background: this is called from the
 * submit handler and nowhere else. The browser asks the person the first time; if they say no,
 * or there is no fix within the timeout (indoors, GPS off), the proof is handed in without one
 * and the server records "not available". GPS works without mobile data, so a proof saved
 * offline still carries its fix.
 */
export type Fix =
  | { lat: number; lng: number; accuracy: number; error: null }
  | { lat: null; lng: null; accuracy: null; error: 'denied' | 'timeout' | 'unavailable' | 'unsupported' };

export function readLocation(timeoutMs = 12_000): Promise<Fix> {
  const none = (error: 'denied' | 'timeout' | 'unavailable' | 'unsupported'): Fix => ({ lat: null, lng: null, accuracy: null, error });
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(none('unsupported'));
  return new Promise((resolve) => {
    // getCurrentPosition's own timeout does not cover the time the permission prompt is open.
    const guard = setTimeout(() => resolve(none('timeout')), timeoutMs + 8_000);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(guard); resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, error: null }); },
      (e) => { clearTimeout(guard); resolve(none(e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable')); },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}
