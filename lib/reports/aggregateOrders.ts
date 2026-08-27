// lib/reports/aggregateOrders.ts
//
// Pure function, no I/O — takes the raw rows getOrders() returns and
// reduces them into report totals. Kept separate from the API route so
// it's easy to unit-test or reuse (e.g. for a CSV export later) without
// touching network code.

import { SheetOrderRow } from "@/lib/sheets/getOrders";

export interface ReportTotals {
  orderCount: number;
  totalRevenue: number;        // sum of Customer Total
  totalDeliveryCharges: number; // sum of Delivery Fee
  totalFuelCost: number;        // sum of Estimated Fuel Cost
  totalRiderCommission: number; // sum of Rider Commission
  totalPlatformCommission: number; // sum of Platform Earning
  unmeasuredRouteCount: number; // orders where fuel/distance was "N/A" (not yet manually measured)
}

export interface RiderReport extends ReportTotals {
  riderId: string;
}

export interface AggregatedReport {
  overall: ReportTotals;
  byRider: RiderReport[]; // sorted by totalRiderCommission descending
  unassignedCount: number; // orders with no Rider ID yet
}

// Sheet cells can be a real number, a numeric string, or the literal text
// "N/A" (checkout writes this when a route hasn't been manually measured
// yet — see appendOrderToSheet.ts / place-order route). This coerces
// anything non-numeric to 0 for summing, while the caller can still see
// how many rows were affected via unmeasuredRouteCount.
function toNumber(value: number | string): number {
  if (typeof value === "number") return value;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}

function isUnmeasured(value: number | string): boolean {
  return typeof value === "string" && value.trim().toUpperCase() === "N/A";
}

function emptyTotals(): ReportTotals {
  return {
    orderCount: 0,
    totalRevenue: 0,
    totalDeliveryCharges: 0,
    totalFuelCost: 0,
    totalRiderCommission: 0,
    totalPlatformCommission: 0,
    unmeasuredRouteCount: 0,
  };
}

function addRowToTotals(totals: ReportTotals, row: SheetOrderRow): void {
  totals.orderCount += 1;
  totals.totalRevenue += toNumber(row["Customer Total"]);
  totals.totalDeliveryCharges += toNumber(row["Delivery Fee"]);
  totals.totalFuelCost += toNumber(row["Estimated Fuel Cost"]);
  totals.totalRiderCommission += toNumber(row["Rider Commission"]);
  totals.totalPlatformCommission += toNumber(row["Platform Earning"]);
  if (isUnmeasured(row["Estimated Fuel Cost"]) || isUnmeasured(row["Distance (km)"])) {
    totals.unmeasuredRouteCount += 1;
  }
}

export function aggregateOrders(rows: SheetOrderRow[]): AggregatedReport {
  const overall = emptyTotals();
  const riderTotals = new Map<string, ReportTotals>();
  let unassignedCount = 0;

  for (const row of rows) {
    addRowToTotals(overall, row);

    const riderId = String(row["Rider ID"] || "").trim();
    if (!riderId) {
      unassignedCount += 1;
      continue;
    }

    if (!riderTotals.has(riderId)) {
      riderTotals.set(riderId, emptyTotals());
    }
    addRowToTotals(riderTotals.get(riderId)!, row);
  }

  const byRider: RiderReport[] = Array.from(riderTotals.entries())
    .map(([riderId, totals]) => ({ riderId, ...totals }))
    .sort((a, b) => b.totalRiderCommission - a.totalRiderCommission);

  return { overall, byRider, unassignedCount };
}
