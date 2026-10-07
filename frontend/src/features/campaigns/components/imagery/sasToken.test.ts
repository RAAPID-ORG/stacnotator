import { describe, expect, it } from 'vitest';
import { describeExpiry, expiresSoon, readSasToken } from './sasToken';

const NOW = new Date('2026-10-05T12:00:00Z');
const SAS = 'sv=2024-11-04&sr=c&sp=rl&se=2026-10-12T00:00:00Z&spr=https&sig=SECRET';
const with_ = (changes: Record<string, string | null>) => {
  const params = new URLSearchParams(SAS);
  for (const [k, v] of Object.entries(changes)) {
    if (v === null) params.delete(k);
    else params.set(k, v);
  }
  return params.toString();
};

describe('readSasToken', () => {
  it('accepts a read-only container token and reads its expiry', () => {
    const reading = readSasToken(`?${SAS}`, NOW);
    expect(reading).toEqual({ token: SAS, expiresAt: new Date('2026-10-12T00:00:00Z') });
  });

  it.each([
    ['a URL', `https://acct.blob.core.windows.net/c?${SAS}`, 'not a URL'],
    ['no signature', with_({ sig: null }), 'no signature'],
    ['write access', with_({ sp: 'rw' }), 'read'],
    ['an account SAS', with_({ ss: 'b', srt: 'sco' }), 'Account SAS'],
    ['plain http allowed', with_({ spr: 'https,http' }), 'HTTPS'],
    ['no expiry', with_({ se: null }), 'expiry'],
    ['an expired token', with_({ se: '2026-10-01T00:00:00Z' }), 'expired'],
  ])('refuses %s', (_, token, message) => {
    const reading = readSasToken(token, NOW);
    expect('error' in reading && reading.error).toContain(message);
  });
});

describe('expiry', () => {
  it('says when the token runs out and warns close to it', () => {
    expect(describeExpiry('2026-10-12T00:00:00Z', NOW)).toContain('in 6 days');
    expect(describeExpiry('2026-10-01T00:00:00Z', NOW)).toContain('expired');
    expect(expiresSoon('2026-10-12T00:00:00Z', NOW)).toBe(false);
    expect(expiresSoon('2026-10-07T00:00:00Z', NOW)).toBe(true);
    expect(expiresSoon(null, NOW)).toBe(false);
  });
});
