// app/admin/assign-rider/page.tsx
//
// Same visual language as the orders dashboard: purple brand chip, mono
// face for Order IDs, status-colored dots. The suggestion list is a real
// combobox — arrow keys move the highlight, Enter selects, Escape closes
// — since a lookup field that only works by mouse click isn't finished.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RIDERS } from "@/lib/config/riders";

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; message: string }
  | { kind: "already"; message: string }
  | { kind: "error"; message: string };

// Keyed by the exact column names from the sheet (Code.gs COLUMNS).
type OrderRow = {
  "Order ID": string;
  "Order Type": string;
  "Customer Name": string;
  "Restaurant(s)": string;
  "Order Status": string;
  "Rider ID": string;
  [key: string]: string | number;
};

const MAX_SUGGESTIONS = 6;

const STATUS_DOT: Record<string, string> = {
  New: "bg-blue-500",
  Delivered: "bg-emerald-500",
  Cancelled: "bg-rose-500",
};

// Wraps the substring of `text` matching `query` in a highlight span, so
// it's visible at a glance which part of the Order ID actually matched —
// useful once an order number is 4+ digits and easy to mistype.
function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-purple-100 text-purple-800 rounded-sm px-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export default function AssignRiderPage() {
  const [orderId, setOrderId] = useState("");
  const [riderId, setRiderId] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const [allOrders, setAllOrders] = useState<OrderRow[] | null>(null);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the order list once on mount so keystrokes filter locally instead
  // of round-tripping to the sheet on every character.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/admin/orders");
        const data = await res.json();
        if (cancelled) return;

        if (data.success) {
          setAllOrders(data.orders);
        } else {
          setOrdersError(data.error || "Couldn't load orders.");
        }
      } catch {
        if (!cancelled) setOrdersError("Couldn't reach the orders backend.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const trimmedInput = orderId.trim();

  const suggestions = useMemo(() => {
    if (!allOrders || trimmedInput === "") return [];
    const needle = trimmedInput.toLowerCase();
    return allOrders
      .filter((o) => String(o["Order ID"]).toLowerCase().includes(needle))
      .slice(0, MAX_SUGGESTIONS);
  }, [allOrders, trimmedInput]);

  const exactMatch = useMemo(() => {
    if (!allOrders || trimmedInput === "") return null;
    return (
      allOrders.find(
        (o) => String(o["Order ID"]).toLowerCase() === trimmedInput.toLowerCase()
      ) || null
    );
  }, [allOrders, trimmedInput]);

  // Only claim "not found" once we actually have a list to check against —
  // if the orders fetch failed, we can't know either way, so stay silent
  // and let the server be the source of truth on submit. This is already
  // live (no submit needed) — it recomputes on every keystroke since it
  // just derives from `suggestions`, which itself is a useMemo on trimmedInput.
  const knownNotFound =
    allOrders !== null && trimmedInput !== "" && suggestions.length === 0;

  // Keep the keyboard highlight in range whenever the suggestion list changes size
  useEffect(() => {
    if (highlightIndex >= suggestions.length) setHighlightIndex(suggestions.length - 1);
  }, [suggestions.length, highlightIndex]);

  function handleSelectSuggestion(order: OrderRow) {
    setOrderId(String(order["Order ID"]));
    setShowDropdown(false);
    setHighlightIndex(-1);
  }

  function handleBlur() {
    // Delay hiding so a click on a dropdown item registers before it unmounts.
    blurTimeout.current = setTimeout(() => {
      setShowDropdown(false);
      setHighlightIndex(-1);
    }, 150);
  }

  function handleFocus() {
    if (blurTimeout.current) clearTimeout(blurTimeout.current);
    if (trimmedInput !== "") setShowDropdown(true);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showDropdown || suggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter" && highlightIndex >= 0) {
      e.preventDefault();
      handleSelectSuggestion(suggestions[highlightIndex]);
    } else if (e.key === "Escape") {
      setShowDropdown(false);
      setHighlightIndex(-1);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderId.trim() || !riderId) {
      setStatus({ kind: "error", message: "Enter an Order ID and pick a rider." });
      return;
    }
    if (knownNotFound) {
      setStatus({ kind: "error", message: `Order not found: ${trimmedInput}` });
      return;
    }

    setStatus({ kind: "loading" });

    try {
      const res = await fetch("/api/admin/assign-rider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: orderId.trim(), riderId }),
      });
      const data = await res.json();

      if (data.success && !data.alreadyAssigned) {
        setStatus({
          kind: "success",
          message: `Assigned ${orderId.trim()} to ${riderDisplayName(riderId)}.`,
        });
        setOrderId("");
        setRiderId("");
      } else if (data.alreadyAssigned) {
        const existing = riderDisplayName(data.existingRiderId) || data.existingRiderId;
        setStatus({
          kind: data.success ? "success" : "already",
          message: data.success
            ? `Already assigned to ${existing} (no change).`
            : `Already assigned to ${existing}.`,
        });
      } else {
        setStatus({ kind: "error", message: data.error || "Assignment failed." });
      }
    } catch {
      setStatus({ kind: "error", message: "Network error — check your connection and try again." });
    }
  };

  function riderDisplayName(id?: string): string {
    return RIDERS.find((r) => r.id === id)?.name || id || "";
  }

  return (
    <main className="min-h-screen bg-[#F7F7F8] p-6 flex flex-col items-center">
      <div className="max-w-md w-full">
        {/* Brand header — matches the orders dashboard */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg bg-purple-600 text-white flex items-center justify-center font-black text-xs tracking-tight shrink-0">
            MB
          </div>
          <div>
            <h1 className="text-[15px] font-bold text-gray-900 tracking-tight leading-none">
              Assign Rider
            </h1>
            <p className="text-[11px] text-gray-400 mt-1 font-mono">
              {allOrders ? `${allOrders.length} orders indexed` : "loading…"}
            </p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200/80">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">
                Order ID
              </label>
              <input
                type="text"
                placeholder="MB-260826-0004"
                value={orderId}
                onChange={(e) => {
                  setOrderId(e.target.value);
                  setShowDropdown(e.target.value.trim() !== "");
                  setHighlightIndex(-1);
                }}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                autoComplete="off"
                role="combobox"
                aria-expanded={showDropdown && suggestions.length > 0}
                aria-invalid={knownNotFound}
                className={`w-full px-4 py-3 bg-gray-50 border rounded-xl text-sm font-mono font-medium tracking-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 transition-colors ${
                  knownNotFound ? "border-rose-300 bg-rose-50/40" : "border-gray-200"
                }`}
              />

              {showDropdown && suggestions.length > 0 && (
                <ul className="absolute z-10 mt-1.5 w-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-64 overflow-y-auto">
                  {suggestions.map((o, i) => {
                    const oid = String(o["Order ID"]);
                    const active = i === highlightIndex;
                    return (
                      <li key={oid}>
                        <button
                          type="button"
                          onMouseEnter={() => setHighlightIndex(i)}
                          onClick={() => handleSelectSuggestion(o)}
                          className={`w-full text-left px-4 py-2.5 transition-colors flex items-start gap-2.5 ${
                            active ? "bg-purple-50" : "hover:bg-gray-50"
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                              STATUS_DOT[o["Order Status"]] || "bg-gray-300"
                            }`}
                          />
                          <div className="min-w-0">
                            <div className="text-sm font-bold font-mono text-gray-900">
                              <HighlightMatch text={oid} query={trimmedInput} />
                            </div>
                            <div className="text-xs text-gray-500 truncate">
                              {o["Customer Name"]} · {o["Restaurant(s)"]}
                              {o["Rider ID"] ? ` · rider: ${riderDisplayName(String(o["Rider ID"]))}` : ""}
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {ordersError && (
                <p className="mt-1.5 text-xs font-medium text-gray-400">
                  Live lookup unavailable ({ordersError}) — you can still submit manually.
                </p>
              )}

              {!ordersError && knownNotFound && (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-rose-600">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                  No order matches "{trimmedInput}"
                </p>
              )}

              {!ordersError && exactMatch && (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-gray-500">
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      STATUS_DOT[exactMatch["Order Status"]] || "bg-gray-300"
                    }`}
                  />
                  {exactMatch["Customer Name"]} · {exactMatch["Restaurant(s)"]} ·{" "}
                  {exactMatch["Order Status"]}
                </p>
              )}
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">
                Rider
              </label>
              <select
                value={riderId}
                onChange={(e) => setRiderId(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
              >
                <option value="">Select a rider…</option>
                {RIDERS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              disabled={status.kind === "loading" || knownNotFound}
              className="w-full bg-purple-600 text-white py-3 rounded-xl font-bold text-sm tracking-tight hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-1"
            >
              {status.kind === "loading" ? "Assigning…" : "Assign Rider"}
            </button>
          </form>

          {status.kind === "success" && (
            <p className="mt-4 text-sm font-semibold text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-xl p-3 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
              {status.message}
            </p>
          )}
          {status.kind === "already" && (
            <p className="mt-4 text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-100 rounded-xl p-3 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
              {status.message}
            </p>
          )}
          {status.kind === "error" && (
            <p className="mt-4 text-sm font-semibold text-rose-800 bg-rose-50 border border-rose-100 rounded-xl p-3 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
              {status.message}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}