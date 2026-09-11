export type ChecklistItem = { id: string; label: string; hint?: string };
export type ChecklistSection = { title: string; icon: string; items: ChecklistItem[] };

// The default renovation checklist template (11 sections).
// Item ids are stable so saved check/notes state maps correctly.
export const CHECKLIST_TEMPLATE: ChecklistSection[] = [
  { title: 'Unit Entry & Initial Prep', icon: '🔨', items: [
    { id: 'prep-assess', label: 'Unit assessment', hint: 'Document damages, measure rooms, identify trades' },
    { id: 'prep-moveout', label: 'Tenant move-out prep', hint: 'Keys returned, utilities shut off' },
    { id: 'prep-staging', label: 'Material staging', hint: 'Flooring, fixtures, paint, cabinets' },
    { id: 'prep-safety', label: 'Safety setup', hint: 'Lockout/tagout, water + electrical shutoff' },
  ]},
  { title: 'Demolition', icon: '🧹', items: [
    { id: 'demo-floor', label: 'Remove flooring', hint: 'Carpet, tile, vinyl' },
    { id: 'demo-cabinets', label: 'Remove cabinets', hint: 'Kitchen + bath' },
    { id: 'demo-wall', label: 'Wall demolition', hint: 'Damaged drywall, partitions' },
    { id: 'demo-bath', label: 'Bathroom demolition', hint: 'Tub, tile, vanity' },
    { id: 'demo-kitchen', label: 'Kitchen demolition', hint: 'Counters, backsplash' },
    { id: 'demo-trash', label: 'Trash removal', hint: 'Bag debris, haul to dumpster' },
  ]},
  { title: 'Electrical', icon: '⚡', items: [
    { id: 'elec-outlets', label: 'Outlet & switch replacement', hint: 'GFCI in kitchen/bath' },
    { id: 'elec-light', label: 'Lighting upgrade', hint: 'LED, recessed, fixtures' },
    { id: 'elec-panel', label: 'Panel check', hint: 'Breakers, labeling' },
    { id: 'elec-lowv', label: 'Low-voltage', hint: 'Internet, doorbell, thermostat' },
    { id: 'elec-appl', label: 'Appliance circuits', hint: 'Stove, microwave' },
  ]},
  { title: 'Plumbing', icon: '🚰', items: [
    { id: 'plumb-supply', label: 'Supply line replacement', hint: 'PEX / copper' },
    { id: 'plumb-drain', label: 'Drain line check', hint: 'Traps, vents' },
    { id: 'plumb-bathru', label: 'Bathroom rough-in', hint: 'Shower valve, drains' },
    { id: 'plumb-kitchen', label: 'Kitchen plumbing', hint: 'Sink, dishwasher' },
    { id: 'plumb-wh', label: 'Water heater check', hint: 'Shared or in-unit' },
  ]},
  { title: 'HVAC & Ventilation', icon: '🌬️', items: [
    { id: 'hvac-ac', label: 'Mini-split or AC check', hint: '' },
    { id: 'hvac-heat', label: 'Heat source check', hint: 'Furnace, baseboard, PTAC' },
    { id: 'hvac-vent', label: 'Ventilation', hint: 'Bath fan, kitchen hood' },
    { id: 'hvac-thermo', label: 'Thermostat upgrade', hint: 'Smart or programmable' },
  ]},
  { title: 'Bathroom Renovation', icon: '🛁', items: [
    { id: 'bath-shower', label: 'Shower/tub install', hint: '' },
    { id: 'bath-tile', label: 'Tile installation', hint: 'Floors + walls' },
    { id: 'bath-vanity', label: 'Vanity install', hint: '' },
    { id: 'bath-toilet', label: 'Toilet install', hint: '' },
    { id: 'bath-access', label: 'Bathroom accessories', hint: 'Mirror, bars, shelves' },
  ]},
  { title: 'Kitchen Renovation', icon: '🍽️', items: [
    { id: 'kit-cabinets', label: 'Cabinet installation', hint: '' },
    { id: 'kit-counter', label: 'Countertops', hint: 'Quartz, granite, laminate' },
    { id: 'kit-backsplash', label: 'Backsplash', hint: '' },
    { id: 'kit-appl', label: 'Appliance installation', hint: 'Fridge, stove, microwave' },
    { id: 'kit-sink', label: 'Sink & faucet', hint: '' },
  ]},
  { title: 'Interior Finishes', icon: '🛋️', items: [
    { id: 'int-floor', label: 'Flooring install', hint: 'Vinyl plank, tile, carpet' },
    { id: 'int-doors', label: 'Interior doors', hint: 'Bedroom, bathroom, closets' },
    { id: 'int-trim', label: 'Trim & molding', hint: 'Baseboards, casings' },
    { id: 'int-paint', label: 'Painting', hint: 'Walls, ceilings, trim' },
    { id: 'int-closet', label: 'Closet systems', hint: '' },
  ]},
  { title: 'Windows & Doors', icon: '🪟', items: [
    { id: 'wd-winrepair', label: 'Window repair', hint: 'Seals, locks' },
    { id: 'wd-intdoor', label: 'Interior door replacement', hint: '' },
    { id: 'wd-entry', label: 'Entry door check', hint: 'Fire-rated, hardware' },
  ]},
  { title: 'Safety & Compliance', icon: '🛡️', items: [
    { id: 'safe-smoke', label: 'Smoke/CO detectors', hint: 'Replace or upgrade' },
    { id: 'safe-fire', label: 'Fire extinguishers', hint: 'If required' },
    { id: 'safe-access', label: 'Access control', hint: 'Locks, smart entry' },
    { id: 'safe-emerg', label: 'Emergency lighting', hint: 'If applicable' },
  ]},
  { title: 'Final Turnover', icon: '🧼', items: [
    { id: 'final-punch', label: 'Punch list', hint: 'Repairs, touch-ups' },
    { id: 'final-clean', label: 'Deep cleaning', hint: 'Floors, windows, appliances' },
    { id: 'final-inspect', label: 'Inspection', hint: 'Plumbing, electrical, finishes' },
    { id: 'final-movein', label: 'Move-in readiness', hint: 'Keys, manuals, paint touch-ups' },
  ]},
];

export type ChecklistState = Record<string, { done: boolean; note?: string }>;

export function checklistProgress(state: ChecklistState): { done: number; total: number } {
  let total = 0, done = 0;
  for (const section of CHECKLIST_TEMPLATE) {
    for (const item of section.items) {
      total++;
      if (state[item.id]?.done) done++;
    }
  }
  return { done, total };
}
