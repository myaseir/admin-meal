// app/admin/reports/page.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { RIDERS } from "@/lib/config/riders";

interface ReportTotals {
  orderCount: number;
  totalRevenue: number;
  totalDeliveryCharges: number;
  totalFuelCost: number;
  totalRiderCommission: number;
  totalPlatformCommission: number;
  unmeasuredRouteCount: number;
}

interface RiderReport extends ReportTotals {
  riderId: string;
}

interface RiderOwedSummary {
  riderId: string;
  unpaidOrderCount: number;
  amountOwed: number;
}

interface PayoutStatusSummary {
  overall: RiderOwedSummary;
  byRider: RiderOwedSummary[];
}

interface OrderDetail {
  id: string;
  orderDate: string;
  orderTime: string;
  userName: string;
  userPhone: string;
  address: string;
  locationLink?: string;
  estimatedDeliveryTime?: string;
  estimatedDistanceKm?: number | string;
  totalRoundTripKm?: number | string;
  orderItems: string;
  subtotal?: number;
  deliveryFee?: number;
  estimatedFuelCost?: number | string;
  riderCommission?: number | string;
  platformShare?: number | string;
  totalRiderPayment?: number | string;
  total: number;
  payoutStatus?: string;
}

interface ReportResponse {
  success: boolean;
  overall?: ReportTotals;
  byRider?: RiderReport[];
  orders?: OrderDetail[];
  unassignedCount?: number;
  payoutStatus?: PayoutStatusSummary;
  error?: string;
}

const ORDERS_PAGE_SIZE = 5;

function riderName(id: string): string {
  return RIDERS.find((r) => r.id === id)?.name || id;
}

function fmt(n: number | string | undefined): string {
  if (n === undefined || n === "N/A" || Number.isNaN(Number(n))) return "N/A";
  return "Rs. " + Number(n).toLocaleString("en-PK", { maximumFractionDigits: 0 });
}

