// lib/sheets/updateOrderStatus.ts
//
// Calls the Apps Script webhook's "updateOrderStatus" action (see Code.gs).
// Like assignRiderToOrder.ts, this is an interactive admin action — the
// staff member needs to know if it failed — so it returns a discriminated
// result rather than swallowing errors.

export const ORDER_STATUSES = ["New", "Delivered", "Cancelled"] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type UpdateOrderStatusResult =
  | { success: true; orderId: string; previousStatus: string; status: string }
  | { success: false; error: string };

const REQUEST_TIMEOUT_MS = 8000;

export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus
): Promise<UpdateOrderStatusResult> {
  const webhookUrl = process.env.SHEETS_WEBHOOK_URL;
  const secret = process.env.SHEETS_WEBHOOK_SECRET;

  if (!webhookUrl || !secret) {
    return { success: false, error: "Sheets webhook not configured" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, action: "updateOrderStatus", orderId, status }),
      signal: controller.signal,
    });

    const data = await res.json().catch(() => null);

    if (!data || typeof data.success !== "boolean") {
      return { success: false, error: "Malformed response from Sheets webhook" };
    }

    return data as UpdateOrderStatusResult;
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "AbortError"
        ? "Sheets webhook timed out"
        : String(err);
    return { success: false, error: reason };
  } finally {
    clearTimeout(timeout);
  }
}