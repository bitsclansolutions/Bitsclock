import { prisma, type Tx } from "./prisma";
import { ApiError } from "./api";
import { hasPermission, type SessionUser } from "./auth";
import { assertUnlocked, lockDateFor, lockDayLabel } from "./workspace";
import { entryWhere, type EntryFilter } from "./entry-filter";

type Db = Tx;
type Actor = Pick<SessionUser, "id" | "isAdmin" | "permissions">;

/**
 * Time-entry rules, enforced on every write path (manual, bulk, timer start/stop/move,
 * edit, delete, deactivation):
 * - Writes for one member run under a per-user advisory lock, so overlap and single-timer
 *   rules hold under load; the database also enforces end > start and one running timer.
 * - No entry is longer than 24 h. A timer left running longer is closed at start + 24 h
 *   and flagged `autoStopped` the next time it is read, stopped or moved (D-005).
 * - Entries starting before the workspace lock date are invoiced: only the Administrator
 *   may create, edit or delete them (D-005).
 * - Billable follows the project (or activity). Only `time.manage_all` may override it (D-005).
 * - Whenever an edit adds time or turns billable on, the project must still be usable by
 *   the member: not archived, and they're on its team (R-061).
 */

async function withUserLock<T>(userId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      return fn(tx);
    },
    { maxWait: 10_000, timeout: 20_000 },
  );
}

export const entryInclude = {
  project: { select: { id: true, name: true, color: true, isArchived: true, billable: true } },
  user: { select: { id: true, name: true, deletedAt: true } },
} as const;

/** How a member's name shows on their entries: a deleted member (D-011) keeps the name, marked. */
export const memberLabel = (u: { name: string; deletedAt?: Date | null }) => (u.deletedAt ? `${u.name} (deleted)` : u.name);

type ProjectSummary = { id: string; name: string; color: string; isArchived: boolean; billable: boolean };

type EntryRow = {
  id: string;
  userId: string;
  projectId: string | null;
  description: string;
  startTime: Date;
  endTime: Date | null;
  durationSeconds: number | null;
  billable: boolean;
  autoStopped: boolean;
  createdAt: Date;
  updatedAt: Date;
  project: ProjectSummary | null;
  user: { id: string; name: string; deletedAt?: Date | null };
};

export type EntryDTO = {
  id: string;
  userId: string;
  user: { id: string; name: string };
  projectId: string | null;
  project: ProjectSummary | null;
  description: string;
  startTime: string;
  endTime: string | null;
  durationSeconds: number;
  billable: boolean;
  /** Closed automatically after 24 h; the member should check the end time (D-005). */
  autoStopped: boolean;
  running: boolean;
  createdAt: string;
  updatedAt: string;
};

export function serializeEntry(e: EntryRow): EntryDTO {
  return {
    id: e.id,
    userId: e.userId,
    user: { id: e.user.id, name: memberLabel(e.user) },
    projectId: e.projectId,
    project: e.project,
    description: e.description,
    startTime: e.startTime.toISOString(),
    endTime: e.endTime ? e.endTime.toISOString() : null,
    durationSeconds: e.durationSeconds ?? 0,
    billable: e.billable,
    autoStopped: e.autoStopped,
    running: e.endTime === null,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

export const MAX_ENTRY_HOURS = 24;
const MAX_ENTRY_MS = MAX_ENTRY_HOURS * 3600_000;

export function parseWhen(value: string, label: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ApiError(400, `${label} is not a valid date.`);
  return d;
}

const seconds = (start: Date, end: Date) => Math.max(1, Math.round((end.getTime() - start.getTime()) / 1000));

type ProjectWithMembers = ProjectSummary & { memberMode: "all" | "selected"; members: { userId: string }[] };

/** The project must exist, be active, and let `userId` log time (open to all, or on the team). */
function checkProjectUsable(project: ProjectWithMembers | null, userId: string) {
  if (!project) throw new ApiError(404, "Project not found.");
  if (project.isArchived) throw new ApiError(409, `"${project.name}" is archived. Restore it to log time on it.`);
  if (project.memberMode === "selected" && !project.members.some((m) => m.userId === userId)) {
    throw new ApiError(403, `Not on the team for "${project.name}". Ask an administrator to add you to the project.`);
  }
  return project;
}

async function loadProject(db: Db, projectId: string, userId: string) {
  return db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, color: true, isArchived: true, billable: true, memberMode: true, members: { where: { userId }, select: { userId: true } } },
  });
}

async function assertProjectUsable(db: Db, projectId: string | null | undefined, userId: string) {
  if (!projectId) return null;
  return checkProjectUsable(await loadProject(db, projectId, userId), userId);
}

