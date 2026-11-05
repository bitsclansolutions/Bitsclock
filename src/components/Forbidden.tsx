import { ErrorScreen } from "@/components/site/ErrorScreen";

/** Rendered inside the app shell when the signed-in user's role lacks a permission. Fills the content area. */
export function Forbidden({ what = "this page" }: { what?: string }) {
  return (
    <ErrorScreen
      code="403"
      standalone={false}
      showBack={false}
      title={`You can't open ${what}`}
      body="Your role doesn't include this permission. Ask an administrator if you need it; they can grant it from Roles & permissions."
    />
  );
}
