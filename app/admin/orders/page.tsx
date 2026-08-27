// app/admin/orders/page.tsx
//
// Design notes: this is a dispatch tool, not a marketing surface — the job
// is fast scanning under pressure, not persuasion. The visual language
// borrows from a delivery manifest/ticket stub: a colored spine down the
// left edge of each card signals status at a glance (same idea as color-
// coded shipping labels), transactional data (Order ID, phone, money)
// sits in a monospace face for quick left-to-right scanning, and
// customer-facing text (name, address) stays in a clean sans so the two
// kinds of information are never visually confused with each other.
"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { RIDERS } from "@/lib/config/riders";
import { findRestaurantsForOrder } from "@/lib/config/restaurants";
import {
  customerWhatsAppLink,
  restaurantWhatsAppLink,
  riderWhatsAppLink,
} from "@/lib/whatsapp";
import { OrderStatus } from "@/lib/sheets/updateOrderStatus";
import { SheetOrderRow } from "@/lib/sheets/getOrders";

const POLL_INTERVAL_MS = 20000;

const FILTERABLE_STATUSES: OrderStatus[] = ["New", "Delivered", "Cancelled"];

// Status -> spine/badge color, kept in one place so the card edge and the
// badge always agree with each other.
const STATUS_STYLES: Record<string, { spine: string; badge: string; dot: string }> = {
  New: { spine: "bg-blue-500", badge: "bg-blue-50 text-blue-700 ring-blue-600/10", dot: "bg-blue-500" },
  Delivered: { spine: "bg-emerald-500", badge: "bg-emerald-50 text-emerald-700 ring-emerald-600/10", dot: "bg-emerald-500" },
  Cancelled: { spine: "bg-rose-500", badge: "bg-rose-50 text-rose-700 ring-rose-600/10", dot: "bg-rose-500" },
};

type ActionState =
  | { kind: "idle" }
  | { kind: "loading"; action: string }
  | { kind: "error"; message: string };

function riderName(id: string): string {
  return RIDERS.find((r) => r.id === id)?.name || id;
}

function fmt(n: number | string): string {
  if (typeof n === "string" && n.trim().toUpperCase() === "N/A") return "N/A";
  return `Rs. ${Number(n).toLocaleString("en-PK")}`;
}