/**
 * Billable follows the project's default (D-005). A request may repeat the entry's current
 * value or the default; anything else is an override and needs time.manage_all.
 */
function resolveBillable(actor: Actor, requested: boolean | undefined, projectDefault: boolean, current?: boolean) {
  if (requested === undefined) return current ?? projectDefault;
  if (requested === projectDefault || requested === current) return requested;
  if (!hasPermission(actor as SessionUser, "time.manage_all")) {
    throw new ApiError(403, "Billable follows the project. Only members who can edit everyone's time can change it.");
  }
  return requested;
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
  if (clash) throw overlapError(clash);
}

function overlapError(clash: { description: string; endTime: Date | null; project: { name: string } | null }) {
  const what = clash.description || clash.project?.name || "another entry";
  const kind = clash.endTime ? "overlaps" : "runs into your running timer";
  return new ApiError(409, `This time range ${kind}: "${what}".`);
}

function assertRange(start: Date, end: Date) {
  if (end <= start) throw new ApiError(400, "End time must be after the start time.");
  if (end.getTime() - start.getTime() > MAX_ENTRY_MS) throw new ApiError(400, `A single entry can't be longer than ${MAX_ENTRY_HOURS} hours.`);
  if (end.getTime() > Date.now() + 60_000) throw new ApiError(400, "End time can't be in the future.");
}

/** When a timer that started at `start` is stopped at `now`: never later than start + 24 h (D-005). */
export function closingTime(start: Date, now: Date) {
  const cap = new Date(start.getTime() + MAX_ENTRY_MS);
  return now > cap ? { at: cap, capped: true } : { at: now, capped: false };
}

/** Close a running timer at `end`. `capped` marks it auto-stopped for the member to check. */
async function closeTimer(db: Db, entry: { id: string; startTime: Date }, end: { at: Date; capped: boolean }) {
  return db.timeEntry.update({
    where: { id: entry.id },
    data: { endTime: end.at, durationSeconds: seconds(entry.startTime, end.at), ...(end.capped ? { autoStopped: true } : {}) },
    include: entryInclude,
  });
}

/** The user's running timer, closed first if it ran past 24 h. Caller holds the user lock. */
async function runningTimer(db: Db, userId: string) {
  const running = await db.timeEntry.findFirst({ where: { userId, endTime: null } });
  if (!running) return null;
  const end = closingTime(running.startTime, new Date());
  if (end.capped) {
    await closeTimer(db, running, end);
    return null;
  }
  return running;
}

/**
 * Stop `userId`'s running timer, if any, inside the caller's transaction (deactivation).
 * Takes the same per-user advisory lock as every other entry write; same 24 h rule.
 */
export async function stopRunningTimerTx(tx: Db, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
  const running = await tx.timeEntry.findFirst({ where: { userId, endTime: null } });
  if (!running) return null;
  return closeTimer(tx, running, closingTime(running.startTime, new Date()));
}

/** The running timer, or null. A timer past 24 h is auto-stopped on read (D-005). */
export async function getActiveEntry(userId: string) {
  const e = await prisma.timeEntry.findFirst({ where: { userId, endTime: null }, include: entryInclude });
  if (!e) return null;
  if (closingTime(e.startTime, new Date()).capped) {
    await withUserLock(userId, (db) => runningTimer(db, userId));
    return null;
  }
  return serializeEntry(e);
}

/** Auto-stop any timers in `entries` that ran past 24 h; returns the ones still running. */
export async function closeOverdueTimers(entries: EntryDTO[]) {
  const now = new Date();
  const overdue = entries.filter((e) => e.running && closingTime(new Date(e.startTime), now).capped);
  for (const e of overdue) await withUserLock(e.userId, (db) => runningTimer(db, e.userId));
  return overdue.length ? entries.filter((e) => !overdue.includes(e)) : entries;
}

export async function startTimer(actor: Actor, data: { description: string; projectId?: string | null; billable?: boolean }) {
  const userId = actor.id;
  return withUserLock(userId, async (db) => {
    if (await runningTimer(db, userId)) throw new ApiError(409, "You already have a timer running. Stop it first.");
    const project = await assertProjectUsable(db, data.projectId, userId);
    const e = await db.timeEntry.create({
      data: {
        userId,
        description: data.description,
        projectId: project?.id ?? null,
        billable: resolveBillable(actor, data.billable, project?.billable ?? false),
        startTime: new Date(),
      },
      include: entryInclude,
    });
    return serializeEntry(e);
  });
}

