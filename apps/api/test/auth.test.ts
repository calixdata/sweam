import { describe, expect, it } from 'vitest';
import { generateToken, hashPassword, sha256Hex, verifyPassword } from '../src/lib/auth';

describe('hashPassword / verifyPassword', () => {
  it('round-trips a correct password', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('incorrect horse', stored)).toBe(false);
  });

  it('produces unique salts, so identical passwords hash differently', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same-password', a)).toBe(true);
    expect(await verifyPassword('same-password', b)).toBe(true);
  });

  it('stores the versioned pbkdf2 format with the iteration count inline', async () => {
    const stored = await hashPassword('x'.repeat(8));
    const parts = stored.split('$');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('pbkdf2');
    expect(Number(parts[1])).toBeGreaterThanOrEqual(100_000);
  });

  it('rejects malformed or tampered stored values instead of throwing', async () => {
    expect(await verifyPassword('anything', '')).toBe(false);
    expect(await verifyPassword('anything', 'plaintext')).toBe(false);
    expect(await verifyPassword('anything', 'pbkdf2$notanumber$AAAA$BBBB')).toBe(false);
    expect(await verifyPassword('anything', 'pbkdf2$100000$!!!$???')).toBe(false);
  });
});

describe('generateToken', () => {
  it('produces url-safe tokens of at least 256 bits', () => {
    const token = generateToken();
    expect(token.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url, unpadded
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('does not repeat across draws', () => {
    const draws = new Set(Array.from({ length: 100 }, () => generateToken()));
    expect(draws.size).toBe(100);
  });
});

describe('sha256Hex', () => {
  it('matches the known SHA-256 test vector for "abc"', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
