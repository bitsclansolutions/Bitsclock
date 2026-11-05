"use client";

/**
 * Lazy chart components. The recharts bundle (~100 KB gzipped) loads only when a
 * chart is first rendered, after the page's data and layout are already on screen.
 *
 * Every chart also carries its numbers as a screen-reader-only table (R-057): the
 * drawing itself is hidden from assistive technology, the table says the same thing.
 */
import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import { Skeleton } from "@/components/ui";

const loading = () => <Skeleton className="h-full w-full" />;

const LazyStackedDayBars = dynamic(() => import("./Charts").then((m) => m.StackedDayBars), { ssr: false, loading });
const LazyHoursArea = dynamic(() => import("./Charts").then((m) => m.HoursArea), { ssr: false, loading });
const LazyTrendArea = dynamic(() => import("./Charts").then((m) => m.TrendArea), { ssr: false, loading });
const LazyHoursBars = dynamic(() => import("./Charts").then((m) => m.HoursBars), { ssr: false, loading });
const LazyProjectDonut = dynamic(() => import("./Charts").then((m) => m.ProjectDonut), { ssr: false, loading });

type Row = Record<string, unknown>;
const HEADINGS: Record<string, string> = {
  label: "Period",
  name: "Name",
  billable: "Billable hours",
  nonBillable: "Non-billable hours",
  hours: "Hours",
  current: "This period (hours)",
  previous: "Previous period (hours)",
  value: "Hours",
};
const SKIP = new Set(["id", "key", "color"]);

function DataTable({ caption, data }: { caption: string; data: Row[] }) {
  const cols = Object.keys(data[0] ?? {}).filter((k) => !SKIP.has(k));
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>{cols.map((c) => <th key={c} scope="col">{HEADINGS[c] ?? c}</th>)}</tr>
      </thead>
      <tbody>
        {data.map((r, i) => (
          <tr key={i}>
            {cols.map((c) => (
              <td key={c}>{r[c] === null || r[c] === undefined ? "—" : String(r[c])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function accessible<P extends { data: Row[] }>(Chart: ComponentType<P>, caption: string) {
  function AccessibleChart(props: P) {
    // `relative` anchors the sr-only table (position: absolute) here. Without it the table
    // is placed against the page itself, below the fold, and the whole page scrolls.
    return (
      <div className="relative h-full w-full">
        <div className="h-full w-full" aria-hidden="true">
          <Chart {...props} />
        </div>
        <DataTable caption={caption} data={props.data} />
      </div>
    );
  }
  return AccessibleChart;
}

export const StackedDayBars = accessible(LazyStackedDayBars, "Billable and non-billable hours per period");
export const HoursArea = accessible(LazyHoursArea, "Hours per period");
export const TrendArea = accessible(LazyTrendArea, "Hours this period compared with the previous period");
export const HoursBars = accessible(LazyHoursBars, "Hours");
export const ProjectDonut = accessible(LazyProjectDonut, "Hours by project");
