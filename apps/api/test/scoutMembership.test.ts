import { describe, expect, it } from 'vitest';
import { daysAfter, describeMembership, membershipActiveSql } from '../src/lib/scoutMembership';

const NOW = '2026-10-05T20:00:00.000Z';

describe('describeMembership', () => {
  it('reports no membership when there is no row', () => {
    const m = describeMembership(
      { status: null, current_period_end: null, trial_end: null, stripe_subscription_id: null, beta_free: 0 },
      NOW,
    );
    expect(m.active).toBe(false);
    expect(m.reason).toBe('none');
    expect(m.hasCard).toBe(false);
  });

  it('a card-free first-50 free period is active until it ends', () => {
    const freeUntil = daysAfter(NOW, 90);
    const row = {
      status: 'active' as const,
      current_period_end: freeUntil,
      trial_end: freeUntil,
      stripe_subscription_id: null,
      beta_free: 1,
    };
    const during = describeMembership(row, NOW);
    expect(during.active).toBe(true);
    expect(during.inFreePeriod).toBe(true);
    expect(during.freeUntil).toBe(freeUntil);
    expect(during.betaFree).toBe(true);

    const after = describeMembership(row, daysAfter(NOW, 91));
    expect(after.active).toBe(false);
    expect(after.reason).toBe('ended');
    expect(after.inFreePeriod).toBe(false);
  });

  it('with a card on file the webhook status rules, not the period end', () => {
    const row = {
      status: 'active' as const,
      current_period_end: daysAfter(NOW, -1),
      trial_end: null,
      stripe_subscription_id: 'sub_123',
      beta_free: 0,
    };
    expect(describeMembership(row, NOW).active).toBe(true);
    expect(describeMembership({ ...row, status: 'past_due' }, NOW)).toMatchObject({
      active: false,
      reason: 'past_due',
    });
    expect(describeMembership({ ...row, status: 'canceled' }, NOW)).toMatchObject({
      active: false,
      reason: 'canceled',
    });
  });

  it('a complimentary membership with no end date stays active', () => {
    const m = describeMembership(
      { status: 'active', current_period_end: null, trial_end: null, stripe_subscription_id: null, beta_free: 0 },
      NOW,
    );
    expect(m.active).toBe(true);
    expect(m.inFreePeriod).toBe(false);
    expect(m.hasCard).toBe(false);
  });
});

describe('membershipActiveSql', () => {
  it('encodes the same rule for SQL callers', () => {
    const sql = membershipActiveSql('m');
    expect(sql).toContain("m.status = 'active'");
    expect(sql).toContain('m.stripe_subscription_id IS NOT NULL');
    expect(sql).toContain('m.current_period_end IS NULL');
    expect(sql).toContain("m.current_period_end > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
  });
});

describe('daysAfter', () => {
  it('adds whole days in ISO form', () => {
    expect(daysAfter(NOW, 90)).toBe('2027-01-03T20:00:00.000Z');
  });
});
