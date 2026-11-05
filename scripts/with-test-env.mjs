#!/usr/bin/env node
// Runs a command with .env.test applied on top of the environment, after the safety
// check in test-env.mjs. Example: node scripts/with-test-env.mjs prisma db push
import { spawnSync } from "node:child_process";
import { loadTestEnv } from "./test-env.mjs";

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("Usage: node scripts/with-test-env.mjs <command> [...args]");
  process.exit(2);
}
const env = { ...process.env, ...loadTestEnv(), NODE_ENV: process.env.NODE_ENV ?? "test" };
const res = spawnSync(cmd, args, { stdio: "inherit", env, shell: process.platform === "win32" });
process.exit(res.status ?? 1);
