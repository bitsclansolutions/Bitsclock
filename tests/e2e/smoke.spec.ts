import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN, E2E_EMPLOYEE } from "./accounts";

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
}

const json = (page: Page) => ({ "content-type": "application/json", origin: new URL(page.url()).origin });
const iso = (ms: number) => new Date(ms).toISOString();

test("1. sign in lands on the dashboard and /api/auth/me knows who we are", async ({ page }) => {
  await signIn(page, E2E_ADMIN);
  const me = await page.request.get("/api/auth/me");
  expect(me.status()).toBe(200);
  expect((await me.json()).user.email).toBe(E2E_ADMIN.email);
});

test("2. start then stop a timer lists the entry", async ({ page }) => {
  await signIn(page, E2E_EMPLOYEE);
  const start = await page.request.post("/api/time-entries/start", { headers: json(page), data: { description: "E2E timer" } });
  expect(start.status()).toBe(201);
  const { entry } = await start.json();
  const stop = await page.request.post(`/api/time-entries/${entry.id}/stop`, { headers: json(page), data: {} });
  expect(stop.status()).toBe(200);
  const list = await page.request.get(`/api/time-entries?from=${encodeURIComponent(iso(Date.now() - 3600_000))}&to=${encodeURIComponent(iso(Date.now() + 60_000))}`);
  expect((await list.json()).entries.some((e: { id: string }) => e.id === entry.id)).toBe(true);
});

test("3. an overlapping entry is refused with 409", async ({ page }) => {
  await signIn(page, E2E_EMPLOYEE);
  const base = Date.parse("2026-09-01T09:00:00.000Z");
  expect((await page.request.post("/api/time-entries", { headers: json(page), data: { startTime: iso(base), endTime: iso(base + 3600_000) } })).status()).toBe(201);
  expect((await page.request.post("/api/time-entries", { headers: json(page), data: { startTime: iso(base + 1800_000), endTime: iso(base + 5400_000) } })).status()).toBe(409);
});

test("4. an employee asking for everyone's report gets 403", async ({ page }) => {
  await signIn(page, E2E_EMPLOYEE);
  const res = await page.request.get(`/api/reports?from=${encodeURIComponent(iso(Date.now() - 7 * 86400_000))}&to=${encodeURIComponent(iso(Date.now()))}&userId=all`);
  expect(res.status()).toBe(403);
});

test("5. CSV export row count equals the report's entry total", async ({ page }) => {
  await signIn(page, E2E_EMPLOYEE);
  const q = `from=${encodeURIComponent("2026-09-01T00:00:00.000Z")}&to=${encodeURIComponent("2026-09-02T00:00:00.000Z")}&tz=Asia%2FKolkata`;
  const report = await (await page.request.get(`/api/reports?${q}&kind=summary`)).json();
  const csv = await page.request.get(`/api/reports/export?${q}&kind=detailed`);
  expect(csv.status()).toBe(200);
  expect(Number(csv.headers()["x-total-rows"])).toBe(report.report.totals.entries);
  expect((await csv.text()).trim().split("\r\n").length - 1).toBe(report.report.totals.entries);
});

test("6. refreshing after the access token is gone keeps the session", async ({ page, context }) => {
  await signIn(page, E2E_EMPLOYEE);
  const cookies = await context.cookies();
  await context.clearCookies();
  await context.addCookies(cookies.filter((c) => c.name !== "bc_access"));
  expect((await page.request.post("/api/auth/refresh", { headers: { origin: new URL(page.url()).origin } })).status()).toBe(200);
  expect((await page.request.get("/api/auth/me")).status()).toBe(200);
});

test("7. row menus work with the keyboard alone (R-009)", async ({ page }) => {
  await signIn(page, E2E_ADMIN);
  await page.goto("/team");
  const trigger = page.getByRole("button", { name: /Actions for E2E Employee/ }).first();
  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  // Focus moved into the menu on its own.
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem").nth(1)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("8. the inline entry editor keeps the cursor while a timer ticks (R-007)", async ({ page }) => {
  await signIn(page, E2E_EMPLOYEE);
  // A finished entry to edit, and a running timer making the tracker re-render every second.
  const base = Date.now() - 5 * 3600_000;
  await page.request.post("/api/time-entries", { headers: json(page), data: { description: "Focus check", startTime: iso(base), endTime: iso(base + 1800_000) } });
  await page.request.post("/api/time-entries/start", { headers: json(page), data: { description: "Ticking" } });
  await page.goto("/tracker");
  // Clicking an entry row turns it into fields, in place (no dialog).
  await page.getByRole("button", { name: "Focus check" }).click();
  const editor = page.getByRole("form", { name: "Edit entry" });
  await expect(editor).toBeVisible();
  const start = editor.getByLabel("Start time");
  await start.click();
  await page.waitForTimeout(2500);
  await expect(start).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
});

test("9. the description box grows, keeps one paragraph, and Enter saves", async ({ page }) => {
  await signIn(page, E2E_EMPLOYEE);
  const base = Date.now() - 8 * 3600_000;
  await page.request.post("/api/time-entries", { headers: json(page), data: { description: "Short one", startTime: iso(base), endTime: iso(base + 1800_000) } });
  await page.goto("/tracker");
  await page.getByRole("button", { name: "Short one" }).click();
  const box = page.getByRole("form", { name: "Edit entry" }).getByRole("combobox", { name: "What are you working on?" });
  const oneLine = await box.evaluate((el) => el.getBoundingClientRect().height);
  // A long description with a pasted line break: the box grows and the break becomes a space.
  const long = `${"Reviewed the checkout flow and wrote notes ".repeat(4)}\nthen fixed the tax rounding`;
  await box.fill(long);
  expect(await box.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(oneLine);
  expect(await box.inputValue()).not.toContain("\n");
  await box.press("Enter");
  await expect(page.getByRole("form", { name: "Edit entry" })).toBeHidden();
  await expect(page.getByRole("button", { name: /then fixed the tax rounding/ })).toBeVisible();
});
