import { handler, json, requireUser } from "@/lib/api";

export const GET = handler(async () => {
  const user = await requireUser();
  return json({ user });
});
