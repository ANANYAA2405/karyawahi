import { one } from './db';

/**
 * Where a piece of proof was handed in, judged by the server.
 *
 * The phone sends only what it measured: latitude, longitude and its own accuracy estimate,
 * read once at the moment the proof is handed in (nothing is tracked). The server looks up the
 * school's position, works out the distance itself and sets the status. A status sent in the
 * form is never read.
 *
 *   matched         within GPS_RADIUS_M (250 m) of the school
 *   outside_radius  further than that
 *   unavailable     no fix (location refused, switched off, timed out), no position on record
 *                   for the school, or a fix too rough to tell (accuracy worse than
 *                   GPS_MAX_ACCURACY_M) while not clearly far away
 *
 * 250 m covers a village school's campus and the lane outside it, plus the 20-50 m a cheap phone
 * usually reports outdoors. A rough fix (cell towers only, often 1-3 km indoors) cannot say a
 * person is at the school, so it is not counted as matched; but if even the far edge of its
 * error circle is more than 250 m from the school, the person is clearly away and it says so.
 *
 * School positions in the demo are simulated (geo_units, geometry_source 'simulated'), so the
 * classification is real arithmetic against made-up points.
 */

export const GPS_RADIUS_M = 250;
export const GPS_MAX_ACCURACY_M = 500;

export type GpsStatus = 'matched' | 'outside_radius' | 'unavailable';

export interface GpsFix { lat: number; lng: number; accuracy: number }

export interface GpsResult {
  status: GpsStatus;
  /** Why it is unavailable, for the record. */
  reason: 'no_fix' | 'no_school_position' | 'too_rough' | null;
  distance_m: number | null;
  fix: GpsFix | null;
}

/** Great-circle distance in metres (haversine, mean Earth radius). */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_008.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A fix from untrusted input, or null when it is missing or not a real coordinate. */
export function parseFix(lat: unknown, lng: unknown, accuracy: unknown): GpsFix | null {
  const num = (v: unknown) => (v === null || v === undefined || v === '' ? NaN : Number(v));
  const la = num(lat), ln = num(lng), ac = num(accuracy);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
  if (la === 0 && ln === 0) return null; // "null island": a phone that had no fix
  // A missing or nonsensical accuracy is treated as unknown, which counts as too rough.
  return { lat: la, lng: ln, accuracy: Number.isFinite(ac) && ac > 0 ? Math.min(ac, 1e7) : Infinity };
}

export function schoolPosition(schoolId: string | null | undefined): { lat: number; lng: number } | null {
  if (!schoolId) return null;
  try {
    const r = one<{ lat: number | null; lng: number | null }>(
      `select centroid_lat lat, centroid_lon lng from geo_units where id = ? and level = 'school'`, schoolId,
    );
    return r && r.lat !== null && r.lng !== null ? { lat: r.lat, lng: r.lng } : null;
  } catch {
    return null; // geo_units not created yet
  }
}

export function classifyFix(school: { lat: number; lng: number } | null, fix: GpsFix | null): GpsResult {
  if (!fix) return { status: 'unavailable', reason: 'no_fix', distance_m: null, fix: null };
  if (!school) return { status: 'unavailable', reason: 'no_school_position', distance_m: null, fix };
  const d = Math.round(distanceM(school, fix));
  if (d - fix.accuracy > GPS_RADIUS_M) return { status: 'outside_radius', reason: null, distance_m: d, fix };
  if (fix.accuracy > GPS_MAX_ACCURACY_M) return { status: 'unavailable', reason: 'too_rough', distance_m: d, fix };
  return { status: d <= GPS_RADIUS_M ? 'matched' : 'outside_radius', reason: null, distance_m: d, fix };
}
