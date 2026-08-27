// lib/sheets/assignRiderToOrder.ts
//
// Calls the same Apps Script webhook as appendOrderToSheet.ts, but with
// action: "assignRider" instead of a plain order-creation payload. Unlike
// appendOrderToSheet, a failure here IS meaningful to the caller (the
// staff member needs to know if assignment failed or was already taken),
// so this throws/returns a discriminated result rather than silently
// swallowing errors — this is an interactive admin action, not a
// best-effort background write.

export type AssignRiderResult =
  | { success: true; alreadyAssigned: false; orderId: string; riderId: string }
  | { success: true; alreadyAssigned: true; orderId: string; existingRiderId: string } // re-assigned same rider, no-op
  | { success: false; alreadyAssigned: true; orderId: string; existingRiderId: string } // taken by someone else
  | { success: false; alreadyAssigned: false; error: string };

const REQUEST_TIMEOUT_MS = 8000;

export async function assignRiderToOrder(
  orderId: string,
  riderId: string
): Promise<AssignRiderResult> {
  const webhookUrl = process.env.SHEETS_WEBHOOK_URL;
  const secret = process.env.SHEETS_WEBHOOK_SECRET;

  if (!webhookUrl || !secret) {
    return { success: false, alreadyAssigned: false, error: "Sheets webhook not configured" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, action: "assignRider", orderId, riderId }),
      signal: controller.signal,
    });

    const data = await res.json().catch(() => null);

    if (!data || typeof data.success !== "boolean") {
      return { success: false, alreadyAssigned: false, error: "Malformed response from Sheets webhook" };
    }

    return data as AssignRiderResult;
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "AbortError"
        ? "Sheets webhook timed out"
        : String(err);
    return { success: false, alreadyAssigned: false, error: reason };
  } finally {
    clearTimeout(timeout);
  }
}
