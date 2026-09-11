// lib/whatsapp.ts
//
// Builds wa.me deep links for messaging the customer, restaurant(s), and
// rider. Same mechanism as the coordinator dispatch link in
// lib/email/orderEmailTemplate.ts (wa.me/<phone>?text=<url-encoded message>).
//
// wa.me expects `phone` as digits only, international format, no "+".
// Every number that reaches a link (customer, restaurant, rider) goes
// through normalizePhone() below — don't build a wa.me URL from a raw
// phone value anywhere else in this file.

import { SheetOrderRow } from "@/lib/sheets/getOrders";
import { Rider } from "@/lib/config/riders";
import { Restaurant } from "@/lib/config/restaurants";

export function buildWhatsAppLink(phone: string, message: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

// Best-effort normalization into the digits-only, country-code-prefixed
// shape wa.me needs. Assumes Pakistani numbers: strips everything but
// digits, then maps a leading 0 (local format, e.g. "03169030178") to the
// 92 country code. Numbers already in international format
// ("923169030178") pass through unchanged.
//
// Accepts string | number because the Sheets webhook can return a phone
// cell as either — Google Sheets treats an unformatted numeric-looking
// cell as a number, and JSON.stringify on the Apps Script side doesn't
// force it back to a string. Coercing here means every call site (order
// data, config files) is safe regardless of which type actually shows up.
export function normalizePhone(raw: string | number | null | undefined): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("92")) return digits;
  if (digits.startsWith("0")) return "92" + digits.slice(1);
  return digits;
}

// [[DESC]]...[[/DESC]] markers are an HTML-email-only convention (see
// buildOrderEmailHtml's formatOrderItems, which turns them into a styled
// <span>). A plain-text WhatsApp message has no styling to apply, so this
// just strips the literal tags and keeps the description text on its own
// line — showing the raw "[[DESC]]...[[/DESC]]" tags to a rider or
// restaurant would look like a bug, not a description.
function stripDescMarkersForPlainText(items: string): string {
  return items.replace(/\[\[DESC\]\]([\s\S]*?)\[\[\/DESC\]\]/g, "$1");
}

// Reads "Customer Note" defensively via a loose cast, same reasoning as
// the admin dashboard's getCustomerNote(): SheetOrderRow may not have this
// key declared yet since it's a newly added sheet column. Treats a
// missing cell, empty string, or the literal "N/A" checkout sends for a
// blank note as "no note", so callers never have to special-case those.
function getCustomerNote(order: SheetOrderRow): string {
  const raw = (order as unknown as Record<string, unknown>)["Customer Note"];
  const note = String(raw ?? "").trim();
  if (note === "" || note.toUpperCase() === "N/A") return "";
  return note;
}

// ---------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------
// Short confirmation ping — not an itemized receipt. Matches the message
// format used at checkout (buildCustomerConfirmLink) so customers see the
// same wording regardless of whether the order came from the website or
// was entered by staff.
export function buildCustomerConfirmMessage(order: SheetOrderRow): string {
  return `Hi ${order["Customer Name"]}, this is Meal Bear Skardu. Your order total is Rs. ${order["Customer Total"]}. Reply YES to confirm.`;
}

export function customerWhatsAppLink(order: SheetOrderRow): string {
  return buildWhatsAppLink(normalizePhone(order["Customer Phone"]), buildCustomerConfirmMessage(order));
}

// ---------------------------------------------------------------------
// Restaurant
// ---------------------------------------------------------------------
// The sheet's "Items" column combines every restaurant's items into one
// string, grouped in blocks separated by a blank line:
//   "Shop A:\n  2x Burger (Rs. 500)\n\nShop B:\n  1x Pizza (Rs. 900)"
// (same shape checkout's detailedItems produces, one block per restaurant,
// each block's first line being "{Restaurant Name}:"). This pulls out
// just the block matching the given restaurant, strips the header line,
// the per-item price, and any [[DESC]] markers — leaving only what that
// specific kitchen needs: what to make, at what quantity, with what
// customization notes.
function extractItemsForRestaurant(items: string, restaurantName: string): string {
  const blocks = items.split(/\n\n+/);
  const target = blocks.find((block) => block.trim().startsWith(`${restaurantName}:`));
  if (!target) return items; // fallback: restaurant name didn't match a block header — show everything rather than nothing

  const lines = target.split("\n").slice(1); // drop the "{Restaurant Name}:" header line
  const withoutPrices = lines.join("\n").replace(/\s*\(Rs\.\s*[\d,]+\)/g, "");
  return stripDescMarkersForPlainText(withoutPrices).trim();
}

