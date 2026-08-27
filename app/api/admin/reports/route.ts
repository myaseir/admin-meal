// app/api/admin/reports/route.ts
import { NextResponse } from "next/server";
import { getOrders, SheetOrderRow } from "@/lib/sheets/getOrders";
import { aggregateOrders } from "@/lib/reports/aggregateOrders";

interface OrderDetail {
  id: string;
  orderDate: string;
  orderTime: string;
  userName: string;
  userPhone: string;
  address: string;
  locationLink?: string;
  estimatedDeliveryTime?: string;
  estimatedDistanceKm?: number | string;
  totalRoundTripKm?: number | string;
  orderItems: string;
  subtotal?: number;
  deliveryFee?: number;
  estimatedFuelCost?: number | string;
  riderCommission?: number | string;
  platformShare?: number | string;
  totalRiderPayment?: number | string;
  total: number;
  // NEW — surfaced so the in-depth view can show a "Paid" badge per order.
  payoutStatus?: string;
}

interface RiderOwedSummary {
  riderId: string;
  unpaidOrderCount: number;
  amountOwed: number; // sum of (Rider Commission + Fuel Cost) for unpaid delivered orders
}

function mapRowToOrderDetail(row: SheetOrderRow): OrderDetail {
  return {
    id: String(row["Order ID"] || ""),
    orderDate: String(row["Date"] || ""),
    orderTime: String(row["Time"] || ""),
    userName: String(row["Customer Name"] || ""),
    userPhone: String(row["Customer Phone"] || ""),
    address: String(row["Address"] || ""),
    locationLink: row["Location Link"] ? String(row["Location Link"]) : undefined,
    estimatedDeliveryTime: row["Estimated Delivery Time"] ? String(row["Estimated Delivery Time"]) : undefined,
    estimatedDistanceKm: row["Distance (km)"],
    totalRoundTripKm: row["Round-trip Distance (km)"],
    orderItems: String(row["Items"] || ""),
    subtotal: numOrUndefined(row["Subtotal"]),
    deliveryFee: numOrUndefined(row["Delivery Fee"]),
    estimatedFuelCost: row["Estimated Fuel Cost"],
    riderCommission: row["Rider Commission"],
    platformShare: row["Platform Earning"],
    totalRiderPayment: row["Total Rider Payment"],
    total: numOrUndefined(row["Customer Total"]) ?? 0,
    payoutStatus: (row as any)["Payout Status"] ? String((row as any)["Payout Status"]) : "Unpaid",
  };
}

function numOrUndefined(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(n) ? undefined : n;
}

function numOrZero(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(n) ? 0 : n;
}

function isUnpaidDelivered(o: SheetOrderRow): boolean {
  return o["Order Status"] === "Delivered" && (o as any)["Payout Status"] !== "Paid";
}

// Computed independently of aggregateOrders() so this doesn't require
// touching that function's internals — it just walks the same order list.
function computeOwed(orders: SheetOrderRow[]): { overall: RiderOwedSummary; byRider: RiderOwedSummary[] } {
  const map = new Map<string, RiderOwedSummary>();
  let overallCount = 0;
  let overallAmount = 0;

  for (const o of orders) {
    if (!isUnpaidDelivered(o)) continue;
    const riderId = String(o["Rider ID"] || "");
    if (!riderId) continue;
    const owed = numOrZero(o["Rider Commission"]) + numOrZero(o["Estimated Fuel Cost"]);
    overallCount += 1;
    overallAmount += owed;

    const entry = map.get(riderId) || { riderId, unpaidOrderCount: 0, amountOwed: 0 };
    entry.unpaidOrderCount += 1;
    entry.amountOwed += owed;
    map.set(riderId, entry);
  }

  return {
    overall: { riderId: "", unpaidOrderCount: overallCount, amountOwed: overallAmount },
    byRider: Array.from(map.values()),
  };
}

function getPeriodBounds(period: "week" | "month"): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const dateTo = now.toISOString();

  if (period === "week") {
    const from = new Date(now);
    from.setDate(from.getDate() - 7);
    return { dateFrom: from.toISOString(), dateTo };
  }

  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return { dateFrom: from.toISOString(), dateTo };
}

export async function POST(req: Request) {
  let body: {
    period?: "week" | "month";
    riderId?: string;
    dateFrom?: string;
    dateTo?: string;
    includeOrders?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  let dateFrom = body.dateFrom;
  let dateTo = body.dateTo;

  if (body.period) {
    const bounds = getPeriodBounds(body.period);
    dateFrom = bounds.dateFrom;
    dateTo = bounds.dateTo;
  }

  const result = await getOrders({
    riderId: body.riderId || undefined,
    dateFrom,
    dateTo,
  });

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 502 });
  }

  const report = aggregateOrders(result.orders);
  // "Owed" is payout-status-based, not date-based — this is what protects
  // against double-paying a rider if reports for overlapping ranges get
  // re-run later (see mark-paid route).
  const owed = computeOwed(result.orders);

  return NextResponse.json({
    success: true,
    dateFrom,
    dateTo,
    ...report,
    payoutStatus: {
      overall: owed.overall,
      byRider: owed.byRider,
    },
    orders: body.includeOrders ? result.orders.map(mapRowToOrderDetail) : undefined,
  });
}