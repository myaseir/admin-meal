// lib/config/riders.ts
//
// Fixed list of riders for the admin assignment dropdown. Edit this list
// directly — no other code needs to change when you add/remove a rider.
// `id` is what actually gets written into the Rider ID column in the
// sheet, so keep it short and stable (don't reuse an id for a different
// person later, or historical rows will misattribute).
//
// `phone` is used to build the WhatsApp deep link when dispatching an
// order to the rider — must be in international format, digits only,
// no "+", no spaces/dashes (e.g. Pakistan mobile: "923001234567").

export interface Rider {
  id: string;
  name: string;
  phone: string;
}

export const RIDERS: Rider[] = [
  { id: "R01", name: "Rider One", phone: "03169030178" },
  { id: "R02", name: "Rider Two", phone: "923001234568" },
  { id: "R03", name: "Rider Three", phone: "923001234569" },
];