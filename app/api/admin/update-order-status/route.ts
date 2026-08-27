// app/api/admin/update-order-status/route.ts
import { NextResponse } from "next/server";
import { updateOrderStatus, ORDER_STATUSES, OrderStatus } from "@/lib/sheets/updateOrderStatus";

export async function POST(req: Request) {
  let body: { orderId?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const orderId = (body.orderId || "").trim();
  const status = (body.status || "").trim();

  if (!orderId || !status) {
    return NextResponse.json(
      { success: false, error: "orderId and status are required" },
      { status: 400 }
    );
  }

  if (!ORDER_STATUSES.includes(status as OrderStatus)) {
    return NextResponse.json(
      { success: false, error: `Invalid status: ${status}` },
      { status: 400 }
    );
  }

  const result = await updateOrderStatus(orderId, status as OrderStatus);
  return NextResponse.json(result);
}