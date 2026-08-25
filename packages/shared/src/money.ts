/**
 * Money math for the AVOD ledger. All amounts are integer millicents
 * (1/1000 of a cent): a CPM priced in cents means one impression earns
 * exactly `cpmCents` millicents, so the ledger never touches floating point
 * except at the display edge.
 */

/** The published split: creators keep 55% of ad revenue earned on their titles. */
export const CREATOR_REVENUE_SHARE = 0.55;

/** Payouts unlock at $10.00. */
export const MIN_PAYOUT_MILLICENTS = 10 * 100 * 1000;

/** One impression's gross revenue: cpm cents-per-thousand = millicents-per-one. */
export function impressionRevenueMillicents(cpmCents: number): number {
  return Math.max(0, Math.round(cpmCents));
}

export function creatorShareMillicents(cpmCents: number): number {
  return Math.round(impressionRevenueMillicents(cpmCents) * CREATOR_REVENUE_SHARE);
}

/** Display formatting: millicents to a dollar string. */
export function formatMillicents(millicents: number): string {
  return `$${(Math.max(0, millicents) / 100_000).toFixed(2)}`;
}
