"use client";

import type { ReportData } from "./reports";
import { fmtHM, hoursDecimal } from "./time";

export type PdfMeta = {
  title: string;
  periodLabel: string;
  from: string;
  to: string;
  preparedFor: string;
  scopeLabel: string;
  projectLabel: string;
  billingLabel: string;
  tz: string;
};

/** Builds a branded A4 PDF of the report with jsPDF + autotable (loaded on demand). */
export async function exportReportPdf(report: ReportData, meta: PdfMeta, detailed: boolean) {
  const [{ default: JsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new JsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const brand: [number, number, number] = [13, 148, 136];
  const ink: [number, number, number] = [15, 23, 42];
  const muted: [number, number, number] = [100, 116, 139];

  // Header band
  doc.setFillColor(...brand);
  doc.rect(0, 0, W, 86, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("Bitsclock", 40, 38);
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(`${meta.title} · ${detailed ? "Detailed" : "Summary"}`, 40, 58);
  doc.setFontSize(9);
  doc.text(`Generated ${new Date().toLocaleString()} (${meta.tz})`, W - 40, 58, { align: "right" });

  // Info row
  doc.setTextColor(...ink);
  doc.setFontSize(9);
  let y = 110;
  const info: [string, string][] = [
    ["Prepared for", meta.preparedFor],
    ["Period", `${meta.periodLabel} (${meta.from} to ${meta.to})`],
    ["Members", meta.scopeLabel],
    ["Project", meta.projectLabel],
    ["Billing", meta.billingLabel],
  ];
  for (const [k, v] of info) {
    doc.setFont("helvetica", "bold");
    doc.text(k, 40, y);
    doc.setFont("helvetica", "normal");
    doc.text(v, 130, y);
    y += 14;
  }

  // KPI boxes
  y += 8;
  const t = report.totals;
  const kpis: [string, string][] = [
    ["Total time", fmtHM(t.seconds)],
    ["Billable", `${fmtHM(t.billableSeconds)} (${t.seconds ? Math.round((t.billableSeconds / t.seconds) * 100) : 0}%)`],
    ["Non-billable", fmtHM(t.nonBillableSeconds)],
    ["Entries", String(t.entries)],
    ["Active days", String(t.activeDays)],
    ["Avg / active day", fmtHM(t.avgPerActiveDay)],
  ];
  const boxW = (W - 80 - 5 * 8) / 6;
  kpis.forEach(([label, value], i) => {
    const x = 40 + i * (boxW + 8);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(x, y, boxW, 46, 6, 6, "FD");
    doc.setTextColor(...muted);
    doc.setFontSize(7.5);
    doc.text(label.toUpperCase(), x + 8, y + 15);
    doc.setTextColor(...ink);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(value, x + 8, y + 34);
    doc.setFont("helvetica", "normal");
  });
  y += 66;

  const section = (title: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...ink);
    doc.text(title, 40, y);
    y += 8;
  };
  const tableStyle = {
    startY: 0,
    margin: { left: 40, right: 40 },
    styles: { fontSize: 8.5, cellPadding: 5, textColor: ink },
    headStyles: { fillColor: [241, 245, 249] as [number, number, number], textColor: ink, fontStyle: "bold" as const },
    alternateRowStyles: { fillColor: [252, 253, 254] as [number, number, number] },
  };
  const after = () => {
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 24;
  };

  section("Time by project");
  autoTable(doc, {
    ...tableStyle,
    startY: y,
    head: [["Project", "Time", "Billable", "Entries", "Members", "Share"]],
    body: report.byProject.map((p) => [p.name, fmtHM(p.seconds), fmtHM(p.billableSeconds), p.entries, p.members, `${p.share}%`]),
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
  });
  after();

  if (report.byMember.length > 1 || detailed) {
    section("Time by member");
    autoTable(doc, {
      ...tableStyle,
      startY: y,
      head: [["Member", "Time", "Billable", "Entries", "Projects", "Share"]],
      body: report.byMember.map((m) => [m.name, fmtHM(m.seconds), fmtHM(m.billableSeconds), m.entries, m.projects, `${m.share}%`]),
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
    });
    after();
  }

  section("Time by day");
  autoTable(doc, {
    ...tableStyle,
    startY: y,
    head: [["Day", "Time", "Billable", "Non-billable", "Entries"]],
    body: report.byDay.map((d) => [d.key, fmtHM(d.seconds), fmtHM(d.billableSeconds), fmtHM(d.nonBillableSeconds), d.entries]),
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
  });
  after();

  if (detailed) {
    section(`Time entries (${Math.min(report.entries.length, 1000)}${report.entries.length > 1000 ? " of " + report.entries.length : ""})`);
    const fmt = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    autoTable(doc, {
      ...tableStyle,
      startY: y,
      head: [["Member", "Project", "Description", "Start", "End", "Hours", "Billable"]],
      body: report.entries.slice(0, 1000).map((e) => [e.user.name, e.project?.name ?? "No project", e.description, fmt(e.startTime), e.endTime ? fmt(e.endTime) : "", hoursDecimal(e.durationSeconds).toFixed(2), e.billable ? "Yes" : "No"]),
      columnStyles: { 2: { cellWidth: 150 }, 5: { halign: "right" } },
    });
  }

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...muted);
    doc.text(`Bitsclock · ${meta.title} for ${meta.preparedFor}`, 40, doc.internal.pageSize.getHeight() - 24);
    doc.text(`Page ${i} of ${pages}`, W - 40, doc.internal.pageSize.getHeight() - 24, { align: "right" });
  }

  doc.save(`bitsclock-${meta.title.toLowerCase().replace(/\s+/g, "-")}_${meta.from}_${meta.to}.pdf`);
}
