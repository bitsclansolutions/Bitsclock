import { createServer, type Server } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Sends real mail through nodemailer 10 (R-042, D-008 retest) to a minimal SMTP server
 * on localhost, and checks what arrived. No external network.
 */
let server: Server;
let port = 0;
const received: { from: string; to: string[]; data: string }[] = [];

beforeAll(async () => {
  server = createServer((sock) => {
    let mode: "cmd" | "data" = "cmd";
    let buf = "";
    let current = { from: "", to: [] as string[], data: "" };
    sock.write("220 test.local ESMTP\r\n");
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      for (;;) {
        if (mode === "data") {
          const end = buf.indexOf("\r\n.\r\n");
          if (end < 0) return;
          current.data = buf.slice(0, end);
          buf = buf.slice(end + 5);
          received.push(current);
          current = { from: "", to: [], data: "" };
          mode = "cmd";
          sock.write("250 OK queued\r\n");
          continue;
        }
        const nl = buf.indexOf("\r\n");
        if (nl < 0) return;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO" || cmd === "HELO") {
          sock.write("250-test.local\r\n250 8BITMIME\r\n");
        } else if (cmd === "MAIL") {
          current.from = line;
          sock.write("250 OK\r\n");
        } else if (cmd === "RCPT") {
          current.to.push(line);
          sock.write("250 OK\r\n");
        } else if (cmd === "DATA") {
          mode = "data";
          sock.write("354 End with <CRLF>.<CRLF>\r\n");
        } else if (cmd === "QUIT") {
          sock.end("221 Bye\r\n");
        } else {
          sock.write("250 OK\r\n");
        }
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as { port: number }).port;
});

afterAll(() => {
  server?.close();
  vi.unstubAllEnvs();
});

describe("sending mail with nodemailer 10", () => {
  it("delivers the invitation with the sign-in link and temporary password", async () => {
    vi.stubEnv("SMTP_HOST", "127.0.0.1");
    vi.stubEnv("SMTP_PORT", String(port));
    vi.stubEnv("SMTP_SECURE", "false");
    vi.stubEnv("SMTP_USER", "");
    vi.stubEnv("MAIL_FROM", "Bitsclock <no-reply@example.test>");
    vi.resetModules();
    const mail = await import("@/lib/mail");
    expect(mail.mailEnabled).toBe(true);
    const sent = await mail.sendMail(mail.invitationEmail({ to: "new.person@example.test", name: "New Person", invitedBy: "Admin", password: "Tmp-pass-123", url: "https://app.example.test" }));
    expect(sent).toBe(true);
    const msg = received.at(-1)!;
    expect(msg.from).toContain("no-reply@example.test");
    expect(msg.to.join(" ")).toContain("new.person@example.test");
    expect(msg.data).toContain("You've been added to Bitsclock");
    expect(msg.data).toContain("https://app.example.test/login");
    expect(msg.data).toContain("Tmp-pass-123");
  });

  it("reports failure (false) instead of throwing when the server is unreachable", async () => {
    vi.stubEnv("SMTP_HOST", "127.0.0.1");
    vi.stubEnv("SMTP_PORT", "1");
    vi.stubEnv("MAIL_FROM", "Bitsclock <no-reply@example.test>");
    vi.resetModules();
    const mail = await import("@/lib/mail");
    const sent = await mail.sendMail(mail.passwordChangedEmail({ to: "x@example.test", name: "X", url: "https://app.example.test" }));
    expect(sent).toBe(false);
  });
});
