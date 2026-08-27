// lib/config/restaurants.ts
//
// Fixed list of restaurants for looking up a WhatsApp number when sending
// an order to the kitchen. Keyed by `name` because that's what's stored
// as free text in the "Restaurant(s)" sheet column (comma-joined for
// multi-restaurant orders) — there's no restaurant ID anywhere in the
// existing schema, so name is the only thing to match on today.
//
// IMPORTANT: `name` here must match how the restaurant is written in
// "Restaurant(s)" (case-insensitive, trimmed — but spelling still has to
// line up). If an order's restaurant name doesn't match any entry, or
// matches one with no phone filled in yet, the dashboard shows
// "no WhatsApp number configured" rather than silently failing.
//
// `phone` — international format, digits only, no "+", no spaces/dashes,
// e.g. "923001234567". Leave "" until you have the real number — the
// lookup helpers below treat "" the same as "not configured".

export interface Restaurant {
  name: string;
  phone: string;
}

export const RESTAURANTS: Restaurant[] = [
  { name: "Yak and Bull Cafe Skardu", phone: "03169030178" },
  { name: "Baltistan Tea and Grill House", phone: "03169030178" },
  { name: "The Kitchen", phone: "03169030178" },
  { name: "Domino's Pizza Skardu", phone: "03169030178" },
  { name: "The Balti Table", phone: "03169030178" },
  { name: "Skyway Pizza Skardu", phone: "03169030178" },
  { name: "The Food Corridor Skardu", phone: "03169030178" },
  { name: "Sungum Hotel Restaurant Skardu", phone: "03169030178" },
  { name: "MFC Skardu", phone: "03169030178" },
  { name: "Hassan Hussain Host", phone: "03169030178" },
  { name: "Pizza King Skardu", phone: "03169030178" },
  { name: "Yak Grill Skardu", phone: "03169030178" },
];

// Case-insensitive, trimmed lookup by name. Returns undefined if the name
// isn't in the list at all (as opposed to being listed with phone: "").
export function findRestaurant(name: string): Restaurant | undefined {
  const needle = name.trim().toLowerCase();
  return RESTAURANTS.find((r) => r.name.trim().toLowerCase() === needle);
}

// True only when the restaurant is known AND has a real phone number.
export function hasWhatsAppNumber(name: string): boolean {
  const r = findRestaurant(name);
  return !!r && r.phone.trim().length > 0;
}

// "Restaurant(s)" can be a comma-joined list for multi-restaurant orders.
// Splits and looks each one up, so the dashboard can show/link every
// restaurant in the order instead of just the first.
export function findRestaurantsForOrder(restaurantsField: string): {
  name: string;
  restaurant: Restaurant | undefined;
}[] {
  return restaurantsField
    .split(",")
    .map((n) => n.trim())
    .filter((n) => n.length > 0)
    .map((n) => ({ name: n, restaurant: findRestaurant(n) }));
}