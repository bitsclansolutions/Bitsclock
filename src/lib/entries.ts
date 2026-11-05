import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { ApiError } from "./api";
import { hasPermission, type SessionUser } from "./auth";

type Db = Prisma.TransactionClient;

/**
 * Run `fn` in a transaction that holds a per-user advisory lock, so two concurrent
 * writes for the same member (double-clicked Start, a retry racing the original, two
 * tabs) are serialised and the overlap / single-timer rules hold under load.
 */
async function withUserLock<T>(userId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      return fn(tx as unknown as Db);
    },
    { maxWait: 10_000, timeout: 20_000 },
  );
}

export const entryInclude = {
  project: { select: { id: true, name: true, color: true, isArchived: true, billable: true } },
  user: { select: { id: true, name: true } },
} as const;

type EntryRow = {
  id: string;
  userId: string;
  projectId: string | null;
  description: string;
  startTime: Date;
  endTime: Date | null;
  durationSeconds: number | null;
  billable: boolean;
  createdAt: Date;
  updatedAt: Date;
  project: { id: string; name: string; color: string; isArchived: boolean; billable: boolean } | null;
  user: { id: string; name: string };
};

export type EntryDTO = {
  id: string;
  userId: string;
  user: { id: string; name: string };
  projectId: string | null;
  project: { id: string; name: string; color: string; isArchived: boolean; billable: boolean } | null;
  description: string;
  startTime: string;
  endTime: string | null;
  durationSeconds: number;
  billable: boolean;
  running: boolean;
  createdAt: string;
  updatedAt: string;
};

export function serializeEntry(e: EntryRow): EntryDTO {
  return {
    id: e.id,
    userId: e.userId,
    user: e.user,
    projectId: e.projectId,
    project: e.project,
    description: e.description,
    startTime: e.startTime.toISOString(),
    endTime: e.endTime ? e.endTime.toISOString() : null,
    durationSeconds: e.durationSeconds ?? 0,
    billable: e.billable,
    running: e.endTime === null,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

const MAX_ENTRY_HOURS = 24;

export function parseWhen(value: string, label: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ApiError(400, `${label} is not a valid date.`);
  return d;
}

/**
 * The project must exist, be active, and allow `userId` to log time (open to
 * everyone, or `userId` is a selected member). Returns the project, or null
 * when no project was given.
 */
async function assertProjectUsable(db: Db, projectId: string | null | undefined, userId: string) {
  if (!projectId) return null;
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: { members: { where: { userId }, select: { userId: true } } },
  });
  if (!project) throw new ApiError(404, "Project not found.");
  if (project.isArchived) throw new ApiError(409, `"${project.name}" is archived. Restore it to log time on it.`);
  if (project.memberMode === "selected" && project.members.length === 0) {
    throw new ApiError(403, `Not on the team for "${project.name}". Ask an administrator to add you to the project.`);
  }
  return project;
}

/** Throws 409 if [start, end) overlaps another of the user's entries (running timer included). */
async function assertNoOverlap(db: Db, userId: string, start: Date, end: Date, excludeId?: string) {
  const clash = await db.timeEntry.findFirst({
    where: {
      userId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      startTime: { lt: end },
      OR: [{ endTime: { gt: start } }, { endTime: null }],
    },
    select: { description: true, startTime: true, endTime: true, project: { select: { name: true } } },
  });
  if (clash) {
    const what = clash.description || clash.project?.name || "another entry";
    const kind = clash.endTime ? "overlaps" : "runs into your running timer";
    throw new ApiError(409, `This time range ${kind}: "${what}".`);
  }
}

function assertRange(start: Date, end: Date) {
  if (end <= start) throw new ApiError(400, "End time must be after the start time.");
  if (end.getTime() - start.getTime() > MAX_ENTRY_HOURS * 3600_000) {
    throw new ApiError(400, `A single entry can't be longer than ${MAX_ENTRY_HOURS} hours.`);
  }
  if (end.getTime() > Date.now() + 60_000) throw new ApiError(400, "End time can't be in the future.");
}

