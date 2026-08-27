// app/api/admin/reports/pdf/route.tsx
//
// Generates a real PDF (via @react-pdf/renderer) and streams it back with
// Content-Disposition: attachment.
//
// IMPORTANT: this only includes orders that are Delivered AND not yet
// marked Paid. Once you click "Mark as Paid" in the reports UI, those
// orders drop out of every future statement for this rider — regardless
// of what date range you run next. That's what prevents double-paying.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { renderToBuffer } from "@react-pdf/renderer";
import { getOrders, SheetOrderRow } from "@/lib/sheets/getOrders";
import { RiderReportPdfDocument } from "@/lib/reports/RiderReportPdfDocument";
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

function isUnpaidDelivered(o: SheetOrderRow): boolean {
  return o["Order Status"] === "Delivered" && (o as any)["Payout Status"] !== "Paid";
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const riderId = searchParams.get("riderId");
  const period = searchParams.get("period") === "month" ? "month" : "week";

  if (!riderId) {
    return new Response("riderId is required", { status: 400 });
  }

  const rider = RIDERS.find((r) => r.id === riderId);
  const riderDisplayName = rider?.name || riderId;

  const { dateFrom, dateTo } = getPeriodBounds(period);
  const result = await getOrders({ riderId, dateFrom, dateTo });

  if (!result.success) {
    return new Response("Could not load orders: " + result.error, { status: 502 });
  }

  const unpaidOrders = result.orders.filter(isUnpaidDelivered);

  const pdfBuffer = await renderToBuffer(
    <RiderReportPdfDocument
      riderName={riderDisplayName}
      periodLabel={period === "week" ? "Weekly Payout Statement" : "Monthly Payout Statement"}
      dateFrom={dateFrom}
      dateTo={dateTo}
      orders={unpaidOrders}
    />
  );

  const safeName = riderDisplayName.replace(/[^a-zA-Z0-9]+/g, "_");
  const dateTag = dateFrom.slice(0, 10);
  const filename = `${safeName}_${period === "week" ? "Weekly" : "Monthly"}_Payout_${dateTag}.pdf`;

  return new Response(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(pdfBuffer.length),
    },
  });
}