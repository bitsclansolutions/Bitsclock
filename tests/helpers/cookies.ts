/**
 * Minimal stand-in for Next's request cookie store. Route handlers call
 * `cookies()` from next/headers; per-file.ts routes that to the jar below.
 * `switchJar(jar)` switches whose browser the next requests come from.
 */
type Cookie = { name: string; value: string; maxAge?: number };

export class CookieJar {
  private map = new Map<string, Cookie>();

  get(name: string) {
    const c = this.map.get(name);
    return c ? { name: c.name, value: c.value } : undefined;
  }
  getAll() {
    return [...this.map.values()].map((c) => ({ name: c.name, value: c.value }));
  }
  has(name: string) {
    return this.map.has(name);
  }
  set(name: string, value: string, options?: { maxAge?: number }) {
    // maxAge 0 is how the app clears a cookie.
    if (options?.maxAge === 0 || value === "") this.map.delete(name);
    else this.map.set(name, { name, value, maxAge: options?.maxAge });
    return this;
  }
  delete(name: string) {
    this.map.delete(name);
    return this;
  }
  /** Copy, so a test can keep "the old device's" cookies after a rotation. */
  clone() {
    const j = new CookieJar();
    for (const c of this.map.values()) j.map.set(c.name, { ...c });
    return j;
  }
}

let current = new CookieJar();

export function cookieJar() {
  return current;
}

/** Make subsequent route calls use this jar (one jar = one browser). */
export function switchJar(jar: CookieJar) {
  current = jar;
  return jar;
}

/** Start a fresh, signed-out browser. */
export function newBrowser() {
  return switchJar(new CookieJar());
}
