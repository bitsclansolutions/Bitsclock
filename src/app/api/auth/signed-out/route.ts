import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { clearSessionCookies, getSessionUser } from "@/lib/auth";

/**
 * Where the app layout sends a browser whose access token is well-signed but no longer
 * valid (password changed, deactivated, signed out elsewhere). Clearing the cookies here
 * breaks the loop where the proxy sees a "valid" token on /login and bounces back (R-046).
 * Cookies are only cleared when there really is no valid session, so a link from another
 * site can't sign anyone out.
 */
export const GET = handler(async (req) => {
  const res = NextResponse.redirect(new URL("/login?expired=1", req.url), { status: 303, headers: { "Cache-Control": "no-store" } });
  if (!(await getSessionUser())) await clearSessionCookies(res.cookies);
  return res;
});
