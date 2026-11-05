import { prisma } from "@/lib/prisma";
import { handler, json, parseBody, requireUser } from "@/lib/api";
import { invalidateTags } from "@/lib/server-cache";
import { profileSchema } from "@/lib/validation";

/** Members may change their own display name and job title. Email and role stay with administrators. */
export const PATCH = handler(async (req) => {
  const me = await requireUser();
  const body = await parseBody(req, profileSchema);
  await prisma.user.update({ where: { id: me.id }, data: { name: body.name, jobTitle: body.jobTitle } });
  invalidateTags("users", "entries");
  return json({ ok: true });
});
