// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { GeoPoint, Timestamp } from 'firebase-admin/firestore';
import { decodeValue, encodeValue } from '../cloud/backupCodec';

describe('backup codec — JSON round trip is lossless', () => {
  it('Timestamp keeps nanoseconds', () => {
    const t = new Timestamp(1760000000, 123456789);
    const back = decodeValue(JSON.parse(JSON.stringify(encodeValue({ t })))) as { t: Timestamp };
    expect(back.t).toBeInstanceOf(Timestamp);
    expect(back.t.isEqual(t)).toBe(true);
  });
  it('GeoPoint, bytes, nested maps and arrays', () => {
    const v = { g: new GeoPoint(32.1, 34.8), b: Buffer.from([1, 2, 255]), n: { a: [1, 'x', null, { deep: true }] }, s: '₪' };
    const back = decodeValue(JSON.parse(JSON.stringify(encodeValue(v)))) as typeof v;
    expect(back.g.isEqual(v.g)).toBe(true);
    expect(Buffer.compare(back.b, v.b)).toBe(0);
    expect(back.n).toEqual(v.n);
    expect(back.s).toBe('₪');
  });
  it('a user map that carries the codec\'s own __ff tag survives as user data', () => {
    const v = { m: { __ff: 'ts', s: 1, n: 2, note: 'user data' } };
    const back = decodeValue(JSON.parse(JSON.stringify(encodeValue(v))));
    expect(back).toEqual(v);
    expect((back as { m: unknown }).m).not.toBeInstanceOf(Timestamp);
  });
});
