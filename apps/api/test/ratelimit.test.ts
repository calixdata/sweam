import { describe, expect, it } from 'vitest';
import {
  RATE_LIMITS,
  countRateLimit,
  enforceGlobalLoginCap,
  recordLoginFailure,
  recordRateLimit,
  windowStartS,
} from '../src/lib/ratelimit';

/**
 * A tiny in-memory stand-in for the D1 binding that honours the two statement
 * shapes the rate limiter uses: the upsert-returning-count and the read count.
 * Keyed by (bucket, window_start) exactly like the real table.
 */
function fakeDb(): D1Database {
  const counts = new Map<string, number>();
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const key = `${String(args[0])}|${String(args[1])}`;
          return {
            async first() {
              if (sql.includes('INSERT INTO rate_limits')) {
                const next = (counts.get(key) ?? 0) + 1;
                counts.set(key, next);
                return { count: next };
              }
              if (sql.includes('SELECT count')) {
                return counts.has(key) ? { count: counts.get(key) } : null;
              }
              return null;
            },
            async run() {
              return {};
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe('windowStartS', () => {
  it('floors a timestamp to its fixed window', () => {
    // 1000-second windows: 12:16:40 UTC epoch 44200 -> window 44000.
    expect(windowStartS(44_200_000, 1000)).toBe(44_000);
  });

  it('is stable within a window and advances exactly at the boundary', () => {
    const windowS = 900;
    const start = windowStartS(1_000_000_000_000, windowS);
    // Anchor at the window start itself so the in-window and boundary
    // assertions are exact.
    expect(windowStartS(start * 1000, windowS)).toBe(start);
    expect(windowStartS(start * 1000 + (windowS - 1) * 1000, windowS)).toBe(start);
    expect(windowStartS((start + windowS) * 1000, windowS)).toBe(start + windowS);
  });

  it('produces aligned windows for every configured rule', () => {
    const nowMs = 1_756_000_000_000;
    for (const rule of Object.values(RATE_LIMITS)) {
      const window = windowStartS(nowMs, rule.windowS);
      expect(window % rule.windowS).toBe(0);
      expect(window * 1000).toBeLessThanOrEqual(nowMs);
      expect((window + rule.windowS) * 1000).toBeGreaterThan(nowMs);
    }
  });

  it('keeps every rule budget positive and windowed', () => {
    for (const rule of Object.values(RATE_LIMITS)) {
      expect(rule.limit).toBeGreaterThan(0);
      expect(rule.windowS).toBeGreaterThanOrEqual(60);
    }
  });
});

describe('global login-failure cap (distributed brute-force)', () => {
  const NOW = 1_756_000_000_000;

  it('trips once failures across many distinct IPs exceed the global cap, while per-IP stays low', async () => {
    const db = fakeDb();
    const cap = RATE_LIMITS.loginFailGlobal.limit;

    // Each failed attempt comes from a DIFFERENT source IP, so no single IP gets
    // near its per-IP cap (30) — yet the global failure count climbs.
    for (let i = 0; i < cap; i++) {
      const perIp = await recordRateLimit(db, RATE_LIMITS.signinIp, `203.0.113.${i}`, NOW);
      expect(perIp).toBe(1); // distinct IP => first hit each time
      await recordLoginFailure(db, NOW);
    }

    expect(await countRateLimit(db, RATE_LIMITS.loginFailGlobal, 'all', NOW)).toBe(cap);
    // The distributed guard rejects the next sign-in before any password work.
    await expect(enforceGlobalLoginCap(db, NOW)).rejects.toBeTruthy();
  });

  it('allows sign-in while global failures stay under the cap', async () => {
    const db = fakeDb();
    await recordLoginFailure(db, NOW);
    await recordLoginFailure(db, NOW);
    await expect(enforceGlobalLoginCap(db, NOW)).resolves.toBeUndefined();
  });

  it('only failures count toward the global cap (successful sign-ins do not)', async () => {
    const db = fakeDb();
    // No recordLoginFailure calls => global count is zero => guard passes.
    expect(await countRateLimit(db, RATE_LIMITS.loginFailGlobal, 'all', NOW)).toBe(0);
    await expect(enforceGlobalLoginCap(db, NOW)).resolves.toBeUndefined();
  });
});
