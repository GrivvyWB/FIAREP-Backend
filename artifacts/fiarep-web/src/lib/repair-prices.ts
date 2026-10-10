// FIAREP repair price book — Platform Control only; never shown to clients.
// Sources: HPD Open Market Order charges (NYC Open Data, orders since Jan 2024),
// HPD J-51 Certified Reasonable Cost schedule (July 2025), NYS HCR MCI
// reasonable-cost schedule (Jan 2026), NYC-labeled contractor guides, national
// averages marked as such. Full source list: FIAREP_Repair_Prices_HPD.xlsx.
// Common violation cures, priced per the unit the work is actually done in —
// per apartment visit, per window, per device, per leak, per square foot — so
// "1" always means one real thing. Sources on every line: Angi cost guides for
// New York, NY (2026), HPD Open Market Order averages (NYC Open Data
// mdbu-nrqn) where a City figure exists, retail + labor for detectors. Items
// that are really square-foot work (paint, plaster, mold, roof) live in the
// footing-to-roof groups below and are mapped there.
export const REPAIR_ITEMS = [
  ["exterm", "Extermination treatment", 300, "per apartment, per visit", "Angi NYC: $257 avg ($163–$353); roaches $140–$900, rodents $270–$900"],
  ["guards", "Window guard, installed", 175, "per window", "HPD order avg per guard"],
  ["smoke", "Smoke / CO detector, installed", 125, "each", "combo unit + labor"],
  ["door", "Apartment door repaired, self-closer fitted", 1100, "per door", "HPD order avg"],
  ["firedoor", "Fire-rated door + jamb, replaced", 2450, "per door", "HPD order avg"],
  ["leak", "Plumbing leak repaired", 563, "per leak", "Angi NYC: $563 avg ($282–$957); exposed pipe from $170, in a ceiling $790–$2,820"],
  ["clog", "Drain clog cleared", 255, "per drain", "Angi NYC: $170–$340"],
  ["elec", "Electrical device repaired / replaced", 430, "per outlet, switch or fixture", "Angi NYC: outlet $430–$640, switch $180–$430; $110–$210 per hour"],
  ["roofpatch", "Roof leak patched", 13, "per sq ft of patch", "Angi NYC: $5.50–$20 per sq ft; a leak repair $600–$2,600"],
  ["leadsf", "Lead paint abatement, full removal", 14, "per sq ft", "Angi: removal $10–$17, encapsulation $6–$10 per sq ft; small room $1,500–$4,000"],
  ["heat", "Boiler service / repair call", 425, "per repair + parts", "Angi: $425 avg ($190–$660); circulator pump $300–$1,000; new boiler: see Plumbing & heat"],
] as const;
// Footing to roof, by the square foot / piece. Official NYC schedules first:
// HPD J-51 Certified Reasonable Cost schedule (July 2025) and the NYS HCR MCI
// reasonable-cost schedule (Jan 2026); NYC-labeled contractor guides where the
// schedules have no line; national averages marked as such.
export const REPAIR_SQFT = [
  ["footing", "Concrete footing", 16, "per linear ft", "national avg", "Foundation & structure"],
  ["fwall", "Poured concrete foundation wall", 35, "per sq ft", "national avg", "Foundation & structure"],
  ["slab", "Concrete slab, 4\" structural", 19, "per sq ft", "HPD: $1,499 per cu yd", "Foundation & structure"],
  ["excav", "Excavation, haul-off", 17, "per cu yd", "national avg", "Foundation & structure"],
  ["wproof", "Foundation waterproofing, exterior", 222, "per linear ft", "NYC", "Foundation & structure"],
  ["cwash", "Cement wash / waterproofing", 5, "per sq ft", "", "Foundation & structure"],
  ["beam", "Steel beam installed", 5400, "each", "NYC", "Foundation & structure"],
  ["lintel", "Lintel replaced", 595, "each", "", "Foundation & structure"],
  ["framing", "Wood framing", 12, "per sq ft", "national avg", "Foundation & structure"],
  ["partition", "Partition wall, framed + sheetrock + outlets", 63, "per linear ft", "NYC", "Foundation & structure"],
  ["joist", "Floor joist replaced, incl. subfloor", 422, "each", "", "Foundation & structure"],
  ["rafter", "Roof rafter replaced", 422, "each", "priced at the joist rate", "Foundation & structure"],
  ["stair", "Interior stair rebuilt", 2050, "per flight", "national avg", "Foundation & structure"],
  ["stoop", "Entrance stoop / steps, concrete", 2441, "per riser", "", "Foundation & structure"],
  ["facade", "Fa\u00e7ade restoration (Local Law 11 masonry)", 26, "per sq ft", "", "Fa\u00e7ade & exterior"],
  ["pointing", "Masonry pointing", 22, "per sq ft", "", "Fa\u00e7ade & exterior"],
  ["brick", "Brick replacement", 20, "per sq ft", "national avg", "Fa\u00e7ade & exterior"],
  ["stitch", "Brick stitching (cracks)", 53, "per linear ft", "", "Fa\u00e7ade & exterior"],
  ["parapet", "Parapet rebuilt, incl. coping", 640, "per linear ft", "", "Fa\u00e7ade & exterior"],
  ["coping", "Coping only", 42, "per linear ft", "", "Fa\u00e7ade & exterior"],
  ["railing", "Roof railing", 78, "per linear ft", "", "Fa\u00e7ade & exterior"],
  ["limestone", "Limestone patching", 226, "per sq ft", "", "Fa\u00e7ade & exterior"],
  ["stucco", "Stucco", 8, "per sq ft", "national avg", "Fa\u00e7ade & exterior"],
  ["extpaint", "Exterior painting, masonry", 4, "per sq ft", "NY", "Fa\u00e7ade & exterior"],
  ["shed", "Sidewalk shed installed", 150, "per linear ft", "NYC \u00b7 rent \u2248 5% / month after", "Fa\u00e7ade & exterior"],
  ["sidewalk", "Sidewalk concrete (DOT flag)", 12, "per sq ft", "NYC", "Fa\u00e7ade & exterior"],
  ["chimney", "Chimney rebuilt, masonry", 4929, "per floor", "", "Fa\u00e7ade & exterior"],
  ["window", "Window replaced, double-glazed w/ screens", 2017, "each", "", "Fa\u00e7ade & exterior"],
  ["aptdoor", "Apartment entry door, fire-rated hollow metal", 2406, "each", "", "Fa\u00e7ade & exterior"],
  ["bldgdoor", "Building entry door + frame", 9551, "each", "", "Fa\u00e7ade & exterior"],
  ["roofsys", "Flat roof, new surface + insulation", 30, "per sq ft", "", "Roof"],
  ["roofdeck", "Flat roof with new roof deck + insulation", 45, "per sq ft", "", "Roof"],
  ["roofmb", "Modified bitumen recover", 43, "per sq ft", "", "Roof"],
  ["roofepdm", "EPDM rubber", 36, "per sq ft", "", "Roof"],
  ["roofins", "Roof insulation board", 4, "per sq ft", "NYC", "Roof"],
  ["sheathing", "Roof sheathing only", 4, "per sq ft", "national avg", "Roof"],
  ["skylight", "Skylight replaced, incl. screens", 1783, "each", "", "Roof"],
  ["bulkhead", "Bulkhead door, fire-rated", 2406, "each", "", "Roof"],
  ["gutter", "Gutters, seamless aluminum", 7, "per linear ft", "national avg", "Roof"],
  ["sheetrock", "Sheetrock / drywall replaced", 5, "per sq ft", "NYC \u00b7 removal + new board, taped", "Interior"],
  ["ceiling", "Ceiling replaced, drywall", 3, "per sq ft", "national avg", "Interior"],
  ["cellarceil", "Cellar ceiling, fireproof board", 4, "per sq ft", "", "Interior"],
  ["plasterpatch", "Plaster patch", 48, "per sq ft of patch", "national avg", "Interior"],
  ["paintroom", "Interior painting", 600, "per room", "NY \u00b7 $2,500 per 1-bedroom apt", "Interior"],
  ["subfloor", "Subfloor replaced", 8, "per sq ft", "national avg", "Interior"],
  ["hardwood", "Hardwood flooring", 19, "per sq ft", "", "Interior"],
  ["tile", "Tile floor", 15, "per sq ft", "NY", "Interior"],
  ["walltile", "Wall tile", 25, "per sq ft", "national avg", "Interior"],
  ["intdoor", "Interior door, wood", 1621, "each", "", "Interior"],
  ["cabinets", "Kitchen cabinets, base + counter", 218, "per linear ft", "", "Interior"],
  ["bath", "Full bathroom renovation", 25000, "each", "NYC", "Interior"],
  ["kitchen", "Full kitchen renovation", 32500, "each", "NYC \u00b7 mid-range", "Interior"],
  ["insul", "Insulation, interior", 2, "per sq ft", "", "Interior"],
  ["asbestos", "Asbestos abatement", 22, "per sq ft", "pipe: $21 per linear ft", "Interior"],
  ["moldsf", "Mold remediation", 20, "per sq ft", "national avg", "Interior"],
  ["toilet", "Toilet replaced", 926, "each", "NY", "Plumbing & heat"],
  ["sink", "Sink + faucet", 1200, "each", "national avg", "Plumbing & heat"],
  ["tub", "Bathtub / shower combo", 1675, "each", "national avg", "Plumbing & heat"],
  ["wheater", "Water heater, apartment", 1670, "each", "NY", "Plumbing & heat"],
  ["bwheater", "Water heater, building, up to 600 MBH", 4387, "each", "+ $58 per MBH", "Plumbing & heat"],
  ["radiator", "Radiator / convector, new", 531, "each", "", "Plumbing & heat"],
  ["trv", "Thermostatic radiator valve", 229, "each", "", "Plumbing & heat"],
  ["pipeins", "Pipe insulation", 14, "per linear ft", "", "Plumbing & heat"],
  ["water", "Water main, risers & branches", 5491, "per apartment", "", "Plumbing & heat"],
  ["waste", "Waste & vent, complete", 2266, "per apartment", "", "Plumbing & heat"],
  ["gasriser", "Gas risers & connections", 986, "per apartment", "", "Plumbing & heat"],
  ["gas", "Gas piping, complete new", 36505, "per apartment", "", "Plumbing & heat"],
  ["sewer", "Sewer, street connection", 174, "per linear ft", "", "Plumbing & heat"],
  ["wservice", "Water service, street connection", 265, "per linear ft", "", "Plumbing & heat"],
  ["boiler2k", "Boiler, new, up to 2,000 MBH", 52855, "each", "", "Plumbing & heat"],
  ["boiler4k", "Boiler, new, up to 4,000 MBH", 79892, "each", "", "Plumbing & heat"],
  ["burner", "Burner only, up to 2,000 MBH", 7882, "each", "", "Plumbing & heat"],
  ["stack", "Boiler stack, metal", 2499, "per floor", "", "Plumbing & heat"],
  ["sump", "Sump pump", 1400, "each", "national avg", "Plumbing & heat"],
  ["panel", "Apartment electrical panel", 918, "per apartment", "", "Electrical & fire"],
  ["service", "Electric service equipment", 4646, "per building entry", "+ $4,063 per apartment metered", "Electrical & fire"],
  ["aptwiring", "Apartment wiring, all new", 3575, "per apartment", "", "Electrical & fire"],
  ["wiring", "Rewiring, building-wide", 20854, "per apartment", "", "Electrical & fire"],
  ["outlet", "Outlet on new circuit", 216, "each", "", "Electrical & fire"],
  ["fixture", "Light fixture installed", 589, "each", "national avg", "Electrical & fire"],
  ["smokehw", "Smoke / CO detector, hardwired", 296, "per apartment", "", "Electrical & fire"],
  ["sprinkler", "Sprinkler head, incl. piping", 994, "each", "", "Electrical & fire"],
  ["standpipe", "Standpipe", 3214, "per floor", "", "Electrical & fire"],
  ["firealarm", "Fire alarm system, retrofit", 8, "per sq ft", "national avg", "Electrical & fire"],
  ["intercom", "Video intercom", 1955, "per apartment", "", "Electrical & fire"],
  ["dumpster", "Dumpster", 870, "each", "NYC", "Site & other"],
  ["elevator", "Elevator replaced, gearless, 4 stops", 223231, "each", "+ $16,365 per extra stop", "Site & other"],
  ["fence", "Fencing, chain link", 26, "per linear ft", "national avg", "Site & other"],
] as const;

