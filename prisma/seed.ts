/**
 * Seeds the system roles and the single Administrator. With SEED_DEMO=1 (never in
 * production) it also adds demo members, projects and two weeks of sample entries.
 * Safe to re-run: roles are upserted, an existing Administrator is never changed, and
 * sample entries are only added when the database has no projects.
 *
 * Required: SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD (no defaults; nothing is printed).
 * Demo data: SEED_DEMO=1 and SEED_DEMO_PASSWORD.
 *
 * Run: npm run db:seed
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { createPrismaClient } from "../src/lib/prisma";
import { ADMIN_ONLY_PERMISSIONS, ADMIN_ROLE_NAME, ALL_PERMISSIONS, DEFAULT_EMPLOYEE_PERMISSIONS, EMPLOYEE_ROLE_NAME } from "../src/lib/permissions";
import { emailField, passwordRule } from "../src/lib/validation";

const prisma = createPrismaClient();

function fail(message: string): never {
  console.error(`Seed refused: ${message}`);
  process.exit(1);
}

function config() {
  const email = emailField.safeParse(process.env.SEED_ADMIN_EMAIL ?? "");
  if (!email.success) fail("set SEED_ADMIN_EMAIL to the administrator's email.");
  const password = process.env.SEED_ADMIN_PASSWORD ?? "";
  if (!passwordRule.safeParse(password).success || password.length < 12) {
    fail("set SEED_ADMIN_PASSWORD to at least 12 characters with a letter and a number. There is no default.");
  }
  const demo = process.env.SEED_DEMO === "1";
  if (demo && process.env.NODE_ENV === "production") fail("SEED_DEMO=1 is not allowed when NODE_ENV=production.");
  const demoPassword = process.env.SEED_DEMO_PASSWORD ?? "";
  if (demo && (!passwordRule.safeParse(demoPassword).success || demoPassword.length < 12)) {
    fail("SEED_DEMO=1 needs SEED_DEMO_PASSWORD (at least 12 characters with a letter and a number).");
  }
  return { adminEmail: email.data, adminPassword: password, demo, demoPassword };
}

async function upsertRole(name: string, description: string, color: string, isSystem: boolean, permissions: string[]) {
  const role = await prisma.role.upsert({
    where: { name },
    create: { name, description, color, isSystem },
    update: { description, color, isSystem },
  });
  await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
  if (permissions.length) {
    await prisma.rolePermission.createMany({ data: permissions.map((permission) => ({ roleId: role.id, permission })) });
  }
  return role;
}

async function main() {
  const cfg = config();
  const admin = await upsertRole(ADMIN_ROLE_NAME, "Full access to everything.", "#0f172a", true, [...ALL_PERMISSIONS]);
  const employee = await upsertRole(EMPLOYEE_ROLE_NAME, "Tracks their own time and runs their own reports.", "#0d9488", true, [...DEFAULT_EMPLOYEE_PERMISSIONS]);

  // Exactly one Administrator (D-001): create it only when none exists, and never touch an existing one.
  const existingAdmin = await prisma.user.findFirst({ where: { roleId: admin.id } });
  if (existingAdmin) {
    console.log("An Administrator already exists; left unchanged.");
  } else {
    const taken = await prisma.user.findUnique({ where: { email: cfg.adminEmail } });
    if (taken) fail("SEED_ADMIN_EMAIL belongs to an existing non-admin member. Use another address or the admin:recover script.");
    await prisma.user.create({
      data: { email: cfg.adminEmail, name: "Workspace Admin", passwordHash: await bcrypt.hash(cfg.adminPassword, 10), roleId: admin.id, jobTitle: "Administrator" },
    });
    console.log("Administrator created.");
  }

  if (!cfg.demo) {
    console.log("Seed complete (no demo data; set SEED_DEMO=1 in a development database to add some).");
    return;
  }

  const manager = await upsertRole(
    "Manager",
    "Sees the whole team's time and reports, manages projects.",
    "#2563eb",
    false,
    ["time.track", "time.view_all", "projects.view", "projects.manage", "reports.view_own", "reports.view_all", "reports.export", "dashboard.team", "users.view"].filter(
      (p) => !(ADMIN_ONLY_PERMISSIONS as readonly string[]).includes(p),
    ),
  );

  const demoHash = await bcrypt.hash(cfg.demoPassword, 10);
  const people = [
    { email: "sara@bitsclock.com", name: "Sara Khan", jobTitle: "Project Manager", roleId: manager.id },
    { email: "ali@bitsclock.com", name: "Ali Raza", jobTitle: "Frontend Developer", roleId: employee.id },
    { email: "hina@bitsclock.com", name: "Hina Malik", jobTitle: "UI Designer", roleId: employee.id },
  ];
  const users = [];
  for (const p of people) {
    users.push(
      await prisma.user.upsert({
        where: { email: p.email },
        create: { ...p, passwordHash: demoHash },
        update: { name: p.name, jobTitle: p.jobTitle },
      }),
    );
  }

  const projectCount = await prisma.project.count();
  if (projectCount === 0) {
    const adminUser = await prisma.user.findFirst({ where: { roleId: admin.id } });
    const projects = await Promise.all(
      [
        { name: "Website Redesign", description: "Marketing site refresh: new landing pages, blog and pricing.", color: "#2563eb" },
        { name: "Mobile App", description: "iOS and Android client for the customer portal.", color: "#7c3aed" },
        { name: "Internal Tools", description: "Admin dashboards, automation scripts and reporting.", color: "#ea580c", billable: false },
        { name: "Client: Acme Corp", description: "Retainer work for Acme: support, fixes and small features.", color: "#16a34a" },
      ].map((p) => prisma.project.create({ data: { ...p, createdById: adminUser?.id } })),
    );
    // Non-project activities members can log time against.
    await Promise.all(
      [
        { name: "Lunch break", description: "Meal and rest breaks.", color: "#9aa39e", billable: false, kind: "activity" as const },
        { name: "Internal meeting", description: "Stand-ups, planning and company meetings.", color: "#64748b", billable: false, kind: "activity" as const },
      ].map((p) => prisma.project.create({ data: { ...p, createdById: adminUser?.id } })),
    );

    const tasks = [
      "Build login screen",
      "Fix checkout bug",
      "Design onboarding flow",
      "Write API docs",
      "Sprint planning",
      "Code review",
      "Client call",
      "Refactor reports module",
      "QA regression pass",
      "Update dependencies",
    ];

    const entries: { userId: string; projectId: string; description: string; startTime: Date; endTime: Date; durationSeconds: number; billable: boolean }[] = [];
    const now = new Date();
    for (let dayBack = 1; dayBack <= 14; dayBack++) {
      const day = new Date(now);
      day.setDate(now.getDate() - dayBack);
      if (day.getDay() === 0 || day.getDay() === 6) continue;
      for (const u of users) {
        let cursor = new Date(day);
        cursor.setHours(9, 0, 0, 0);
        const blocks = 2 + ((dayBack + u.name.length) % 3);
        for (let b = 0; b < blocks; b++) {
          const mins = 45 + ((dayBack * 7 + b * 13 + u.name.length) % 120);
          const start = new Date(cursor);
          const end = new Date(start.getTime() + mins * 60_000);
          const project = projects[(dayBack + b + u.name.length) % projects.length]!;
          entries.push({
            userId: u.id,
            projectId: project.id,
            description: tasks[(dayBack * 3 + b + u.name.length) % tasks.length]!,
            startTime: start,
            endTime: end,
            durationSeconds: mins * 60,
            billable: project.billable,
          });
          cursor = new Date(end.getTime() + 15 * 60_000);
        }
      }
    }
    await prisma.timeEntry.createMany({ data: entries });
    console.log(`Created ${projects.length} projects and ${entries.length} sample time entries.`);
  }

  console.log("Seed complete, with demo members sara@, ali@ and hina@bitsclock.com (password from SEED_DEMO_PASSWORD).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
