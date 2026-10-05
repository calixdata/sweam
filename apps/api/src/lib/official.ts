/**
 * Official accounts: Sweam's own account and flagship creators (Scion Saga).
 * The gates that exist to keep ordinary users honest do not apply to them:
 * rate limits, the Blu offer bar and Fund eligibility, the Blu switch
 * cooldown, review auto-hide, strike suspension, Blu delete locks, and the
 * normal upload cap. Admins keep their separate powers; "official" is about
 * the account's content, not the console.
 */
export async function isOfficialAccount(db: D1Database, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const row = await db
    .prepare('SELECT 1 AS x FROM users WHERE id = ? AND official = 1')
    .bind(userId)
    .first();
  return row !== null;
}
