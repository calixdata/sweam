import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Context } from 'hono';
import type { z } from 'zod';
import type { ApiErrorBody } from '@sweam/shared';

/**
 * Abort the request with a JSON error envelope. Every non-2xx response in the
 * API goes through here so clients can rely on `{ error: { code, message } }`.
 */
export function fail(status: ContentfulStatusCode, code: string, message: string): never {
  const body: ApiErrorBody = { error: { code, message } };
  throw new HTTPException(status, {
    res: Response.json(body, { status }),
  });
}

/** Parse and validate a JSON request body against a zod schema. */
export async function parseBody<S extends z.ZodTypeAny>(c: Context, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    fail(400, 'bad_json', 'Request body must be valid JSON.');
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first && first.path.length > 0 ? `${first.path.join('.')}: ` : '';
    fail(400, 'validation_failed', `${where}${first?.message ?? 'Invalid request body.'}`);
  }
  return result.data;
}

export function nowIso(): string {
  return new Date().toISOString();
}
