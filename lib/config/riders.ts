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
  { id: "R01", name: "Daniyal", phone: "03408974556" },
  { id: "R02", name: "Afzal", phone: "03554605878" },
  { id: "R03", name: "Altaf", phone: "03554800575" },
];