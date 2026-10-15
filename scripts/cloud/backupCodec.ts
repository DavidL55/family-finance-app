// Lossless JSON for Firestore values. Every non-JSON value becomes { "__ff": <kind>, ... }, and a
// USER map is wrapped as { "__ff": "map", v: {...} } only when it already has an "__ff" key — so
// user data can never be mistaken for an encoded value.
import { DocumentReference, GeoPoint, Timestamp, type Firestore } from 'firebase-admin/firestore';

const TAG = '__ff';

export function encodeValue(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Timestamp) return { [TAG]: 'ts', s: v.seconds, n: v.nanoseconds };
  if (v instanceof GeoPoint) return { [TAG]: 'geo', lat: v.latitude, lng: v.longitude };
  if (v instanceof DocumentReference) return { [TAG]: 'ref', path: v.path };
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return { [TAG]: 'bytes', b64: Buffer.from(v).toString('base64') };
  if (Array.isArray(v)) return v.map(encodeValue);
  const out = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, encodeValue(x)]));
  return TAG in out ? { [TAG]: 'map', v: out } : out;
}

export function decodeValue(v: unknown, db?: Firestore): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => decodeValue(x, db));
  const o = v as Record<string, unknown>;
  switch (o[TAG]) {
    case 'ts': return new Timestamp(o.s as number, o.n as number);
    case 'geo': return new GeoPoint(o.lat as number, o.lng as number);
    case 'bytes': return Buffer.from(o.b64 as string, 'base64');
    case 'ref':
      if (!db) throw new Error(`decoding a reference (${String(o.path)}) needs a Firestore instance`);
      return db.doc(o.path as string);
    case 'map': return Object.fromEntries(Object.entries(o.v as Record<string, unknown>).map(([k, x]) => [k, decodeValue(x, db)]));
    default: return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, decodeValue(x, db)]));
  }
}
