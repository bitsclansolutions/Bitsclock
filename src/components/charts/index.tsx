"use client";

/**
 * Lazy chart components. The recharts bundle (~100 KB gzipped) loads only when a
 * chart is first rendered, after the page's data and layout are already on screen.
 */
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui";

const loading = () => <Skeleton className="h-full w-full" />;

export const StackedDayBars = dynamic(() => import("./Charts").then((m) => m.StackedDayBars), { ssr: false, loading });
export const HoursArea = dynamic(() => import("./Charts").then((m) => m.HoursArea), { ssr: false, loading });
export const TrendArea = dynamic(() => import("./Charts").then((m) => m.TrendArea), { ssr: false, loading });
export const HoursBars = dynamic(() => import("./Charts").then((m) => m.HoursBars), { ssr: false, loading });
export const ProjectDonut = dynamic(() => import("./Charts").then((m) => m.ProjectDonut), { ssr: false, loading });
