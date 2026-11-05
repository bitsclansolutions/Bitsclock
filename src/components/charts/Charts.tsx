"use client";

/**
 * All recharts usage lives here and is loaded on demand (see ./index.tsx), so the
 * charting library is not part of the initial bundle of any page.
 */
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const tooltipStyle = { borderRadius: 14, border: "none", boxShadow: "0 8px 24px rgba(30,42,36,0.12)", fontSize: 12, fontWeight: 600 };
const tick = (size: number) => ({ fontSize: size, fill: "#9aa39d" });
const hoursTick = (v: number) => `${v}h`;

/** Stacked billable / non-billable bars per day (or week). */
export function StackedDayBars({ data, dense = false }: { data: { label: string; billable: number; nonBillable: number }[]; dense?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barCategoryGap={dense ? 4 : data.length > 20 ? 4 : 16}>
        <CartesianGrid vertical={false} stroke="#eef0ec" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={tick(dense ? 11 : 12)} interval="preserveStartEnd" minTickGap={18} />
        <YAxis tickLine={false} axisLine={false} tick={tick(dense ? 11 : 12)} tickFormatter={hoursTick} />
        <Tooltip cursor={{ fill: "#f6f7f4" }} formatter={(v) => [`${Number(v).toFixed(2)} h`]} contentStyle={tooltipStyle} />
        <Bar dataKey="billable" name="Billable" stackId="a" fill="#1f7a4d" />
        <Bar dataKey="nonBillable" name="Non-billable" stackId="a" fill="#a9dcc0" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Single filled line, e.g. team hours per day. */
export function HoursArea({ data }: { data: { label: string; hours: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 6, right: 4, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="hoursFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2a8f5c" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#2a8f5c" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="#eef0ec" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={tick(12)} />
        <YAxis tickLine={false} axisLine={false} tick={tick(12)} tickFormatter={hoursTick} />
        <Tooltip formatter={(v) => [`${Number(v).toFixed(2)} h`]} contentStyle={tooltipStyle} />
        <Area type="monotone" dataKey="hours" name="Hours" stroke="#1f7a4d" strokeWidth={2.5} fill="url(#hoursFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Current period against the previous one. */
export function TrendArea({ data }: { data: { label: string; current: number; previous: number | null }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1f7a4d" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#1f7a4d" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="#eef0ec" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={tick(11)} interval="preserveStartEnd" minTickGap={18} />
        <YAxis tickLine={false} axisLine={false} tick={tick(11)} tickFormatter={hoursTick} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`${Number(v ?? 0)}h`, String(n) === "current" ? "This period" : "Previous"]} />
        <Area type="monotone" dataKey="previous" stroke="#c6ccc8" strokeWidth={2} strokeDasharray="4 4" fill="transparent" dot={false} />
        <Area type="monotone" dataKey="current" stroke="#1f7a4d" strokeWidth={2.5} fill="url(#trendFill)" dot={false} activeDot={{ r: 4 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Plain hours-per-bucket bars (weekday, hour of day). */
export function HoursBars({ data, color = "#1f7a4d", tight = false, labelSuffix = "" }: { data: { label: string; hours: number }[]; color?: string; tight?: boolean; labelSuffix?: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barCategoryGap={tight ? 3 : undefined}>
        <CartesianGrid vertical={false} stroke="#eef0ec" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={tick(tight ? 10 : 11)} interval={tight ? 2 : undefined} />
        <YAxis tickLine={false} axisLine={false} tick={tick(11)} tickFormatter={hoursTick} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${Number(v ?? 0)}h`, "Logged"]} labelFormatter={(l) => `${l}${labelSuffix}`} cursor={{ fill: "#f2f3ef" }} />
        <Bar dataKey="hours" fill={color} radius={tight ? [6, 6, 6, 6] : [8, 8, 8, 8]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Donut of hours by project. */
export function ProjectDonut({ data }: { data: { id: string; name: string; value: number; color: string }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={50} outerRadius={70} paddingAngle={3} stroke="#fff" cornerRadius={4}>
          {data.map((p) => (
            <Cell key={p.id} fill={p.color} />
          ))}
        </Pie>
        <Tooltip formatter={(v) => [`${Number(v).toFixed(2)} h`]} contentStyle={tooltipStyle} />
      </PieChart>
    </ResponsiveContainer>
  );
}
