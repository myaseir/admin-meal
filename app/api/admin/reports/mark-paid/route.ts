// app/api/admin/reports/mark-paid/route.ts
import { NextResponse } from "next/server";
import { getOrders, SheetOrderRow } from "@/lib/sheets/getOrders";
import { markOrdersPaid } from "@/lib/sheets/markOrdersPaid";
import { RIDERS } from "@/lib/config/riders";

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

function numOrZero(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(n) ? 0 : n;
}

function isUnpaidDelivered(o: SheetOrderRow): boolean {
  return o["Order Status"] === "Delivered" && (o as any)["Payout Status"] !== "Paid";
}

export async function POST(req: Request) {
  let body: {
    riderId?: string;
    period?: "week" | "month";
    orderIds?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.riderId) {
    return NextResponse.json({ success: false, error: "riderId is required." }, { status: 400 });
  }
  const rider = RIDERS.find((r) => r.id === body.riderId);
  if (!rider) {
    return NextResponse.json({ success: false, error: "Unknown rider." }, { status: 404 });
  }

  let targetOrders: SheetOrderRow[];

  if (body.orderIds && body.orderIds.length > 0) {
    // Explicit list — trust the caller, but still re-verify against the
    // sheet so we never mark something already paid twice or the wrong rider.
    const result = await getOrders({ riderId: body.riderId });
    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 502 });
    }
    const idSet = new Set(body.orderIds.map(String));
    targetOrders = result.orders.filter((o) => idSet.has(String(o["Order ID"])) && isUnpaidDelivered(o));
  } else {
    const period = body.period === "month" ? "month" : "week";
    const { dateFrom, dateTo } = getPeriodBounds(period);
    const result = await getOrders({ riderId: body.riderId, dateFrom, dateTo });
    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 502 });
    }
    targetOrders = result.orders.filter(isUnpaidDelivered);
  }

  if (targetOrders.length === 0) {
    return NextResponse.json({
      success: true,
      markedCount: 0,
      amountPaid: 0,
      message: "Nothing to mark — every order in range is already paid or there are none.",
    });
  }

  const orderIds = targetOrders.map((o) => String(o["Order ID"]));
  const amountPaid = targetOrders.reduce(
    (sum, o) => sum + numOrZero((o as any)["Total Rider Payment"]),
    0
  );

  const markResult = await markOrdersPaid(orderIds);
  if (!markResult.success) {
    return NextResponse.json({ success: false, error: markResult.error }, { status: 502 });
  }

  return NextResponse.json({
    success: true,
    markedCount: orderIds.length,
    amountPaid,
    orderIds,
  });
}