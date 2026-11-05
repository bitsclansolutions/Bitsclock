import { prisma } from "./prisma";

export type MemberRequestDTO = {
  id: string;
  name: string;
  email: string;
  jobTitle: string;
  note: string;
  role: { id: string; name: string; color: string };
  requestedBy: { id: string; name: string };
  status: "pending" | "approved" | "rejected";
  decidedAt: string | null;
  createdAt: string;
};

/**
 * Member requests visible to the caller: the Administrator sees every pending request plus
 * the 30 most recent decisions; anyone else sees only the requests they made.
 */
export async function listMemberRequests(viewer: { id: string; isAdmin: boolean }): Promise<MemberRequestDTO[]> {
  const select = {
    id: true,
    name: true,
    email: true,
    jobTitle: true,
    note: true,
    status: true,
    decidedAt: true,
    createdAt: true,
    role: { select: { id: true, name: true, color: true } },
    requestedBy: { select: { id: true, name: true } },
  } as const;
  const rows = viewer.isAdmin
    ? [
        ...(await prisma.memberRequest.findMany({ where: { status: "pending" }, select, orderBy: { createdAt: "asc" } })),
        ...(await prisma.memberRequest.findMany({ where: { status: { not: "pending" } }, select, orderBy: { decidedAt: "desc" }, take: 30 })),
      ]
    : await prisma.memberRequest.findMany({ where: { requestedById: viewer.id }, select, orderBy: { createdAt: "desc" }, take: 50 });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    jobTitle: r.jobTitle ?? "",
    note: r.note ?? "",
    role: r.role,
    requestedBy: r.requestedBy,
    status: r.status as MemberRequestDTO["status"],
    decidedAt: r.decidedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}