export async function getActiveEntry(userId: string) {
  const e = await prisma.timeEntry.findFirst({ where: { userId, endTime: null }, include: entryInclude });
  return e ? serializeEntry(e) : null;
}

export async function startTimer(userId: string, data: { description: string; projectId?: string | null; billable?: boolean }) {
  return withUserLock(userId, async (db) => {
    const active = await db.timeEntry.findFirst({ where: { userId, endTime: null } });
    if (active) throw new ApiError(409, "You already have a timer running. Stop it first.");
    const project = await assertProjectUsable(db, data.projectId, userId);
    const e = await db.timeEntry.create({
      data: {
        userId,
        description: data.description,
        projectId: project?.id ?? null,
        billable: data.billable ?? project?.billable ?? false,
        startTime: new Date(),
      },
      include: entryInclude,
    });
    return serializeEntry(e);
  });
}

export async function stopTimer(actor: SessionUser, entryId: string) {
  const owner = await prisma.timeEntry.findUnique({ where: { id: entryId }, select: { userId: true } });
  if (!owner) throw new ApiError(404, "Timer not found.");
  return withUserLock(owner.userId, async (db) => {
    const e = await db.timeEntry.findUnique({ where: { id: entryId } });
    if (!e) throw new ApiError(404, "Timer not found.");
    if (e.userId !== actor.id && !hasPermission(actor, "time.manage_all")) throw new ApiError(403, "That timer isn't yours.");
    if (e.endTime) throw new ApiError(409, "This timer has already been stopped.");
    const end = new Date();
    const duration = Math.max(1, Math.round((end.getTime() - e.startTime.getTime()) / 1000));
    const updated = await db.timeEntry.update({
      where: { id: entryId },
      data: { endTime: end, durationSeconds: duration },
      include: entryInclude,
    });
    return serializeEntry(updated);
  });
}

type ManualEntryInput = { description: string; projectId?: string | null; billable?: boolean; startTime: string; endTime: string };

/** Validate and insert one manual entry inside an open transaction (caller holds the user lock). */
async function insertManualEntry(db: Db, userId: string, data: ManualEntryInput) {
  const start = parseWhen(data.startTime, "Start time");
  const end = parseWhen(data.endTime, "End time");
  assertRange(start, end);
  const project = await assertProjectUsable(db, data.projectId, userId);
  await assertNoOverlap(db, userId, start, end);
  const e = await db.timeEntry.create({
    data: {
      userId,
      description: data.description,
      projectId: project?.id ?? null,
      billable: data.billable ?? project?.billable ?? false,
      startTime: start,
      endTime: end,
      durationSeconds: Math.round((end.getTime() - start.getTime()) / 1000),
    },
    include: entryInclude,
  });
  return serializeEntry(e);
}

export async function createManualEntry(userId: string, data: ManualEntryInput) {
  return withUserLock(userId, (db) => insertManualEntry(db, userId, data));
}

/**
 * Bulk insert. Atomic: one transaction, any invalid row rejects the whole batch with its
 * index. Non-atomic: each row in its own transaction, valid rows are kept and the failures
 * are reported per index. Rows are processed in start-time order so overlaps inside the
 * batch are caught the same way as overlaps with existing entries.
 */
export async function createManualEntries(userId: string, items: ManualEntryInput[], atomic: boolean) {
  const ordered = items.map((item, index) => ({ item, index })).sort((a, b) => a.item.startTime.localeCompare(b.item.startTime));
  const created: { index: number; entry: EntryDTO }[] = [];
  const errors: { index: number; message: string }[] = [];
  if (atomic) {
    try {
      const rows = await withUserLock(userId, async (db) => {
        const out: { index: number; entry: EntryDTO }[] = [];
        for (const { item, index } of ordered) {
          try {
            out.push({ index, entry: await insertManualEntry(db, userId, item) });
          } catch (e) {
            if (e instanceof ApiError) throw new ApiError(e.status, `Entry ${index + 1}: ${e.message}`);
            throw e;
          }
        }
        return out;
      });
      created.push(...rows);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw e;
    }
  } else {
    for (const { item, index } of ordered) {
      try {
        created.push({ index, entry: await withUserLock(userId, (db) => insertManualEntry(db, userId, item)) });
      } catch (e) {
        errors.push({ index, message: e instanceof ApiError ? e.message : "Couldn't save this entry." });
      }
    }
  }
  created.sort((a, b) => a.index - b.index);
  return { created, errors };
}

