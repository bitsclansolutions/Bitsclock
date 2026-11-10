/**
 * Break-glass recovery for the single Administrator account (D-001).
 * Never exposed over HTTP: run it only from a machine that already has database access.
 *
 *   npm run admin:recover -- --email new-admin@example.com
 *
 * - One Administrator exists: sets its email (when --email is given) and a new password,
 *   reactivates it, ends every session and pending reset code, and writes an audit record.
 * - No Administrator exists: creates one with --email (required).
 * - More than one exists (legacy data): refuses and lists them; pass --keep <id> to choose.
 *
 * The new password comes from ADMIN_RECOVER_PASSWORD, or is generated and printed once.
 * DATABASE_URL decides which database is changed; the script prints the host and asks
 * for confirmation unless --yes is passed.
 */
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import bcrypt from "bcryptjs";
import { createPrismaClient } from "../src/lib/prisma";
import { ADMIN_ROLE_NAME } from "../src/lib/permissions";
import { emailField, passwordRule } from "../src/lib/validation";
import { generateTempPassword } from "../src/lib/password-reset";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function fail(message: string): never {
  console.error(`admin:recover refused: ${message}`);
  process.exit(1);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) fail("DATABASE_URL is not set.");
  const emailArg = arg("email");
  const email = emailArg ? emailField.safeParse(emailArg) : null;
  if (email && !email.success) fail("--email is not a valid address.");
  const supplied = process.env.ADMIN_RECOVER_PASSWORD;
  if (supplied && (!passwordRule.safeParse(supplied).success || supplied.length < 12)) fail("ADMIN_RECOVER_PASSWORD needs 12+ characters with a letter and a number.");
  const password = supplied ?? generateTempPassword(16);

  const host = new URL(url).hostname;
  if (!flag("yes")) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`This changes the Administrator account in the database at ${host}. Type RECOVER to continue: `);
    rl.close();
    if (answer.trim() !== "RECOVER") fail("not confirmed.");
  }

  const prisma = createPrismaClient(url);
  try {
    const role = await prisma.role.findUnique({ where: { name: ADMIN_ROLE_NAME } });
    if (!role) fail("the Administrator role doesn't exist. Run the migrations and `npm run db:seed` first.");
    const admins = await prisma.user.findMany({ where: { roleId: role.id }, select: { id: true, email: true, name: true } });
    const keep = arg("keep");
    let target: (typeof admins)[number] | undefined = admins[0];
    if (admins.length > 1) {
      target = admins.find((a) => a.id === keep);
      if (!target) {
        console.error("More than one Administrator exists (D-001 allows one):");
        for (const a of admins) console.error(`  ${a.id}  ${a.email}`);
        fail("pass --keep <id> to choose the account to recover. Move the others to another role from the Team page afterwards.");
      }
    }
    const hash = await bcrypt.hash(password, 10);

    const result = await prisma.$transaction(async (tx) => {
      if (!target) {
        if (!email) fail("no Administrator exists; pass --email to create one.");
        const taken = await tx.user.findUnique({ where: { email: email.data } });
        if (taken) fail("that email belongs to an existing member. Choose another address.");
        const created = await tx.user.create({ data: { email: email.data, name: "Workspace Admin", passwordHash: hash, roleId: role.id, jobTitle: "Administrator" } });
        await tx.auditLog.create({ data: { actorName: "Break-glass script", action: "admin.recover", targetType: "user", targetId: created.id, summary: `Created the Administrator account ${created.email}` } });
        return { email: created.email, created: true };
      }
      if (email && email.data !== target.email) {
        const taken = await tx.user.findUnique({ where: { email: email.data } });
        if (taken) fail("that email belongs to another member. Choose another address.");
      }
      const updated = await tx.user.update({
        where: { id: target.id },
        data: { passwordHash: hash, isActive: true, tokenVersion: { increment: 1 }, ...(email ? { email: email.data } : {}) },
      });
      await tx.refreshSession.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.passwordReset.deleteMany({ where: { userId: target.id, usedAt: null } });
      await tx.auditLog.create({
        data: {
          actorName: "Break-glass script",
          action: "admin.recover",
          targetType: "user",
          targetId: target.id,
          summary: `Recovered the Administrator account${email && email.data !== target.email ? ` (email ${target.email} → ${updated.email})` : ""}`,
        },
      });
      return { email: updated.email, created: false };
    });

    console.log(result.created ? "Administrator created." : "Administrator recovered. Every session was signed out.");
    console.log(`Sign in as ${result.email}`);
    if (!supplied) console.log(`Temporary password (shown once, change it from Profile after signing in): ${password}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
