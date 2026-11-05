"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

export function BackButton() {
  const router = useRouter();
  return (
    <button type="button" onClick={() => router.back()} className="btn btn-ghost">
      <ArrowLeft className="h-4 w-4" /> Go back
    </button>
  );
}
