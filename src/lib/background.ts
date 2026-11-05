import { after } from "next/server";

/**
 * Run work after the response has been sent (mail, cache housekeeping, pruning) without
 * the platform dropping it: on serverless hosts a bare un-awaited promise can be frozen
 * or killed once the response is out (D-004, R-016). Uses Next's `after()`.
 * Outside a request (scripts, unit tests) `after()` throws, so the work just starts now.
 * Errors are logged, never thrown at the caller.
 */
export function runAfterResponse(label: string, work: () => Promise<unknown>) {
  const safe = async () => {
    try {
      await work();
    } catch (e) {
      console.error(`[after] ${label} failed:`, e instanceof Error ? e.message : e);
    }
  };
  try {
    after(safe);
  } catch {
    void safe();
  }
}
