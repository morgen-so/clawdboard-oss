import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

const isDev = process.env.NODE_ENV === "development";

export const env = createEnv({
  server: {
    DATABASE_URL: isDev
      ? z.string().url().default("postgresql://clawdboard:clawdboard@localhost:5432/clawdboard")
      : z.string().url(),
    AUTH_SECRET: isDev
      ? z.string().min(1).default("dev-secret-do-not-use-in-production!!")
      : z.string().min(32),
    AUTH_GITHUB_ID: isDev
      ? z.string().default("")
      : z.string().min(1),
    AUTH_GITHUB_SECRET: isDev
      ? z.string().default("")
      : z.string().min(1),
    CRON_SECRET: z.string().min(1).optional(),
    ADMIN_PASSWORD: z.string().min(1).optional(),
    // Public-data snapshot (src/lib/snapshot). Unset means every read is live.
    BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),
    SNAPSHOT_DIR: z.string().min(1).optional(),
  },
  client: {
    NEXT_PUBLIC_BASE_URL: z.string().url().default("http://localhost:3001"),
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
