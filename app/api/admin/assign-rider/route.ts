// app/api/admin/assign-rider/route.ts
import { NextResponse } from "next/server";
import { assignRiderToOrder } from "@/lib/sheets/assignRiderToOrder";

export async function POST(req: Request) {
  let body: { orderId?: string; riderId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const orderId = (body.orderId || "").trim();
  const riderId = (body.riderId || "").trim();

  if (!orderId || !riderId) {
    return NextResponse.json(
      { success: false, error: "orderId and riderId are required" },
      { status: 400 }
    );
  }

  const result = await assignRiderToOrder(orderId, riderId);
  return NextResponse.json(result);
}