type RepairKey = (typeof REPAIR_ITEMS)[number][0] | (typeof REPAIR_SQFT)[number][0];
// Architect / engineer (PE / RA) work per building, 2026 NYC market; plus a
// per-DOB-violation letter because each cited condition needs its own sign-off.
export const ENGINEER = [
  ["None", 0, "no plans or professional certification needed"],
  ["Letter / certification", 2500, "PE / RA site visit ($500 – $2,500), structural report or TR-1 compliance letter, DOB-ready stamp"],
  ["Alt-2 legalization", 9000, "as-built drawings, DOB NOW Alt-2 filing, energy and special inspections ($3k – $15k market)"],
  ["Alt-1 / structural", 30000, "stamped structural plans, Alt-1 filing, special inspections and sign-off ($10k – $50k+ market)"],
  ["Building-wide program", 150000, "Local Law 11 facade / parapet inspection and report, gas piping (LL152), boiler and elevator consultants"],
] as const;
export const ENGINEER_PER_DOB = 750;  // engineer letter per DOB condition
export type PriceKey = (typeof REPAIR_ITEMS)[number][0] | (typeof REPAIR_SQFT)[number][0];

// Violation type (from the City's notices) → price book line, one job per
// apartment cited. Square-foot lines start at one typical job size and are
// re-measured on site: lead and mold 100 sq ft, a plaster patch 20 sq ft, a
// floor 100 sq ft.
export const TYPE_TO_ITEM: Record<string, PriceKey> = {
  "Smoke detector": "smoke", "Carbon monoxide detector": "smoke", "Window guards": "guards",
  "Roaches": "exterm", "Mice / rats": "exterm", "Bed bugs": "exterm",
  "Lead paint": "leadsf", "Mold": "moldsf", "Heat / hot water": "heat",
  "Peeling paint / plaster": "paintroom", "Ceiling / wall": "plasterpatch", "Leak / plumbing": "leak", "Electrical": "elec",
  "Door / self-closing": "door", "Window": "window", "Floor": "hardwood",
};
export const TYPE_QTY: Partial<Record<PriceKey, number>> = { leadsf: 100, moldsf: 100, plasterpatch: 20, hardwood: 100 };
/** Price of one repair job of a violation type at the given book prices (0 = quoted after a look). */
export function repairPerJob(type: string, priceOf: (key: PriceKey) => number): number {
  const key = TYPE_TO_ITEM[type];
  return key ? priceOf(key) * (TYPE_QTY[key] ?? 1) : 0;
}
