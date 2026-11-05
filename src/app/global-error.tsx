"use client";

import { Manrope } from "next/font/google";
import "./globals.css";
import { ErrorScreen } from "@/components/site/ErrorScreen";

const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"], weight: ["400", "600", "700", "800"] });

/** Last-resort boundary: replaces the root layout when it crashes. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" className={`${manrope.variable} h-full antialiased`}>
      <body className="min-h-full">
        <ErrorScreen code="500" title="Bitsclock hit a problem" body="The app failed to load. Try again, or reload the page." detail={error.digest ? `Reference: ${error.digest}` : undefined} onRetry={reset} showBack={false} />
      </body>
    </html>
  );
}
