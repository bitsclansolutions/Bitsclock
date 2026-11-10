/**
 * Shown the moment a link inside the app is clicked, while the next page's server
 * render is on its way. Without it the old page stayed frozen until the server answered.
 */
export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-8 w-56 rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-28 rounded-[20px]" />
        ))}
      </div>
      <div className="skeleton h-72 rounded-[20px]" />
    </div>
  );
}