export async function stopTimer(actor: Actor, entryId: string) {
  const owner = await prisma.timeEntry.findUnique({ where: { id: entryId }, select: { userId: true } });
  if (!owner) throw new ApiError(404, "Timer not found.");
  if (owner.userId !== actor.id && !hasPermission(actor as SessionUser, "time.manage_all")) throw new ApiError(403, "That timer isn't yours.");
  return withUserLock(owner.userId, async (db) => {
    const e = await db.timeEntry.findUnique({ where: { id: entryId } });
    if (!e) throw new ApiError(404, "Timer not found.");
    if (e.endTime) throw new ApiError(409, "This timer has already been stopped.");
    // R-061: the time being added must still be allowed on its project.
    if (e.projectId) {
      const project = await loadProject(db, e.projectId, e.userId);
      try {
        checkProjectUsable(project, e.userId);
      } catch (err) {
        if (err instanceof ApiError) throw new ApiError(err.status, `${err.message} Change the timer's project, then stop it.`);
        throw err;
      }
    }
    return serializeEntry(await closeTimer(db, e, closingTime(e.startTime, new Date())));
  });
}

type ManualEntryInput = { description: string; projectId?: string | null; billable?: boolean; startTime: string; endTime: string };

export async function createManualEntry(actor: Actor, userId: string, data: ManualEntryInput) {
  const { created, errors } = await createManualEntries(actor, userId, [data], true);
  if (errors.length) throw new ApiError(400, errors[0]!.message);
  return created[0]!.entry;
}

export const MAX_BULK_ROWS = 500;

/**
 * Insert several manual entries for one member (R-027): every row is validated in memory,
 * existing entries are checked with ONE query over the batch's whole range, and the rows go
 * in with ONE insert, all under one advisory lock. Atomic: any bad row rejects the batch
 * (status and message name the row). Non-atomic: bad rows are reported and the rest saved.
 */
export async function createManualEntries(actor: Actor, userId: string, items: ManualEntryInput[], atomic: boolean) {
  if (items.length > MAX_BULK_ROWS) throw new ApiError(400, `At most ${MAX_BULK_ROWS} entries per request.`);
  const lockDate = await lockDateFor(actor);
  const lockLabel = lockDate ? await lockDayLabel(lockDate) : "";
  return withUserLock(userId, async (db) => {
    const errors: { index: number; message: string; status: number }[] = [];
    const fail = (index: number, e: unknown) => {
      if (!(e instanceof ApiError)) throw e;
      errors.push({ index, message: items.length > 1 ? `Entry ${index + 1}: ${e.message}` : e.message, status: e.status });
    };

    // Projects used by the batch, loaded once.
    const projectIds = [...new Set(items.map((i) => i.projectId).filter((p): p is string => !!p))];
    const projects = new Map(
      (await db.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, name: true, color: true, isArchived: true, billable: true, memberMode: true, members: { where: { userId }, select: { userId: true } } },
      })).map((p) => [p.id, p]),
    );

    type Row = { index: number; start: Date; end: Date; project: ProjectWithMembers | null; billable: boolean; description: string };
    const rows: Row[] = [];
    items.forEach((item, index) => {
      try {
        const start = parseWhen(item.startTime, "Start time");
        const end = parseWhen(item.endTime, "End time");
        assertRange(start, end);
        if (lockDate && start < lockDate) {
          throw new ApiError(403, `Time before ${lockLabel} is locked because it has been invoiced. Ask the Administrator if it needs a change.`);
        }
        const project = item.projectId ? checkProjectUsable(projects.get(item.projectId) ?? null, userId) : null;
        rows.push({ index, start, end, project, billable: resolveBillable(actor, item.billable, project?.billable ?? false), description: item.description });
      } catch (e) {
        fail(index, e);
      }
    });
    if (atomic && errors.length) throw toBatchError(errors);

    // Overlaps inside the batch (sorted by real time, not string order).
    rows.sort((a, b) => a.start.getTime() - b.start.getTime());
    const accepted: Row[] = [];
    for (const r of rows) {
      const prev = accepted[accepted.length - 1];
      if (prev && r.start < prev.end) fail(r.index, new ApiError(409, `This time range overlaps entry ${prev.index + 1} in the same batch.`));
      else accepted.push(r);
    }
    if (atomic && errors.length) throw toBatchError(errors);

    // Overlaps with existing entries: one query for the whole range.
    let toInsert = accepted;
    if (accepted.length) {
      const minStart = accepted[0]!.start;
      const maxEnd = new Date(Math.max(...accepted.map((r) => r.end.getTime())));
      const existing = await db.timeEntry.findMany({
        where: { userId, startTime: { lt: maxEnd }, OR: [{ endTime: { gt: minStart } }, { endTime: null }] },
        select: { startTime: true, endTime: true, description: true, project: { select: { name: true } } },
      });
      const now = new Date();
      toInsert = accepted.filter((r) => {
        const clash = existing.find((x) => x.startTime < r.end && (x.endTime ?? now) > r.start);
        if (clash) fail(r.index, overlapError(clash));
        return !clash;
      });
    }
    if (atomic && errors.length) throw toBatchError(errors);

    const created = toInsert.length
      ? await db.timeEntry.createManyAndReturn({
          data: toInsert.map((r) => ({
            userId,
            description: r.description,
            projectId: r.project?.id ?? null,
            billable: r.billable,
            startTime: r.start,
            endTime: r.end,
            durationSeconds: seconds(r.start, r.end),
          })),
          include: entryInclude,
        })
      : [];
    // createManyAndReturn keeps input order.
    const out = created.map((e, i) => ({ index: toInsert[i]!.index, entry: serializeEntry(e) })).sort((a, b) => a.index - b.index);
    errors.sort((a, b) => a.index - b.index);
    return { created: out, errors: errors.map(({ index, message }) => ({ index, message })) };
  });
}

