import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma CLI configuration (Prisma 7). The CLI always uses the direct (non-pooled)
// connection: migrations can't run through the transaction pooler. The app itself
// connects with DATABASE_URL in src/lib/prisma.ts.
// dotenv never overrides variables that are already set, so the test runner's
// .env.test values win over .env.
// The URL is only required by commands that connect (migrate, studio, db seed): a fresh
// clone or a CI install runs `prisma generate` without any database variables.
const directUrl = process.env.DIRECT_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  ...(directUrl ? { datasource: { url: directUrl } } : {}),
});