export default function OrdersDashboardPage() {
  const [orders, setOrders] = useState<SheetOrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<OrderStatus>("New");
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  const [riderSelections, setRiderSelections] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  // Local-only progress tracking. Order Status in the sheet only ever
  // holds New/Delivered/Cancelled, so these flags aren't persisted — they
  // reset on page reload. Session-visible only.
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [sentToRestaurant, setSentToRestaurant] = useState<Record<string, boolean>>({});
  // Now tracks WHICH rider(s) an order was pinged for, since the new
  // "Notify Riders" section can message any of the three riders, not just
  // the formally assigned one. Keyed by `${orderId}:${riderId}`.
  const [notifiedRiders, setNotifiedRiders] = useState<Record<string, boolean>>({});
  const [sentToRider, setSentToRider] = useState<Record<string, boolean>>({});

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/orders");
      const data = await res.json();
      if (data.success) {
        setOrders(data.orders);
        setError(null);
        setLastRefreshed(new Date());
      } else {
        setError(data.error || "Couldn't load orders.");
      }
    } catch {
      setError("Couldn't reach the orders backend.");
    }
  }, []);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  const visibleOrders = useMemo(() => {
    if (!orders) return [];
    const filtered = orders.filter((o) => o["Order Status"] === statusFilter);

    return [...filtered].sort((a, b) => {
      const aTime = new Date(a["Created At (ISO)"]).getTime();
      const bTime = new Date(b["Created At (ISO)"]).getTime();
      return bTime - aTime;
    });
  }, [orders, statusFilter]);

  const countsByStatus = useMemo(() => {
    const counts: Record<string, number> = { New: 0, Delivered: 0, Cancelled: 0 };
    (orders || []).forEach((o) => {
      const s = o["Order Status"];
      if (s in counts) counts[s] += 1;
    });
    return counts;
  }, [orders]);

  function setAction(orderId: string, state: ActionState) {
    setActionStates((prev) => ({ ...prev, [orderId]: state }));
  }

  async function updateStatus(orderId: string, status: OrderStatus) {
    setAction(orderId, { kind: "loading", action: status });
    try {
      const res = await fetch("/api/admin/update-order-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, status }),
      });
      const data = await res.json();
      if (!data.success) {
        setAction(orderId, { kind: "error", message: data.error || "Couldn't update this order." });
        return;
      }
      setAction(orderId, { kind: "idle" });
      fetchOrders();
    } catch {
      setAction(orderId, { kind: "error", message: "Network error — try again." });
    }
  }

  async function handleAssignRider(orderId: string) {
    const riderId = riderSelections[orderId];
    if (!riderId) {
      setAction(orderId, { kind: "error", message: "Pick a rider first." });
      return;
    }
    setAction(orderId, { kind: "loading", action: "assign" });
    try {
      const res = await fetch("/api/admin/assign-rider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, riderId }),
      });
      const data = await res.json();

      if (!data.success && data.alreadyAssigned) {
        setAction(orderId, {
          kind: "error",
          message: `Already assigned to ${riderName(data.existingRiderId)}.`,
        });
        return;
      }
      if (!data.success) {
        setAction(orderId, { kind: "error", message: data.error || "Couldn't assign a rider." });
        return;
      }

      setAction(orderId, { kind: "idle" });
      fetchOrders();
    } catch {
      setAction(orderId, { kind: "error", message: "Network error — try again." });
    }
  }

  function openWhatsApp(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <main className="min-h-screen bg-[#F7F7F8]">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-purple-600 text-white flex items-center justify-center font-black text-xs tracking-tight shrink-0">
              MB
            </div>
            <div>
              <h1 className="text-[15px] font-bold text-gray-900 tracking-tight leading-none">
                Order Dispatch
              </h1>
              <p className="text-[11px] text-gray-400 mt-1 font-mono">
                {orders ? `${visibleOrders.length} in view` : "loading…"}
                {lastRefreshed && (
                  <span className="text-gray-300">
                    {" "}
                    · synced {lastRefreshed.toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={fetchOrders}
            className="text-xs font-semibold text-purple-700 hover:text-purple-800 px-3 py-2 rounded-lg hover:bg-purple-50 active:bg-purple-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
          >
            Refresh
          </button>
        </div>

        {/* Status filter — segmented, each tab carries its own count so the
            queue depth is visible without opening a filter */}
        <div className="flex gap-1.5 mb-6 p-1 bg-white border border-gray-200/70 rounded-xl w-fit shadow-sm">
          {FILTERABLE_STATUSES.map((s) => {
            const active = statusFilter === s;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 ${
                  active ? "bg-gray-900 text-white shadow-sm" : "text-gray-500 hover:text-gray-800 hover:bg-gray-50"
                }`}
              >
                {s}
                <span
                  className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                    active ? "bg-white/15 text-white" : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {countsByStatus[s]}
                </span>
              </button>
            );
          })}
        </div>

        {error && (
          <div className="text-sm font-medium text-rose-800 bg-rose-50 border border-rose-100 rounded-xl px-4 py-3 mb-4">
            {error} — retrying automatically every {POLL_INTERVAL_MS / 1000}s.
          </div>
        )}

        {orders === null && !error && (
          <div className="flex items-center gap-2.5 text-sm font-medium text-gray-400 px-1 py-8 justify-center">
            <span className="w-3.5 h-3.5 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />
            Loading orders…
          </div>
        )}

        {orders !== null && visibleOrders.length === 0 && (
          <div className="text-center py-16 px-6 bg-white border border-dashed border-gray-200 rounded-2xl">
            <p className="text-sm font-semibold text-gray-600 mb-1">
              No {statusFilter.toLowerCase()} orders right now.
            </p>
            <p className="text-xs text-gray-400">
              {statusFilter === "New"
                ? "New orders will appear here the moment they're placed."
                : `Orders move here once you mark them ${statusFilter.toLowerCase()}.`}
            </p>
          </div>
        )}

        <div className="space-y-3">
          {visibleOrders.map((order) => {
            const orderId = order["Order ID"];
            return (
              <OrderCard
                key={orderId}
                order={order}
                actionState={actionStates[orderId] || { kind: "idle" }}
                riderSelection={riderSelections[orderId] || ""}
                isExpanded={!!expanded[orderId]}
                isConfirmed={!!confirmed[orderId]}
                isSentToRestaurant={!!sentToRestaurant[orderId]}
                isSentToRider={!!sentToRider[orderId]}
                notifiedRiders={notifiedRiders}
                onToggleExpand={() =>
                  setExpanded((prev) => ({ ...prev, [orderId]: !prev[orderId] }))
                }
                onRiderSelect={(riderId) =>
                  setRiderSelections((prev) => ({ ...prev, [orderId]: riderId }))
                }
                onConfirm={() => {
                  openWhatsApp(customerWhatsAppLink(order));
                  setConfirmed((prev) => ({ ...prev, [orderId]: true }));
                }}
                onSendToRestaurant={(restaurantName) => {
                  const match = findRestaurantsForOrder(order["Restaurant(s)"]).find(
                    (r) => r.name === restaurantName
                  );
                  if (!match?.restaurant?.phone) {
                    setAction(orderId, {
                      kind: "error",
                      message: `No WhatsApp number configured for ${restaurantName}.`,
                    });
                    return;
                  }
                  openWhatsApp(restaurantWhatsAppLink(order, match.restaurant));
                  setSentToRestaurant((prev) => ({ ...prev, [orderId]: true }));
                }}
                onAssignRider={() => handleAssignRider(orderId)}
                onSendToRider={() => {
                  const rider = RIDERS.find((r) => r.id === order["Rider ID"]);
                  if (!rider || !rider.phone) {
                    setAction(orderId, {
                      kind: "error",
                      message: "No WhatsApp number for the assigned rider.",
                    });
                    return;
                  }
                  openWhatsApp(riderWhatsAppLink(order, rider));
                  setSentToRider((prev) => ({ ...prev, [orderId]: true }));
                }}
                onNotifyRider={(riderId) => {
                  const rider = RIDERS.find((r) => r.id === riderId);
                  if (!rider || !rider.phone) {
                    setAction(orderId, {
                      kind: "error",
                      message: `No WhatsApp number configured for ${riderName(riderId)}.`,
                    });
                    return;
                  }
                  openWhatsApp(riderWhatsAppLink(order, rider));
                  setNotifiedRiders((prev) => ({ ...prev, [`${orderId}:${riderId}`]: true }));
                }}
                onMarkDelivered={() => updateStatus(orderId, "Delivered")}
                onCancel={() => updateStatus(orderId, "Cancelled")}
              />
            );
          })}
        </div>
      </div>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ${
        style ? style.badge : "bg-gray-100 text-gray-600 ring-gray-500/10"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${style ? style.dot : "bg-gray-400"}`} />
      {status}
    </span>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <div className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-gray-400 pt-0.5">
        {label}
      </div>
      <div className={`text-sm text-gray-900 ${mono ? "font-mono" : "font-medium"}`}>{value}</div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2.5">
      {children}
    </p>
  );
}

function OrderCard({
  order,
  actionState,
  riderSelection,
  isExpanded,
  isConfirmed,
  isSentToRestaurant,
  isSentToRider,
  notifiedRiders,
  onToggleExpand,
  onRiderSelect,
  onConfirm,
  onSendToRestaurant,
  onAssignRider,
  onSendToRider,
  onNotifyRider,
  onMarkDelivered,
  onCancel,
}: {
  order: SheetOrderRow;
  actionState: ActionState;
  riderSelection: string;
  isExpanded: boolean;
  isConfirmed: boolean;
  isSentToRestaurant: boolean;
  isSentToRider: boolean;
  notifiedRiders: Record<string, boolean>;
  onToggleExpand: () => void;
  onRiderSelect: (riderId: string) => void;
  onConfirm: () => void;
  onSendToRestaurant: (restaurantName: string) => void;
  onAssignRider: () => void;
  onSendToRider: () => void;
  onNotifyRider: (riderId: string) => void;
  onMarkDelivered: () => void;
  onCancel: () => void;
}) {
  const status = order["Order Status"];
  const spine = STATUS_STYLES[status]?.spine || "bg-gray-300";
  const loading = actionState.kind === "loading";
  const isFinal = status === "Delivered" || status === "Cancelled";
  const restaurants = findRestaurantsForOrder(order["Restaurant(s)"]);
  const hasRiderPayout =
    order["Estimated Fuel Cost"] !== "N/A" && order["Estimated Fuel Cost"] !== "";
  const orderId = order["Order ID"];

  return (
    <div className="relative bg-white rounded-2xl border border-gray-200/80 overflow-hidden transition-shadow hover:shadow-md shadow-sm">
      {/* Status spine — the manifest-style color cue, always visible even collapsed */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${spine}`} />

      {/* Header row — always visible, click to expand */}
      <button
        onClick={onToggleExpand}
        className="w-full flex items-center justify-between gap-4 pl-6 pr-5 py-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple-500"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[13px] font-bold text-gray-900 font-mono tracking-tight">
              {order["Order ID"]}
            </span>
            {isConfirmed && <Dot color="bg-blue-500" title="Confirmed with customer" />}
            {order["Rider ID"] && <Dot color="bg-indigo-500" title="Rider assigned" />}
            {isSentToRider && <Dot color="bg-orange-500" title="Sent to rider" />}
          </div>
          <p className="text-[13px] text-gray-500 truncate">
            <span className="font-semibold text-gray-700">{order["Customer Name"]}</span>
            <span className="text-gray-300 mx-1.5">·</span>
            {order["Restaurant(s)"]}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <StatusBadge status={status} />
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {isExpanded && (
        <div className="pl-6 pr-5 pb-5 border-t border-gray-100 pt-4 space-y-4">
          {/* Customer & delivery details */}
          <div>
            <SectionLabel>Customer &amp; Delivery</SectionLabel>
            <div className="bg-gray-50/70 rounded-xl px-4 py-3 border border-gray-100">
              <DetailRow label="Name" value={order["Customer Name"]} />
              <DetailRow
                label="Placed"
                value={new Date(order["Created At (ISO)"]).toLocaleString("en-PK", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
                mono
              />
              <DetailRow label="Phone" value={String(order["Customer Phone"])} mono />
              <DetailRow label="Address" value={order["Address"]} />
              {order["Distance (km)"] !== "N/A" && order["Distance (km)"] !== "" && (
                <DetailRow
                  label="Est. delivery"
                  value={`${order["Distance (km)"]} km · ${order["Estimated Delivery Time"] || ""}`}
                  mono
                />
              )}
              {order["Location Link"] &&
                order["Location Link"] !== "Not available" &&
                order["Location Link"] !== "" && (
                  <a
                    href={String(order["Location Link"])}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 flex items-center justify-center gap-2 w-full bg-purple-600 text-white text-sm font-semibold py-2.5 rounded-xl hover:bg-purple-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-1"
                  >
                    📍 Open Location in Google Maps
                  </a>
                )}
            </div>
          </div>

          {/* Items */}
          <div>
            <SectionLabel>Items</SectionLabel>
            <div className="bg-gray-50/70 rounded-xl px-4 py-3 border border-gray-100">
              <p className="text-sm text-gray-800 whitespace-pre-line leading-relaxed">
                {order["Items"]}
              </p>
            </div>
          </div>

          {/* Bill */}
          <div className="rounded-xl overflow-hidden border border-gray-200">
            <div className="px-4 py-3 bg-white text-sm space-y-1.5">
              <div className="flex justify-between">
                <span className="text-gray-500">Subtotal</span>
                <span className="font-mono font-medium text-gray-900">{fmt(order["Subtotal"])}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Delivery fee</span>
                <span className="font-mono font-medium text-gray-900">{fmt(order["Delivery Fee"])}</span>
              </div>
            </div>
            <div className="bg-gray-900 px-4 py-4 flex items-center justify-between">
              <p className="text-xs font-medium text-gray-400">
                Total to collect · {order["Payment Method"]}
              </p>
              <p className="text-lg font-bold font-mono text-white">{fmt(order["Customer Total"])}</p>
            </div>
          </div>

          {/* Primary actions */}
          <div className="space-y-2">
            <ActionButton
              label={isConfirmed ? "Confirmed with customer" : "Confirm order with customer"}
              onClick={onConfirm}
              loading={loading}
              full
              done={isConfirmed}
            />

            {order["Rider ID"] ? (
              <ActionButton
                label={isSentToRider ? "Sent to rider" : `Send to ${riderName(order["Rider ID"])}`}
                onClick={onSendToRider}
                loading={loading}
                full
                variant="secondary"
                done={isSentToRider}
              />
            ) : (
              <div className="flex items-center gap-2">
                <select
                  value={riderSelection}
                  onChange={(e) => onRiderSelect(e.target.value)}
                  className="flex-1 px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
                >
                  <option value="">Select rider…</option>
                  {RIDERS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <ActionButton label="Assign" onClick={onAssignRider} loading={loading} />
              </div>
            )}
          </div>

          {/* Notify riders directly — independent of formal assignment.
              Useful for "who's free right now?" broadcasts before an
              order is officially assigned, or as a backup if the assigned
              rider doesn't respond. Assignment (above) is still what gets
              recorded in the sheet for payout/report purposes — this is
              purely a messaging shortcut. */}
          <div>
            <SectionLabel>Notify Riders</SectionLabel>
            <div className="space-y-2">
              {RIDERS.map((rider) => {
                const notified = !!notifiedRiders[`${orderId}:${rider.id}`];
                return (
                  <ActionButton
                    key={rider.id}
                    label={notified ? `Notified ${rider.name}` : `Send to ${rider.name}`}
                    onClick={() => onNotifyRider(rider.id)}
                    loading={loading}
                    disabled={!rider.phone}
                    title={!rider.phone ? "No WhatsApp number configured" : undefined}
                    full
                    variant="rider"
                    done={notified}
                  />
                );
              })}
            </div>
          </div>

          {/* Send to restaurant(s) */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <SectionLabel>Send to restaurant{restaurants.length > 1 ? "s" : ""}</SectionLabel>
              {isSentToRestaurant && (
                <span className="text-[11px] font-semibold text-emerald-600">Sent</span>
              )}
            </div>
            <div className="space-y-2">
              {restaurants.map(({ name, restaurant }) => (
                <ActionButton
                  key={name}
                  label={name}
                  onClick={() => onSendToRestaurant(name)}
                  loading={loading}
                  disabled={!restaurant?.phone}
                  title={!restaurant?.phone ? "No WhatsApp number configured" : undefined}
                  full
                  variant="whatsapp"
                />
              ))}
            </div>
          </div>

          {/* Rider payout (internal) — dashed top border reads as a
              tear-off receipt stub, visually separating "what the customer
              sees" from "what only staff sees" */}
          {hasRiderPayout && (
            <div>
              <SectionLabel>Rider payout · internal</SectionLabel>
              <div className="bg-orange-50/70 rounded-xl px-4 py-3 border border-orange-100">
                <DetailRow label="Round-trip" value={`${order["Round-trip Distance (km)"]} km`} mono />
                <DetailRow label="Fuel cost" value={fmt(order["Estimated Fuel Cost"])} mono />
                <DetailRow label="Commission" value={fmt(order["Rider Commission"])} mono />
                <DetailRow label="Platform share" value={fmt(order["Platform Earning"])} mono />
                <div className="flex items-start gap-3 pt-2.5 mt-1.5 border-t border-dashed border-orange-300">
                  <div className="w-28 shrink-0 text-[11px] font-bold uppercase tracking-wide text-orange-700 pt-0.5">
                    Total to rider
                  </div>
                  <div className="text-sm font-bold font-mono text-orange-700">
                    {fmt(order["Total Rider Payment"])}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Status actions */}
          {!isFinal && (
            <div className="flex gap-2 pt-3 border-t border-gray-100">
              <ActionButton
                label="Mark delivered"
                onClick={onMarkDelivered}
                loading={loading}
                variant="secondary"
              />
              <ActionButton
                label="Cancel order"
                onClick={onCancel}
                loading={loading}
                variant="danger"
              />
            </div>
          )}

          {actionState.kind === "error" && (
            <p className="text-xs font-medium text-rose-800 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">
              {actionState.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Dot({ color, title }: { color: string; title: string }) {
  return <span className={`w-1.5 h-1.5 rounded-full ${color}`} title={title} />;
}

function ActionButton({
  label,
  onClick,
  loading,
  disabled,
  title,
  full,
  done,
  variant = "primary",
}: {
  label: string;
  onClick: () => void;
  loading: boolean;
  disabled?: boolean;
  title?: string;
  full?: boolean;
  done?: boolean;
  variant?: "primary" | "secondary" | "danger" | "whatsapp" | "rider";
}) {
  const base =
    "px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1";
  const colors = done
    ? "bg-gray-100 text-gray-500 focus-visible:ring-gray-300"
    : {
        primary: "bg-purple-600 text-white hover:bg-purple-700 focus-visible:ring-purple-500",
        secondary: "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 focus-visible:ring-gray-300",
        danger: "bg-white text-rose-600 border border-rose-200 hover:bg-rose-50 focus-visible:ring-rose-400",
        whatsapp: "bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-500",
        rider: "bg-orange-500 text-white hover:bg-orange-600 focus-visible:ring-orange-400",
      }[variant];

  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      title={title}
      className={`${base} ${colors} ${full ? "w-full text-center" : ""}`}
    >
      {loading ? "…" : label}
    </button>
  );
}