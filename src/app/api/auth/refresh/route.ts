import { NextResponse } from "next/server";
import { handler, json, ApiError } from "@/lib/api";
import { refreshSession } from "@/lib/auth";
import { clientIp, envLimit } from "@/lib/rate-limit";
import { safeNextPath } from "@/lib/sanitize";

/**
 * Exchange the refresh cookie for a fresh access token (rotating the refresh token).
 * - POST: called by the browser client when an API call returns 401. Replies 200 or 401.
 * - GET:  used by the proxy for page navigations whose access token expired; it
 *         refreshes and redirects back to `next`, or to /login when the refresh fails.
 */
export const POST = handler(
  async (req) => {
    const userId = await refreshSession({ userAgent: req.headers.get("user-agent"), ip: clientIp(req) });
    if (!userId) throw new ApiError(401, "Your session has expired. Sign in again.");
    return json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  },
  // Per IP; a whole office shares one address (R-006). Tune with REFRESH_LIMIT_PER_IP.
  { limit: () => envLimit("REFRESH_LIMIT_PER_IP", 300), windowMs: 15 * 60_000 },
);

export const GET = handler(
  async (req) => {
    const url = new URL(req.url);
    const next = safeNextPath(url.searchParams.get("next"));
    // Write the cookies straight onto the redirect so they are guaranteed to travel with it.
    const probe = NextResponse.next();
    const userId = await refreshSession({ userAgent: req.headers.get("user-agent"), ip: clientIp(req) }, probe.cookies);
    const dest = new URL(userId ? next : `/login?next=${encodeURIComponent(next)}`, url.origin);
    const res = NextResponse.redirect(dest, { status: 303, headers: { "Cache-Control": "no-store" } });
    for (const c of probe.cookies.getAll()) res.cookies.set(c.name, c.value, c);
    return res;
  },
  { limit: () => envLimit("REFRESH_LIMIT_PER_IP", 300), windowMs: 15 * 60_000 },
);