function toBatchError(errors: { index: number; message: string; status: number }[]) {
  const first = [...errors].sort((a, b) => a.index - b.index)[0]!;
  return new ApiError(first.status, first.message);
}

type EntryPatch = { description?: string; projectId?: string | null; billable?: boolean; startTime?: string; endTime?: string };

export async function updateEntry(actor: Actor, entryId: string, data: EntryPatch) {
  const owner = await prisma.timeEntry.findUnique({ where: { id: entryId }, select: { userId: true } });
  if (!owner) throw new ApiError(404, "Time entry not found.");
  if (owner.userId !== actor.id && !hasPermission(actor as SessionUser, "time.manage_all")) throw new ApiError(403, "You can only edit your own entries.");
  return withUserLock(owner.userId, (db) => applyUpdate(db, actor, entryId, data));
}

async function applyUpdate(db: Db, actor: Actor, entryId: string, data: EntryPatch) {
  const e = await db.timeEntry.findUnique({ where: { id: entryId } });
  if (!e) throw new ApiError(404, "Time entry not found.");
  const newStart = data.startTime !== undefined ? parseWhen(data.startTime, "Start time") : e.startTime;
  await assertUnlocked(actor, e.startTime, newStart);

  const patch: { description?: string; projectId?: string | null; billable?: boolean; startTime?: Date; endTime?: Date; durationSeconds?: number; autoStopped?: boolean } = {};
  if (data.description !== undefined) patch.description = data.description;

  // Project and billable (D-005: billable follows the project unless time.manage_all overrides).
  const projectChanged = data.projectId !== undefined && (data.projectId || null) !== e.projectId;
  let project: ProjectWithMembers | null = null;
  if (projectChanged) {
    project = await assertProjectUsable(db, data.projectId, e.userId);
    patch.projectId = project?.id ?? null;
    patch.billable = resolveBillable(actor, data.billable, project?.billable ?? false);
  } else if (data.billable !== undefined && data.billable !== e.billable) {
    project = e.projectId ? await loadProject(db, e.projectId, e.userId) : null;
    patch.billable = resolveBillable(actor, data.billable, project?.billable ?? false, e.billable);
  }

  if (data.startTime !== undefined || data.endTime !== undefined) {
    if (e.endTime === null) {
      // Running timer: only the start can move, and never into the future.
      if (data.endTime !== undefined) throw new ApiError(400, "Stop the timer before setting an end time.");
      if (newStart.getTime() > Date.now()) throw new ApiError(400, "Start time can't be in the future.");
      const close = closingTime(newStart, new Date());
      await assertNoOverlap(db, e.userId, newStart, close.at, e.id);
      patch.startTime = newStart;
      // Moved back more than 24 h: it's closed at start + 24 h and flagged (D-005).
      if (close.capped) {
        patch.endTime = close.at;
        patch.durationSeconds = seconds(newStart, close.at);
        patch.autoStopped = true;
      }
    } else {
      const end = data.endTime !== undefined ? parseWhen(data.endTime, "End time") : e.endTime;
      assertRange(newStart, end);
      await assertNoOverlap(db, e.userId, newStart, end, e.id);
      patch.startTime = newStart;
      patch.endTime = end;
      patch.durationSeconds = seconds(newStart, end);
      // A corrected end time clears the "please check" flag.
      if (e.autoStopped && data.endTime !== undefined) patch.autoStopped = false;
    }
  }

  // R-061: adding time or turning billable on needs a project the member may still use.
  const oldSeconds = e.durationSeconds ?? 0;
  const addsTime = patch.durationSeconds !== undefined && patch.durationSeconds > oldSeconds;
  const turnsBillableOn = patch.billable === true && !e.billable;
  const finalProjectId = patch.projectId !== undefined ? patch.projectId : e.projectId;
  if ((addsTime || turnsBillableOn) && finalProjectId && !projectChanged) {
    checkProjectUsable(project ?? (await loadProject(db, finalProjectId, e.userId)), e.userId);
  }

  const updated = await db.timeEntry.update({ where: { id: entryId }, data: patch, include: entryInclude });
  return serializeEntry(updated);
}