export async function updateEntry(
  actor: SessionUser,
  entryId: string,
  data: { description?: string; projectId?: string | null; billable?: boolean; startTime?: string; endTime?: string },
) {
  const owner = await prisma.timeEntry.findUnique({ where: { id: entryId }, select: { userId: true } });
  if (!owner) throw new ApiError(404, "Time entry not found.");
  if (owner.userId !== actor.id && !hasPermission(actor, "time.manage_all")) throw new ApiError(403, "You can only edit your own entries.");
  return withUserLock(owner.userId, (db) => applyUpdate(db, entryId, data));
}

async function applyUpdate(db: Db, entryId: string, data: { description?: string; projectId?: string | null; billable?: boolean; startTime?: string; endTime?: string }) {
  const e = await db.timeEntry.findUnique({ where: { id: entryId } });
  if (!e) throw new ApiError(404, "Time entry not found.");

  const patch: {
    description?: string;
    projectId?: string | null;
    billable?: boolean;
    startTime?: Date;
    endTime?: Date;
    durationSeconds?: number;
  } = {};
  if (data.description !== undefined) patch.description = data.description;
  if (data.projectId !== undefined && (data.projectId || null) !== e.projectId) {
    const project = await assertProjectUsable(db, data.projectId, e.userId);
    patch.projectId = project?.id ?? null;
    // A project change re-inherits the project's default unless the caller sets billable explicitly.
    patch.billable = project?.billable ?? false;
  }
  if (data.billable !== undefined) patch.billable = data.billable;

  if (data.startTime !== undefined || data.endTime !== undefined) {
    const start = data.startTime !== undefined ? parseWhen(data.startTime, "Start time") : e.startTime;
    if (e.endTime === null) {
      // Running timer: only the start can move, and never into the future.
      if (data.endTime !== undefined) throw new ApiError(400, "Stop the timer before setting an end time.");
      if (start.getTime() > Date.now()) throw new ApiError(400, "Start time can't be in the future.");
      await assertNoOverlap(db, e.userId, start, new Date(), e.id);
      patch.startTime = start;
    } else {
      const end = data.endTime !== undefined ? parseWhen(data.endTime, "End time") : e.endTime;
      assertRange(start, end);
      await assertNoOverlap(db, e.userId, start, end, e.id);
      patch.startTime = start;
      patch.endTime = end;
      patch.durationSeconds = Math.round((end.getTime() - start.getTime()) / 1000);
    }
  }

  const updated = await db.timeEntry.update({ where: { id: entryId }, data: patch, include: entryInclude });
  return serializeEntry(updated);
}

export async function deleteEntry(actor: SessionUser, entryId: string) {
  const e = await prisma.timeEntry.findUnique({ where: { id: entryId } });
  if (!e) throw new ApiError(404, "Time entry not found.");
  if (e.userId !== actor.id && !hasPermission(actor, "time.manage_all")) throw new ApiError(403, "You can only delete your own entries.");
  await prisma.timeEntry.delete({ where: { id: entryId } });
}

export async function listEntries(opts: { userIds?: string[]; from: Date; to: Date; projectId?: string; q?: string; limit?: number }) {
  const rows = await prisma.timeEntry.findMany({
    where: {
      ...(opts.userIds ? { userId: { in: opts.userIds } } : {}),
      ...(opts.projectId ? (opts.projectId === "none" ? { projectId: null } : { projectId: opts.projectId }) : {}),
      ...(opts.q ? { description: { contains: opts.q, mode: "insensitive" } } : {}),
      startTime: { gte: opts.from, lte: opts.to },
    },
    include: entryInclude,
    orderBy: { startTime: "desc" },
    take: opts.limit ?? 2000,
  });
  return rows.map(serializeEntry);
}
