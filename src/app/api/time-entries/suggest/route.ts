import { prisma } from "@/lib/prisma";
import { handler, jsonCached, parseQuery, requirePermission } from "@/lib/api";
import { cached } from "@/lib/server-cache";
import { suggestQuerySchema } from "@/lib/validation";

export type SuggestionDTO = { description: string; projectId: string | null; project: { id: string; name: string; color: string } | null; count: number; lastUsed: string };

/**
 * Description suggestions for the entry bar: the caller's own past descriptions
 * (last 120 days) that contain the typed text, newest first, with the project each
 * was last logged against. Only ever the caller's entries.
 */
export const GET = handler(async (req) => {
  const me = await requirePermission("time.track");
  const { q } = parseQuery(new URL(req.url), suggestQuerySchema);
  const needle = q.toLowerCase();
  const recent = await cached(`suggest:${me.id}`, { ttlMs: 60_000, tags: ["entries", "projects"] }, async () => {
    const rows = await prisma.timeEntry.findMany({
      where: { userId: me.id, description: { not: "" }, startTime: { gte: new Date(Date.now() - 120 * 86400_000) } },
      select: { description: true, projectId: true, startTime: true, project: { select: { id: true, name: true, color: true, isArchived: true } } },
      orderBy: { startTime: "desc" },
      take: 600,
    });
    const map = new Map<string, SuggestionDTO>();
    for (const r of rows) {
      const key = r.description.toLowerCase();
      const hit = map.get(key);
      if (hit) hit.count++;
      else map.set(key, { description: r.description, projectId: r.project && !r.project.isArchived ? r.projectId : null, project: r.project && !r.project.isArchived ? { id: r.project.id, name: r.project.name, color: r.project.color } : null, count: 1, lastUsed: r.startTime.toISOString() });
    }
    return [...map.values()];
  });
  const suggestions = recent.filter((s) => s.description.toLowerCase().includes(needle)).slice(0, 8);
  return jsonCached(req, { suggestions }, { maxAge: 30 });
});