/** Delete one entry; returns the owner's id (for cache invalidation). */
export async function deleteEntry(actor: Actor, entryId: string) {
  const e = await prisma.timeEntry.findUnique({ where: { id: entryId } });
  if (!e) throw new ApiError(404, "Time entry not found.");
  if (e.userId !== actor.id && !hasPermission(actor as SessionUser, "time.manage_all")) throw new ApiError(403, "You can only delete your own entries.");
  await assertUnlocked(actor, e.startTime);
  await prisma.timeEntry.delete({ where: { id: entryId } });
  return e.userId;
}

/** Bulk delete: own entries unless time.manage_all; locked-period entries are skipped for non-admins. */
export async function deleteEntries(actor: Actor, ids: string[]) {
  const lockDate = await lockDateFor(actor);
  const where = {
    id: { in: ids },
    ...(hasPermission(actor as SessionUser, "time.manage_all") ? {} : { userId: actor.id }),
    ...(lockDate ? { startTime: { gte: lockDate } } : {}),
  };
  const owners = [...new Set((await prisma.timeEntry.findMany({ where, select: { userId: true } })).map((r) => r.userId))];
  const { count } = await prisma.timeEntry.deleteMany({ where });
  return { deleted: count, skipped: ids.length - count, userIds: owners };
}

export const ENTRY_PAGE = 100;
export const ENTRY_PAGE_MAX = 500;

/** Opaque keyset cursor: the last row's (startTime, id). */
export function encodeCursor(e: { startTime: string; id: string }) {
  return Buffer.from(`${e.startTime}|${e.id}`).toString("base64url");
}
export function decodeCursor(cursor: string) {
  const [iso, id] = Buffer.from(cursor, "base64url").toString().split("|");
  const at = new Date(iso ?? "");
  if (!id || Number.isNaN(at.getTime())) throw new ApiError(400, "Invalid cursor.");
  return { startTime: at, id };
}

/**
 * One page of entries, newest first, by keyset (startTime desc, id desc) so pages stay
 * stable and cheap at any depth (R-025). `hasMore` tells the caller to ask again.
 */
export async function listEntries(f: EntryFilter, page: { limit?: number; cursor?: string; page?: number } = {}) {
  const limit = Math.min(Math.max(page.limit ?? ENTRY_PAGE, 1), ENTRY_PAGE_MAX);
  // A running timer is included unless the caller asked for finished entries only.
  const where = entryWhere({ ...f, finishedOnly: f.finishedOnly === true });
  const orderBy = [{ startTime: "desc" as const }, { id: "desc" as const }];

  // Numbered pages: offset + total, so the UI can show "page 3 of 12" and jump anywhere.
  if (page.page) {
    const [total, rows] = await prisma.$transaction([
      prisma.timeEntry.count({ where }),
      prisma.timeEntry.findMany({ where, include: entryInclude, orderBy, skip: (page.page - 1) * limit, take: limit }),
    ]);
    const pageCount = Math.max(1, Math.ceil(total / limit));
    return { entries: rows.map(serializeEntry), hasMore: page.page < pageCount, nextCursor: null, total, page: page.page, pageCount };
  }

  const after = page.cursor ? decodeCursor(page.cursor) : null;
  const rows = await prisma.timeEntry.findMany({
    where: {
      AND: [where, ...(after ? [{ OR: [{ startTime: { lt: after.startTime } }, { startTime: after.startTime, id: { lt: after.id } }] }] : [])],
    },
    include: entryInclude,
    orderBy,
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const entries = rows.slice(0, limit).map(serializeEntry);
  return { entries, hasMore, nextCursor: hasMore ? encodeCursor(entries[entries.length - 1]!) : null };
}
