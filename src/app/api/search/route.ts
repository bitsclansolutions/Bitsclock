import { handler, jsonCached, parseQuery, requireUser } from "@/lib/api";
import { search, searchQuerySchema } from "@/lib/search";

/** Global search (Ctrl K): everything the caller may see, over all time. */
export const GET = handler(async (req) => {
  const me = await requireUser();
  const { q } = parseQuery(new URL(req.url), searchQuerySchema);
  return jsonCached(req, await search(me, q), { maxAge: 5, swr: 30 });
});