export default function ReportsPage() {
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [riderFilter, setRiderFilter] = useState<string>(""); // "" = all riders
  const [data, setData] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const [isMarkingPaid, setIsMarkingPaid] = useState(false);
  const [markPaidMessage, setMarkPaidMessage] = useState<string | null>(null);

  // --- In-depth order details: hidden by default, fetched only on demand ---
  const [showInDepth, setShowInDepth] = useState(false);
  const [orderDetails, setOrderDetails] = useState<OrderDetail[] | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [visibleOrderCount, setVisibleOrderCount] = useState(ORDERS_PAGE_SIZE);

  const fetchReport = useCallback(
    async (targetPeriod: "week" | "month", targetRider: string, includeOrders = false) => {
      const res = await fetch("/api/admin/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period: targetPeriod, riderId: targetRider || undefined, includeOrders }),
      });
      return res.json();
    },
    []
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json: ReportResponse = await fetchReport(period, riderFilter, false);
      if (!json.success) {
        setError(json.error || "Failed to load report");
        setData(null);
      } else {
        setData(json);
      }
    } catch {
      setError("Network error — check your connection and try again.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [period, riderFilter, fetchReport]);

  useEffect(() => {
    loadData();
    setShowInDepth(false);
    setOrderDetails(null);
    setDetailsError(null);
    setVisibleOrderCount(ORDERS_PAGE_SIZE);
    setMarkPaidMessage(null);
  }, [loadData]);

  async function refreshDetailsIfOpen() {
    if (!showInDepth) return;
    setLoadingDetails(true);
    try {
      const json: ReportResponse = await fetchReport(period, riderFilter, true);
      if (json.success && json.orders) setOrderDetails(json.orders);
    } finally {
      setLoadingDetails(false);
    }
  }

  async function handleToggleInDepth() {
    if (showInDepth) {
      setShowInDepth(false);
      return;
    }
    setShowInDepth(true);
    if (orderDetails !== null) return;

    setLoadingDetails(true);
    setDetailsError(null);
    try {
      const json: ReportResponse = await fetchReport(period, riderFilter, true);
      if (!json.success || !json.orders) {
        setDetailsError(json.error || "Failed to load order details");
        setOrderDetails(null);
      } else {
        setOrderDetails(json.orders);
        setVisibleOrderCount(ORDERS_PAGE_SIZE);
      }
    } catch {
      setDetailsError("Network error — check your connection and try again.");
      setOrderDetails(null);
    } finally {
      setLoadingDetails(false);
    }
  }

  function handleShowMoreOrders() {
    if (!orderDetails) return;
    setVisibleOrderCount((count) => Math.min(count + ORDERS_PAGE_SIZE, orderDetails.length));
  }

  function handleShowLessOrders() {
    setVisibleOrderCount(ORDERS_PAGE_SIZE);
  }

  const handleDownloadRiderPDF = async (pdfPeriod: "week" | "month") => {
    if (!riderFilter) {
      alert("Please select a specific rider first.");
      return;
    }

    setIsExporting(true);
    try {
      const res = await fetch(
        `/api/admin/reports/pdf?riderId=${encodeURIComponent(riderFilter)}&period=${pdfPeriod}`
      );

      if (!res.ok) {
        const message = await res.text().catch(() => "");
        throw new Error(message || "Failed to generate PDF.");
      }

      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename =
        match?.[1] ||
        `${riderName(riderFilter).replace(/\s+/g, "_")}_${pdfPeriod === "week" ? "Weekly" : "Monthly"}_Payout.pdf`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("Failed to generate PDF. Please try again.");
      console.error(err);
    } finally {
      setIsExporting(false);
    }
  };

  // Marks every unpaid, delivered order for the selected rider + period as
  // paid. This is a real mutation (it writes to the sheet), so it's gated
  // behind an explicit confirm — separate from just downloading the PDF.
  const handleMarkAsPaid = async () => {
    if (!riderFilter) {
      alert("Select a specific rider first.");
      return;
    }
    const owedForRider = data?.payoutStatus?.byRider.find((r) => r.riderId === riderFilter);
    const amount = owedForRider?.amountOwed ?? 0;
    const count = owedForRider?.unpaidOrderCount ?? 0;

    if (count === 0) {
      alert("Nothing to mark — this rider has no unpaid delivered orders in this period.");
      return;
    }

    const confirmed = window.confirm(
      `Mark ${fmt(amount)} across ${count} order(s) as paid to ${riderName(riderFilter)}?\n\n` +
        `This can't be undone from here — only do this after the payment has actually been sent.`
    );
    if (!confirmed) return;

    setIsMarkingPaid(true);
    setMarkPaidMessage(null);
    try {
      const res = await fetch("/api/admin/reports/mark-paid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ riderId: riderFilter, period }),
      });
      const json = await res.json();
      if (!json.success) {
        setMarkPaidMessage(`✕ ${json.error || "Failed to mark as paid."}`);
        return;
      }
      setMarkPaidMessage(`✓ Marked ${json.markedCount} order(s) as paid (${fmt(json.amountPaid)}).`);
      await loadData();
      await refreshDetailsIfOpen();
    } catch {
      setMarkPaidMessage("✕ Network error while marking as paid.");
    } finally {
      setIsMarkingPaid(false);
    }
  };

  const visibleOrders = orderDetails ? orderDetails.slice(0, visibleOrderCount) : [];
  const hasMoreOrders = orderDetails !== null && visibleOrderCount < orderDetails.length;
  const canShowLess = visibleOrderCount > ORDERS_PAGE_SIZE;

  const owedForSelectedRider = riderFilter
    ? data?.payoutStatus?.byRider.find((r) => r.riderId === riderFilter)
    : null;

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 pb-20">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-5 gap-4">
          <h1 className="font-black uppercase text-sm tracking-widest text-gray-900">
            Performance Reports
          </h1>

          {riderFilter && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => handleDownloadRiderPDF("week")}
                disabled={isExporting}
                className="px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white text-[11px] font-bold uppercase tracking-wider rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2 shadow-sm"
              >
                {isExporting ? "Generating..." : "↓ Download Weekly PDF"}
              </button>
              <button
                onClick={() => handleDownloadRiderPDF("month")}
                disabled={isExporting}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-[11px] font-bold uppercase tracking-wider rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2 shadow-sm"
              >
                {isExporting ? "Generating..." : "↓ Download Monthly PDF"}
              </button>
              <button
                onClick={handleMarkAsPaid}
                disabled={isMarkingPaid || !owedForSelectedRider || owedForSelectedRider.unpaidOrderCount === 0}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold uppercase tracking-wider rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2 shadow-sm"
              >
                {isMarkingPaid ? "Marking..." : "✓ Mark as Paid"}
              </button>
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <div className="flex bg-gray-200/60 p-1 rounded-xl">
            <button
              onClick={() => setPeriod("week")}
              className={`px-5 py-2 rounded-lg font-bold uppercase tracking-widest text-[11px] transition-all ${
                period === "week" ? "bg-white shadow-sm text-purple-600" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              This Week
            </button>
            <button
              onClick={() => setPeriod("month")}
              className={`px-5 py-2 rounded-lg font-bold uppercase tracking-widest text-[11px] transition-all ${
                period === "month" ? "bg-white shadow-sm text-purple-600" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              This Month
            </button>
          </div>

          <select
            value={riderFilter}
            onChange={(e) => setRiderFilter(e.target.value)}
            className="px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-800 shadow-sm outline-none focus:ring-2 focus:ring-purple-500 cursor-pointer"
          >
            <option value="">All Riders (Overview)</option>
            {RIDERS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        {markPaidMessage && (
          <p
            className={`text-sm font-bold rounded-xl p-4 mb-6 border ${
              markPaidMessage.startsWith("✓")
                ? "text-emerald-700 bg-emerald-50 border-emerald-100"
                : "text-red-700 bg-red-50 border-red-100"
            }`}
          >
            {markPaidMessage}
          </p>
        )}

        {loading && (
          <div className="flex items-center gap-3 mb-6">
            <div className="w-5 h-5 border-2 border-purple-600 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-sm font-bold text-gray-400">Fetching live data...</p>
          </div>
        )}

        {error && (
          <p className="text-sm font-bold text-red-700 bg-red-50 border border-red-100 rounded-xl p-4 mb-6">
            ✕ {error}
          </p>
        )}

        {data && data.overall && (
          <div className="space-y-8">
            {/* 1. Summary Totals */}
            <div>
              <h2 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-3">Overall Economics</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                <SummaryCard label="Total Orders" value={String(data.overall.orderCount)} />
                <SummaryCard label="Total Revenue" value={fmt(data.overall.totalRevenue)} highlight />
                <SummaryCard label="Delivery Fees" value={fmt(data.overall.totalDeliveryCharges)} />
                <SummaryCard label="Total Fuel Cost" value={fmt(data.overall.totalFuelCost)} />
                <SummaryCard label="Total Rider Comm." value={fmt(data.overall.totalRiderCommission)} />
                <SummaryCard label="Total Rider Payout" value={fmt(data.overall.totalFuelCost + data.overall.totalRiderCommission)} />
                <SummaryCard label="Platform Profit" value={fmt(data.overall.totalPlatformCommission)} highlight />
                <SummaryCard
                  label="Amount Still Owed"
                  value={fmt(data.payoutStatus?.overall.amountOwed ?? 0)}
                  accent="emerald"
                />
              </div>

              {data.overall.unmeasuredRouteCount > 0 && (
                <p className="text-[12px] font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl p-3 mt-4">
                  ⚠ {data.overall.unmeasuredRouteCount} order(s) in this period had an unmeasured
                  route ("N/A"). Their fuel costs are not included in the totals above.
                </p>
              )}
            </div>

            {/* 2. Overview Table (Only when "All Riders" is selected) */}
            {!riderFilter && data.byRider && data.byRider.length > 0 && (
              <div>
                <h2 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-3">Rider Breakdown</h2>
                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-left text-[10px] font-black uppercase tracking-widest text-gray-500">
                        <th className="px-5 py-4 border-b border-gray-200">Rider</th>
                        <th className="px-5 py-4 border-b border-gray-200">Completed Orders</th>
                        <th className="px-5 py-4 border-b border-gray-200">Commission Earned</th>
                        <th className="px-5 py-4 border-b border-gray-200">Fuel Cost</th>
                        <th className="px-5 py-4 border-b border-gray-200">Total Payout</th>
                        <th className="px-5 py-4 border-b border-gray-200">Still Owed</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.byRider.map((r) => {
                        const owed = data.payoutStatus?.byRider.find((o) => o.riderId === r.riderId);
                        return (
                          <tr key={r.riderId} className="hover:bg-gray-50 transition-colors">
                            <td className="px-5 py-3 font-bold text-gray-900">{riderName(r.riderId)}</td>
                            <td className="px-5 py-3 text-gray-600 font-medium">{r.orderCount}</td>
                            <td className="px-5 py-3 font-black text-purple-600">{fmt(r.totalRiderCommission)}</td>
                            <td className="px-5 py-3 text-gray-600 font-medium">{fmt(r.totalFuelCost)}</td>
                            <td className="px-5 py-3 font-black text-gray-900">{fmt(r.totalRiderCommission + r.totalFuelCost)}</td>
                            <td className="px-5 py-3 font-black text-emerald-600">
                              {owed && owed.unpaidOrderCount > 0 ? fmt(owed.amountOwed) : "Paid up"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 3. In-Depth Order Details */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-black uppercase tracking-widest text-gray-400">
                  In-Depth Order Details
                  {orderDetails && orderDetails.length > 0 ? ` (${orderDetails.length})` : ""}
                </h2>
                <button
                  onClick={handleToggleInDepth}
                  disabled={loadingDetails}
                  className="px-4 py-2 bg-white border border-gray-200 hover:border-purple-300 hover:text-purple-700 text-gray-700 text-[11px] font-bold uppercase tracking-wider rounded-lg transition-colors shadow-sm disabled:opacity-50"
                >
                  {loadingDetails ? "Loading..." : showInDepth ? "Hide In-Depth Data" : "Show In-Depth Data"}
                </button>
              </div>

              {detailsError && (
                <p className="text-sm font-bold text-red-700 bg-red-50 border border-red-100 rounded-xl p-4 mb-4">
                  ✕ {detailsError}
                </p>
              )}

              {showInDepth && !loadingDetails && orderDetails && orderDetails.length === 0 && (
                <p className="text-sm font-medium text-gray-400 bg-white border border-gray-200 rounded-xl p-4">
                  No orders in this period.
                </p>
              )}

              {showInDepth && visibleOrders.length > 0 && (
                <>
                  <div className="space-y-5">
                    {visibleOrders.map((order, idx) => (
                      <div key={order.id || idx} className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm transition-shadow hover:shadow-md">
                        <div className="bg-gray-50 border-b border-gray-200 px-5 py-3 flex flex-wrap justify-between items-center gap-2">
                          <span className="text-[11px] font-black uppercase tracking-widest text-gray-500 flex items-center gap-2">
                            Customer & Delivery Details
                            {order.payoutStatus === "Paid" && (
                              <span className="bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded-md text-[10px] normal-case tracking-normal font-bold">
                                Paid
                              </span>
                            )}
                          </span>
                          <div className="flex gap-4 items-center">
                            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Placed</span>
                            <span className="text-xs font-bold text-gray-900">
                              {order.orderDate} · {order.orderTime}
                            </span>
                          </div>
                        </div>

                        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-1">
                            <div className="flex gap-2 items-baseline mb-2">
                              <p className="text-base font-black text-gray-900">{order.userName}</p>
                              <span className="text-xs font-bold text-gray-500">Phone {order.userPhone}</span>
                            </div>

                            <div className="text-sm text-gray-700 bg-gray-50 p-3 rounded-xl border border-gray-100 mb-3">
                              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">Address</span>
                              {order.address}
                            </div>

                            <div className="flex flex-wrap gap-2 text-xs font-bold text-gray-700 mb-3">
                              <span className="bg-purple-50 text-purple-700 px-2.5 py-1.5 rounded-lg border border-purple-100">
                                Est. Delivery {order.estimatedDistanceKm || "N/A"} km · {order.estimatedDeliveryTime || "N/A"}
                              </span>
                              {order.locationLink && order.locationLink !== "Not available" && (
                                <a
                                  href={order.locationLink}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="bg-blue-50 text-blue-700 hover:bg-blue-100 px-2.5 py-1.5 rounded-lg border border-blue-100 transition-colors flex items-center gap-1"
                                >
                                  📍 Open Location in Google Maps
                                </a>
                              )}
                            </div>
                          </div>

                          <div>
                            <h3 className="text-[10px] font-black uppercase tracking-widest text-purple-600 mb-2">
                              Items to Prepare
                            </h3>
                            <div className="bg-orange-50/50 border border-orange-100 rounded-xl p-4 text-sm text-gray-800 whitespace-pre-wrap font-medium h-[calc(100%-24px)]">
                              {order.orderItems}
                            </div>
                          </div>
                        </div>

                        <div className="bg-gray-900 text-white p-5 border-t border-gray-800">
                          <div className="flex justify-between items-center mb-4">
                            <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                              Rider Payout (Internal)
                            </h3>
                            <div className="text-xs font-bold text-gray-400 flex gap-4">
                              <span>Subtotal {fmt(order.subtotal)}</span>
                              <span>Delivery Fee {fmt(order.deliveryFee)}</span>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 bg-gray-800/50 p-4 rounded-xl border border-gray-700/50">
                            <EconomicsValue label="Round-Trip Dist." value={`${order.totalRoundTripKm || "N/A"} km`} />
                            <EconomicsValue label="Est. Fuel Cost" value={fmt(order.estimatedFuelCost)} color="text-gray-200" />
                            <EconomicsValue label="Rider Commission" value={fmt(order.riderCommission)} color="text-purple-400" />
                            <EconomicsValue label="Platform Earning" value={fmt(order.platformShare)} color="text-emerald-400" />
                            <div className="border-l border-gray-700 pl-4">
                              <EconomicsValue label="Total to Rider" value={fmt(order.totalRiderPayment)} color="text-white text-lg" />
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-center gap-3 mt-5">
                    {hasMoreOrders && (
                      <button
                        onClick={handleShowMoreOrders}
                        className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-[11px] font-bold uppercase tracking-wider rounded-lg transition-colors shadow-sm"
                      >
                        Show {Math.min(ORDERS_PAGE_SIZE, orderDetails!.length - visibleOrderCount)} More
                      </button>
                    )}
                    {canShowLess && (
                      <button
                        onClick={handleShowLessOrders}
                        className="px-5 py-2.5 bg-white border border-gray-200 hover:border-gray-300 text-gray-700 text-[11px] font-bold uppercase tracking-wider rounded-lg transition-colors shadow-sm"
                      >
                        Show Less
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function SummaryCard({
  label,
  value,
  highlight = false,
  accent,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  accent?: "emerald";
}) {
  const accentClasses = accent === "emerald" ? "bg-emerald-50 border-emerald-100 text-emerald-800" : "";
  return (
    <div
      className={`p-4 rounded-2xl shadow-sm border transition-colors ${
        highlight
          ? "bg-gray-900 border-gray-900 text-white"
          : accentClasses || "bg-white border-gray-100 hover:border-purple-200"
      }`}
    >
      <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${highlight ? "text-gray-400" : accent ? "text-emerald-600" : "text-gray-400"}`}>
        {label}
      </p>
      <p className="text-lg font-black tracking-tight">{value}</p>
    </div>
  );
}

function EconomicsValue({ label, value, color = "text-white" }: { label: string; value: string | number; color?: string }) {
  return (
    <div>
      <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-1">{label}</p>
      <p className={`font-black tracking-tight ${color}`}>{value}</p>
    </div>
  );
}