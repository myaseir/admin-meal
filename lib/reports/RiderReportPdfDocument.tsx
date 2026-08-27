// lib/reports/RiderReportPdfDocument.tsx
//
// The actual PDF layout for a rider's weekly/monthly payout statement.
// Rendered server-side via @react-pdf/renderer into a real PDF file (not a
// print-dialog screenshot), so it downloads immediately and looks the same
// everywhere it's opened.
//
// Two things are deliberately excluded here:
//   - Platform Earning — this document goes to riders; they only need
//     their own commission, fuel reimbursement, and total payout.
//   - Distance (round-trip km, estimated distance) — not something a
//     rider needs on a payout statement; it's an internal cost input,
//     not part of what they're being told they earned.

import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { SheetOrderRow } from "@/lib/sheets/getOrders";

const PURPLE_DARK = "#4c1d95";
const PURPLE = "#6d28d9";
const PURPLE_LIGHT = "#f5f3ff";
const PURPLE_BORDER = "#ddd6fe";
const GRAY_900 = "#111827";
const GRAY_500 = "#6b7280";
const GRAY_200 = "#e5e7eb";

const styles = StyleSheet.create({
  page: {
    padding: 32,
    paddingBottom: 48,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: GRAY_900,
  },

  // Header
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderBottom: `3pt solid ${PURPLE}`,
    paddingBottom: 12,
    marginBottom: 20,
  },
  riderName: {
    fontSize: 20,
    fontWeight: 700,
    color: PURPLE_DARK,
  },
  periodLine: {
    fontSize: 10,
    color: GRAY_500,
    marginTop: 4,
    fontWeight: 700,
  },
  brand: { alignItems: "flex-end" },
  brandName: {
    fontSize: 13,
    fontWeight: 700,
    color: PURPLE,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  brandSub: {
    fontSize: 8,
    color: "#9ca3af",
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginTop: 2,
  },

  // Summary cards
  summaryRow: { flexDirection: "row", gap: 10, marginBottom: 22 },
  summaryBox: {
    flex: 1,
    backgroundColor: PURPLE_LIGHT,
    border: `1pt solid ${PURPLE_BORDER}`,
    borderRadius: 6,
    padding: 10,
  },
  summaryBoxHighlight: {
    flex: 1,
    backgroundColor: PURPLE,
    borderRadius: 6,
    padding: 10,
  },
  summaryLabel: {
    fontSize: 7,
    fontWeight: 700,
    color: PURPLE_DARK,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 5,
  },
  summaryLabelHighlight: {
    fontSize: 7,
    fontWeight: 700,
    color: "#ddd6fe",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 5,
  },
  summaryValue: { fontSize: 15, fontWeight: 700, color: PURPLE_DARK },
  summaryValueHighlight: { fontSize: 15, fontWeight: 700, color: "#ffffff" },

  // Table
  tableHeader: {
    flexDirection: "row",
    backgroundColor: PURPLE_LIGHT,
    borderBottom: `2pt solid ${PURPLE_BORDER}`,
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  th: {
    fontSize: 7,
    fontWeight: 700,
    color: PURPLE_DARK,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderBottom: `0.5pt solid ${GRAY_200}`,
  },
  tableRowAlt: {
    backgroundColor: "#fafafa",
  },
  td: { fontSize: 8, color: GRAY_900 },
  tdMuted: { fontSize: 7, color: GRAY_500, marginTop: 1 },

  colDate: { width: "14%" },
  colCustomer: { width: "24%" },
  colItems: { width: "34%" },
  colFuel: { width: "10%", textAlign: "right" },
  colCommission: { width: "9%", textAlign: "right" },
  colPayout: { width: "9%", textAlign: "right" },

  payoutValue: { fontSize: 9, fontWeight: 700, color: PURPLE_DARK },

  footer: {
    position: "absolute",
    bottom: 20,
    left: 32,
    right: 32,
    fontSize: 7,
    color: "#9ca3af",
    textAlign: "center",
    borderTop: `0.5pt solid ${GRAY_200}`,
    paddingTop: 8,
  },
  pageNumber: {
    position: "absolute",
    bottom: 20,
    right: 32,
    fontSize: 7,
    color: "#9ca3af",
  },
});

function safeNum(v: number | string | undefined): number {
  if (v === undefined) return 0;
  const n = typeof v === "number" ? v : parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function fmtMoney(v: number | string | undefined): string {
  const n = safeNum(v);
  return "Rs. " + n.toLocaleString("en-PK", { maximumFractionDigits: 0 });
}

export interface RiderReportPdfProps {
  riderName: string;
  periodLabel: string; // "Weekly Payout Statement" / "Monthly Payout Statement"
  dateFrom: string;
  dateTo: string;
  orders: SheetOrderRow[];
}

export function RiderReportPdfDocument({
  riderName,
  periodLabel,
  dateFrom,
  dateTo,
  orders,
}: RiderReportPdfProps) {
  const totalOrders = orders.length;
  const totalFuelCost = orders.reduce((sum, o) => sum + safeNum(o["Estimated Fuel Cost"]), 0);
  const totalCommission = orders.reduce((sum, o) => sum + safeNum(o["Rider Commission"]), 0);
  const totalPayout = orders.reduce((sum, o) => sum + safeNum(o["Total Rider Payment"]), 0);

  const dateFromLabel = new Date(dateFrom).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const dateToLabel = new Date(dateTo).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return (
    <Document title={`${riderName} — ${periodLabel}`}>
      <Page size="A4" style={styles.page} wrap>
        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.riderName}>{riderName}</Text>
            <Text style={styles.periodLine}>
              {periodLabel} · {dateFromLabel} – {dateToLabel}
            </Text>
          </View>
          <View style={styles.brand}>
            <Text style={styles.brandName}>Meal Bear Skardu</Text>
            <Text style={styles.brandSub}>Rider Earnings</Text>
          </View>
        </View>

        {/* Summary */}
        <View style={styles.summaryRow}>
          <View style={styles.summaryBox}>
            <Text style={styles.summaryLabel}>Total Orders</Text>
            <Text style={styles.summaryValue}>{totalOrders}</Text>
          </View>
          <View style={styles.summaryBox}>
            <Text style={styles.summaryLabel}>Fuel Reimbursement</Text>
            <Text style={styles.summaryValue}>{fmtMoney(totalFuelCost)}</Text>
          </View>
          <View style={styles.summaryBox}>
            <Text style={styles.summaryLabel}>Rider Commission</Text>
            <Text style={styles.summaryValue}>{fmtMoney(totalCommission)}</Text>
          </View>
          <View style={styles.summaryBoxHighlight}>
            <Text style={styles.summaryLabelHighlight}>Total Net Payout</Text>
            <Text style={styles.summaryValueHighlight}>{fmtMoney(totalPayout)}</Text>
          </View>
        </View>

        {/* Table */}
        <View style={styles.tableHeader} fixed>
          <Text style={[styles.th, styles.colDate]}>Date &amp; Time</Text>
          <Text style={[styles.th, styles.colCustomer]}>Customer</Text>
          <Text style={[styles.th, styles.colItems]}>Items Delivered</Text>
          <Text style={[styles.th, styles.colFuel]}>Fuel</Text>
          <Text style={[styles.th, styles.colCommission]}>Comm.</Text>
          <Text style={[styles.th, styles.colPayout]}>Payout</Text>
        </View>

        {orders.length === 0 && (
          <Text style={{ padding: 16, fontSize: 9, color: GRAY_500 }}>
            No orders in this period.
          </Text>
        )}

        {orders.map((o, idx) => (
          <View
            key={String(o["Order ID"]) + idx}
            style={[styles.tableRow, idx % 2 === 1 ? styles.tableRowAlt : {}]}
            wrap={false}
          >
            <View style={styles.colDate}>
              <Text style={styles.td}>{String(o["Date"] || "")}</Text>
              <Text style={styles.tdMuted}>{String(o["Time"] || "")}</Text>
            </View>
            <View style={styles.colCustomer}>
              <Text style={styles.td}>{String(o["Customer Name"] || "")}</Text>
              <Text style={styles.tdMuted}>{String(o["Restaurant(s)"] || "")}</Text>
            </View>
            <Text style={[styles.td, styles.colItems]}>
              {String(o["Items"] || "").replace(/\[\[DESC\]\][\s\S]*?\[\[\/DESC\]\]/g, "")}
            </Text>
            <Text style={[styles.td, styles.colFuel]}>{fmtMoney(o["Estimated Fuel Cost"])}</Text>
            <Text style={[styles.td, styles.colCommission]}>{fmtMoney(o["Rider Commission"])}</Text>
            <Text style={[styles.payoutValue, styles.colPayout]}>
              {fmtMoney(o["Total Rider Payment"])}
            </Text>
          </View>
        ))}

        <Text style={styles.footer} fixed>
          This statement covers fuel reimbursement and commission only. Generated automatically by
          Meal Bear Skardu.
        </Text>
        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  );
}