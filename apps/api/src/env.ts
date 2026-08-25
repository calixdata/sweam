import type { SessionUser } from '@sweam/shared';

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ENVIRONMENT: 'development' | 'production';
}

/** Hono generic: bindings plus the per-request variables middleware attaches. */
export type AppEnv = {
  Bindings: Env;
  Variables: {
    user: SessionUser | null;
  };
};
