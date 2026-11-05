"use client";

import { useEffect } from "react";
import { ErrorScreen } from "@/components/site/ErrorScreen";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <ErrorScreen
      code="500"
      title="Something went wrong"
      body="The page hit an unexpected error. Trying again usually fixes it; if it keeps happening, let your administrator know."
      detail={error.digest ? `Reference: ${error.digest}` : undefined}
      onRetry={reset}
    />
  );
}
