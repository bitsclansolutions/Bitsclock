import { prisma } from "@/lib/prisma";

/** Insert a finished entry directly (bypasses the API rules; for setting up report data). */
export async function makeEntry(userId: string, startIso: string, minutes: number, opts: { billable?: boolean; projectId?: string | null; description?: string } = {}) {
  const startTime = new Date(startIso);
  const endTime = new Date(startTime.getTime() + minutes * 60_000);
  return prisma.timeEntry.create({
    data: {
      userId,
      startTime,
      endTime,
      durationSeconds: minutes * 60,
      billable: opts.billable ?? false,
      projectId: opts.projectId ?? null,
      description: opts.description ?? "",
    },
  });
}

export async function makeProject(opts: { name?: string; billable?: boolean; isArchived?: boolean; memberMode?: "all" | "selected"; kind?: "project" | "activity" } = {}) {
  return prisma.project.create({
    data: {
      name: opts.name ?? `Project ${Math.random().toString(36).slice(2, 8)}`,
      billable: opts.billable ?? true,
      isArchived: opts.isArchived ?? false,
      memberMode: opts.memberMode ?? "all",
      kind: opts.kind ?? "project",
    },
  });
}

/** ISO string n minutes from now. */
export const minutesFromNow = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
