// app/api/admin/orders/route.ts
import { NextResponse } from "next/server";
import { getOrders } from "@/lib/sheets/getOrders";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const riderId = searchParams.get("riderId") || undefined;
  const dateFrom = searchParams.get("dateFrom") || undefined;
  const dateTo = searchParams.get("dateTo") || undefined;

  const result = await getOrders({ riderId, dateFrom, dateTo });
  return NextResponse.json(result);
}