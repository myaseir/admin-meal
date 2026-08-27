// lib/sheets/markOrdersPaid.ts
//
// Mirrors getOrders/updateOrderStatus: POST to the Apps Script Web App with
// an `action` field and the shared secret. Adjust the env var names below
// to whatever getOrders.ts already uses (I'm guessing at the names here).

const APPS_SCRIPT_URL = process.env.SHEETS_WEBHOOK_URL;
const APPS_SCRIPT_SECRET = process.env.SHEETS_WEBHOOK_SECRET;

interface MarkOrdersPaidResult {
  success: boolean;
  updated?: number;
  error?: string;
}

export async function markOrdersPaid(orderIds: string[]): Promise<MarkOrdersPaidResult> {
  // Fail loudly and specifically instead of letting fetch() crash on
  // undefined with a cryptic "reading 'toString'" error — this way the
  // actual problem (which var is missing) surfaces in the reports UI.
  if (!APPS_SCRIPT_URL || !APPS_SCRIPT_SECRET) {
    return {
      success: false,
      error:
        `Missing env var(s) — SHEETS_WEBHOOK_URL: ${APPS_SCRIPT_URL ? "OK" : "MISSING"}, ` +
        `SHEETS_WEBHOOK_SECRET: ${APPS_SCRIPT_SECRET ? "OK" : "MISSING"}. ` +
        `Check .env.local and fully restart the dev server (not just hot-reload).`,
    };
  }

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: APPS_SCRIPT_SECRET,
        action: "markOrdersPaid",
        orderIds,
      }),
    });

    if (!res.ok) {
      return { success: false, error: `Apps Script responded with ${res.status}` };
    }

    const data = await res.json();
    if (!data.success) {
      return { success: false, error: data.error || "Apps Script reported failure." };
    }

    return { success: true, updated: data.updated };
  } catch (err) {
    console.error("markOrdersPaid error:", err);
    return { success: false, error: "Network error while contacting Apps Script." };
  }
}