// The customer's free-text note (e.g. "no tomatoes", "no sauce") applies
// to the whole order, not to any one restaurant's block specifically — so
// when a cart spans multiple shops, EVERY restaurant message gets the
// same note line. There's no reliable way to tell which shop a note was
// "meant for" from free text alone, and silently dropping it for a
// multi-restaurant order would be worse than a kitchen seeing a note that
// doesn't apply to them.
export function buildRestaurantMessage(order: SheetOrderRow, restaurant: Restaurant): string {
  const itemLines = extractItemsForRestaurant(order["Items"], restaurant.name);
  const note = getCustomerNote(order);
  const noteLine = note ? `\n\n\u{1F4DD} Note: ${note}` : ""; // \u{1F4DD} = 📝
  return `${restaurant.name}\n\n${itemLines}${noteLine}\n\n~ Meal Bear Skardu`;
}

export function restaurantWhatsAppLink(order: SheetOrderRow, restaurant: Restaurant): string {
  return buildWhatsAppLink(normalizePhone(restaurant.phone), buildRestaurantMessage(order, restaurant));
}

// ---------------------------------------------------------------------
// Rider
// ---------------------------------------------------------------------
// Riders don't need prices — just what to pick up — so this strips the
// "(Rs. X)" portion off each line, and cleans up [[DESC]] markers the
// same way the restaurant message does.
function stripPricesForRider(items: string): string {
  return stripDescMarkersForPlainText(items.replace(/\s*\(Rs\.\s*[\d,]+\)/g, ""));
}

// Message sent to a rider — either the formally assigned one, or any
// rider pinged via the "Notify Riders" broadcast buttons. Mirrors the
// main checkout site's rider dispatch message format, with the Order ID
// added at the top so a rider juggling multiple deliveries can reference
// it when messaging back.
export function buildRiderMessage(order: SheetOrderRow): string {
  const restaurantNames = order["Restaurant(s)"];
  const isMultiRestaurant = restaurantNames.includes(",");
  const itemsSection = stripPricesForRider(order["Items"]);
  const note = getCustomerNote(order);

  const hasLocationLink =
    order["Location Link"] &&
    order["Location Link"] !== "Not available" &&
    order["Location Link"] !== "";

  const hasDistance = order["Distance (km)"] && order["Distance (km)"] !== "N/A";

  // Emoji written as \u{...} escapes rather than pasted literally — pasted
  // emoji characters are multi-byte UTF-8 sequences that can get silently
  // corrupted if the .ts file ever passes through a tool or editor that
  // doesn't default to UTF-8 (common on Windows). Escapes are plain ASCII
  // in the source, so they can't be mangled that way; JS resolves them to
  // the correct Unicode codepoint at runtime regardless of file encoding.
  const scooter = "\u{1F6F5}"; // 🛵
  const pin = "\u{1F4CD}";     // 📍
  const memo = "\u{1F4DD}";    // 📝

  return (
    `${scooter} New Delivery Ready — ${order["Order ID"]}\n\n` +
    (isMultiRestaurant
      ? `${pin} Pickup from ${restaurantNames} (visit in this order)\n\n`
      : `${pin} Pickup from ${restaurantNames}\n\n`) +
    `Items:\n${itemsSection}\n\n` +
    (note ? `${memo} Note: ${note}\n\n` : "") +
    `Customer: ${order["Customer Name"]}\n` +
    `Phone: ${order["Customer Phone"]}\n` +
    `Address: ${order["Address"]}\n\n` +
    (hasLocationLink ? `Location: ${order["Location Link"]}\n\n` : "") +
    
    `Total to Collect (COD): Rs. ${order["Customer Total"]}\n\n` +
    `~ Meal Bear Skardu`
  );
}

export function riderWhatsAppLink(order: SheetOrderRow, rider: Rider): string {
  return buildWhatsAppLink(normalizePhone(rider.phone), buildRiderMessage(order));
}