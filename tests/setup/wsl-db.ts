import { spawn, type ChildProcess } from "node:child_process";

/**
 * WSL stops an idle distro after a few seconds, taking Postgres with it. Start the
 * service and keep one process attached for the length of the run. Returns a stop function.
 */
export async function startWslPostgres(distro: string): Promise<() => void> {
  if (!/^[\w.-]+$/.test(distro)) throw new Error("TEST_DB_WSL_DISTRO must be a plain distro name.");
  const child: ChildProcess = spawn(
    "wsl.exe",
    ["-d", distro, "-u", "root", "--", "bash", "-c", "service postgresql start >/dev/null && echo READY && sleep 7200"],
    { stdio: ["ignore", "pipe", "inherit"], windowsHide: true },
  );
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Postgres in WSL (${distro}) didn't start within 60 s.`)), 60_000);
    child.stdout!.on("data", (d: Buffer) => {
      if (d.toString().includes("READY")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Starting Postgres in WSL (${distro}) failed with exit code ${code}.`));
    });
  });
  return () => child.kill();
}
