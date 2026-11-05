import type { Metadata } from "next";
import { ErrorScreen } from "@/components/site/ErrorScreen";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return <ErrorScreen code="404" title="This page doesn't exist" body="The link may be out of date, or the page was moved. Check the address or head back to your dashboard." />;
}
