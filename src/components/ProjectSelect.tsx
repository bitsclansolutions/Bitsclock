"use client";

import { useMemo } from "react";
import { Select } from "./Select";

export type ProjectLite = { id: string; name: string; color: string; isArchived?: boolean; billable?: boolean; kind?: "project" | "activity" };

export function ProjectSelect({
  value,
  onChange,
  projects,
  allowNone = true,
  noneLabel = "No project",
  id,
  className = "",
  disabled,
  size = "md",
  label = "Project",
}: {
  value: string;
  onChange: (v: string) => void;
  projects: ProjectLite[];
  allowNone?: boolean;
  noneLabel?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  label?: string;
}) {
  const options = useMemo(() => {
    // Activities (lunch, meetings…) are listed after the projects under their own heading.
    const hasActivities = projects.some((p) => p.kind === "activity");
    const ordered = hasActivities ? [...projects].sort((a, b) => Number(a.kind === "activity") - Number(b.kind === "activity")) : projects;
    return [
      ...(allowNone ? [{ value: "", label: noneLabel, color: null as string | null }] : []),
      ...ordered.map((p) => ({
        value: p.id,
        label: p.name,
        color: p.color,
        group: hasActivities ? (p.kind === "activity" ? "Activities" : "Projects") : undefined,
        hint: [p.isArchived ? "Archived" : null, p.billable === false ? "Non-billable" : null].filter(Boolean).join(" · ") || undefined,
      })),
    ];
  }, [projects, allowNone, noneLabel]);
  return <Select id={id} label={label} value={value} onChange={onChange} options={options} placeholder={noneLabel} className={/\bw-/.test(className) ? className : `w-full ${className}`} disabled={disabled} size={size} searchPlaceholder="Search projects…" menuWidth={260} />;
}
