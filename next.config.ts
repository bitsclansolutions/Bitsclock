import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Browser-side hardening. The CSP keeps scripts and connections on our own origin;
// 'unsafe-inline' for styles is needed by Tailwind/Next, 'unsafe-eval' only in development.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
];

const nextConfig: NextConfig = {
  // Tailwind is wired through postcss.config.mjs so the same setup works with
  // webpack (`npm run dev`, used locally because the exFAT drive can't create
  // the junctions Turbopack needs) and Turbopack (`next build` on Vercel).
  poweredByHeader: false,
  // The Playwright smoke suite runs its own dev server next to `npm run dev`; a separate
  // build directory keeps the two from fighting over .next.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      // API responses are per-user and must never be shared by intermediaries.
      { source: "/api/(.*)", headers: [{ key: "X-Robots-Tag", value: "noindex" }] },
    ];
  },
};

export default nextConfig;
