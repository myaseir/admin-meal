// lib/sheets/getOrders.ts
//
// Calls the Apps Script webhook's "getOrders" action. Filtering (riderId,
// dateFrom, dateTo) happens server-side in Code.gs against the sheet, so
// this only ever pulls back the rows actually needed for a given report.
//
// RETRY NOTE: Apps Script Web Apps have inconsistent latency — cold
// container starts, occasional GC pauses, momentary Google infra slowness
// — that isn't correlated with which rider or how much data is being
// requested. A single hard timeout with no retry turns any one of those
// transient blips into a user-facing failure. Retrying once, with a
// longer timeout on the second attempt, absorbs almost all of these
// without masking a genuinely broken webhook (which will fail both tries).

export interface SheetOrderRow {
  "Order ID": string;
  "Order Type": string;
  "Date": string;
  "Time": string;
  "Customer Name": string;
  "Customer Phone": string;
  "Address": string;
  "Restaurant(s)": string;
  "Items": string;
  "Customer Note": string;
  "Subtotal": number | string;
  "Distance (km)": number | string;
  "Round-trip Distance (km)": number | string;
  "Estimated Delivery Time": string;
  "Delivery Fee": number | string;
  "Estimated Fuel Cost": number | string;
  "Rider Commission": number | string;
  "Platform Earning": number | string;
  "Total Rider Payment": number | string;
  "Customer Total": number | string;
  "Rider ID": string;
  "Payment Method": string;
  "Order Status": string;
  "Created At (ISO)": string;
  "Location Link": string;
}

export interface GetOrdersFilters {
  riderId?: string;
  dateFrom?: string; // ISO string
  dateTo?: string;   // ISO string
}

export type GetOrdersResult =
  | { success: true; orders: SheetOrderRow[] }
  | { success: false; error: string };

// First attempt gets a generous timeout to survive a cold start on its
// own; the retry goes even longer in case the cold start needed the
// first call just to spin the container up.
const TIMEOUT_ATTEMPTS_MS = [12000, 18000];

async function fetchOrdersOnce(
  webhookUrl: string,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<GetOrdersResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data = await res.json().catch(() => null);

    if (!data || typeof data.success !== "boolean") {
      throw new Error("Malformed response from Sheets webhook");
    }

    return data as GetOrdersResult;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getOrders(filters: GetOrdersFilters = {}): Promise<GetOrdersResult> {
  const webhookUrl = process.env.SHEETS_WEBHOOK_URL;
  const secret = process.env.SHEETS_WEBHOOK_SECRET;

  if (!webhookUrl || !secret) {
    return { success: false, error: "Sheets webhook not configured" };
  }

  const body = { secret, action: "getOrders", ...filters };

  let lastError = "Sheets webhook timed out";

  for (let attempt = 0; attempt < TIMEOUT_ATTEMPTS_MS.length; attempt++) {
    try {
      return await fetchOrdersOnce(webhookUrl, body, TIMEOUT_ATTEMPTS_MS[attempt]);
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === "AbortError";
      lastError = isTimeout
        ? `Sheets webhook timed out (attempt ${attempt + 1}/${TIMEOUT_ATTEMPTS_MS.length})`
        : err instanceof Error
        ? err.message
        : String(err);

      // Small backoff before retrying so we're not hammering a webhook
      // that's already slow — 500ms is enough to not feel sluggish to
      // the admin waiting on the report.
      const isLastAttempt = attempt === TIMEOUT_ATTEMPTS_MS.length - 1;
      if (!isLastAttempt) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  return { success: false, error: lastError };
}