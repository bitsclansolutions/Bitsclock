import type { Instrumentation } from "next";

/**
 * Runs once when a server instance starts, before it handles requests.
 * A production server with unsafe configuration refuses to start (R-062, D-004) instead
 * of quietly building email links from request headers or keeping per-instance caches.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { productionConfigProblems } = await import("./lib/config");
  const problems = productionConfigProblems();
  if (problems.length) {
    const message = `Refusing to start: production configuration is incomplete.\n - ${problems.join("\n - ")}`;
    console.error(message);
    throw new Error(message);
  }
}

/**
 * Server errors as one structured JSON line each (R-022), so the host's log search can
 * filter by route and digest. No request bodies, cookies or headers are logged.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const e = err as { message?: string; digest?: string; name?: string };
  console.error(
    JSON.stringify({
      level: "error",
      at: new Date().toISOString(),
      kind: "request_error",
      name: e?.name,
      message: e?.message?.slice(0, 500),
      digest: e?.digest,
      method: request.method,
      path: request.path.split("?")[0],
      routePath: context.routePath,
      routeType: context.routeType,
    }),
  );
};
