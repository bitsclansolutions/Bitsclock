import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const ACCESS_COOKIE = "bc_access";
const REFRESH_COOKIE = "bc_refresh";
// Pages anyone can open. "/" is the public home page, "/login" the sign-in form,
// "/forgot-password" the self-service reset.
const PUBLIC_EXACT = new Set(["/", "/login", "/forgot-password"]);
// Signed-in visitors of these are sent to the dashboard instead.
const AUTH_PAGES = new Set(["/login", "/forgot-password"]);

/** Verify the access JWT's signature, expiry, issuer and type. No database access here (edge runtime). */
async function hasValidAccess(req: NextRequest) {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  const secret = process.env.AUTH_SECRET;
  if (!token || !secret || token.length > 2048) return false;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { issuer: "bitsclock", algorithms: ["HS256"] });
    return payload.typ === "access" && typeof payload.sub === "string";
  } catch {
    return false;
  }
}

function redirectTo(req: NextRequest, pathname: string, search = "") {
  const url = req.nextUrl.clone();
  url.pathname = pathname;
  url.search = search;
  return NextResponse.redirect(url);
}

/**
 * Page gate: signed-out visitors of app pages go to /login; visitors whose access token
 * expired but who still hold a refresh cookie go through /api/auth/refresh (which
 * rotates the tokens and sends them back); signed-in visitors of /login go to the dashboard.
 * API routes are not matched here: they return 401 and the client refreshes itself.
 */
export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isPublic = PUBLIC_EXACT.has(pathname);
  const signedIn = await hasValidAccess(req);
  const canRefresh = !signedIn && Boolean(req.cookies.get(REFRESH_COOKIE)?.value);

  if (signedIn) {
    return AUTH_PAGES.has(pathname) ? redirectTo(req, "/dashboard") : NextResponse.next();
  }
  if (canRefresh) {
    const next = AUTH_PAGES.has(pathname) ? "/dashboard" : pathname + search;
    return redirectTo(req, "/api/auth/refresh", `?next=${encodeURIComponent(next)}`);
  }
  if (!isPublic) return redirectTo(req, "/login", `?next=${encodeURIComponent(pathname)}`);
  return NextResponse.next();
}

export const config = {
  // Everything except API routes, Next internals and static files.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)"],
};
