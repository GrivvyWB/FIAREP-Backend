// Trade material catalogs. Trades that select materials from a list (plumber,
// electrician) get a collapsible category -> item picker instead of the
// area-based measurement calculators. Keyed by the same trade keys as
// measurement-access.ts (tradeKeyForPosition).

export type CatalogCategory = { name: string; items: string[] };
export type TradeCatalog = { trade: string; label: string; categories: CatalogCategory[] };

const PLUMBING: TradeCatalog = {
  trade: 'plumber',
  label: 'Plumbing materials',
  categories: [
    { name: 'Water Supply Pipes', items: ['PEX Pipe (A)', 'PEX Pipe (B)', 'PEX Pipe (C)', 'Copper Pipe (Type K)', 'Copper Pipe (Type L)', 'Copper Pipe (Type M)', 'CPVC Pipe', 'PVC Pressure Pipe', 'Galvanized Steel Pipe', 'Stainless Steel Pipe', 'Polyethylene (PE) Pipe'] },
    { name: 'Drain, Waste & Vent (DWV) Pipes', items: ['PVC DWV Pipe', 'ABS Pipe', 'Cast Iron Pipe', 'SDR Sewer Pipe', 'Corrugated Drain Pipe'] },
    { name: 'PEX Fittings', items: ['Couplings', 'Elbows', 'Tees', 'Reducers', 'Adapters', 'PEX Rings', 'Expansion Fittings'] },
    { name: 'Copper Fittings', items: ['90° Elbows', '45° Elbows', 'Tees', 'Couplings', 'Reducers', 'Caps', 'Unions'] },
    { name: 'PVC / ABS Fittings', items: ['Wyes', 'Sanitary Tees', 'Cleanouts', 'Trap Adapters', 'Bushings', 'Couplings', 'Nipples', 'End Caps'] },
    { name: 'Valves', items: ['Ball Valves', 'Gate Valves', 'Globe Valves', 'Check Valves', 'Pressure Reducing Valves', 'Backflow Preventers', 'Mixing Valves', 'Angle Stops', 'Shut-off Valves', 'Vacuum Breakers', 'Expansion Tank Valves'] },
    { name: 'Drain Components', items: ['P-Traps', 'S-Traps', 'Bottle Traps', 'Drain Assemblies', 'Cleanouts', 'Floor Drains', 'Shower Drains', 'Sink Strainers', 'Roof Drains', 'Trench Drains'] },
    { name: 'Water Heater Materials', items: ['Water Heater Flex Lines', 'Expansion Tanks', 'T&P Relief Valves', 'Dielectric Unions', 'Drain Pans', 'Vent Pipe', 'Gas Connectors', 'Earthquake Straps'] },
    { name: 'Fasteners & Support', items: ['Pipe Hangers', 'Pipe Clamps', 'J-Hooks', 'Strut Channel', 'Pipe Straps', 'Beam Clamps', 'Clevis Hangers', 'Cushion Clamps', 'Riser Clamps', 'Anchor Bolts'] },
    { name: 'Sealants & Consumables', items: ['Teflon Tape', 'Pipe Dope', 'PVC Primer', 'PVC Cement', 'ABS Cement', 'Silicone Sealant', 'Thread Sealant', 'Epoxy Repair Putty', 'Leak Repair Tape'] },
    { name: 'Fixtures — Toilets', items: ['Toilet Bowls', 'Tanks', 'Wax Rings', 'Closet Bolts', 'Flanges', 'Supply Lines'] },
    { name: 'Fixtures — Sinks', items: ['Bathroom Sinks', 'Kitchen Sinks', 'Utility Sinks', 'Vessel Sinks'] },
    { name: 'Fixtures — Faucets', items: ['Kitchen Faucets', 'Lavatory Faucets', 'Commercial Faucets', 'Touchless Faucets'] },
    { name: 'Fixtures — Showers / Tubs', items: ['Shower Valves', 'Tub Spouts', 'Shower Heads', 'Handheld Showers', 'Diverters'] },
    { name: 'Gas Piping Materials', items: ['Black Iron Pipe', 'CSST Pipe', 'Gas Valves', 'Gas Unions', 'Flex Gas Connectors', 'Gas Regulators', 'Drip Legs'] },
    { name: 'Sewer & Underground', items: ['SDR-35 Pipe', 'Sewer Cleanouts', 'Catch Basins', 'Backwater Valves', 'Manhole Components', 'Drain Boxes', 'Lift Station Components'] },
    { name: 'Specialty Plumbing', items: ['Water Softeners', 'Filtration Systems', 'Reverse Osmosis Systems', 'Booster Pumps', 'Sump Pumps', 'Sewage Ejector Pumps', 'Recirculation Pumps', 'Bilge Pumps'] },
    { name: 'Hydronic & Heating', items: ['Boiler Piping', 'Manifolds', 'Zone Valves', 'Circulator Pumps', 'Air Separators', 'Expansion Tanks', 'Radiant Tubing', 'Baseboard Components'] },
    { name: 'Testing & Safety', items: ['Pressure Test Gauges', 'Test Balls', 'Test Plugs', 'Backflow Test Ports', 'Pressure Relief Devices', 'Smoke Test Equipment'] },
    { name: 'Plumbing Tools', items: ['Pipe Wrench', 'Channel Locks', 'Basin Wrench', 'Tubing Cutter', 'PEX Crimper', 'PEX Expander', 'Torch Kit', 'Threading Machine', 'Drain Snake', 'Inspection Camera', 'Press Tool (ProPress)', 'Hole Saws', 'Pipe Reamer', 'Reciprocating Saw', 'PVC Cutters'] },
    { name: 'Common Truck Stock', items: ['PEX tubing', 'Copper fittings', 'PVC fittings', 'Ball valves', 'Angle stops', 'Supply lines', 'Wax rings', 'Toilet bolts', 'Teflon tape', 'Pipe dope', 'PVC cement', 'P-traps', 'SharkBite fittings', 'Hose bibs', 'Faucets', 'Tub/shower cartridges', 'Flexible connectors', 'Pipe straps', 'Cleanout plugs', 'Drain parts', 'Assorted screws and anchors'] },
  ],
};

const ELECTRICAL: TradeCatalog = {
  trade: 'electrician',
  label: 'Electrical materials',
  categories: [
    { name: 'Wire & Cable', items: ['Romex (NM-B)', 'THHN Wire', 'MC Cable', 'Service Entrance Cable', 'Ground Wire'] },
    { name: 'Conduit & Raceway', items: ['EMT Conduit', 'PVC Conduit', 'Rigid Conduit', 'Flexible Conduit', 'Wire Mold'] },
    { name: 'Boxes', items: ['Single-Gang Boxes', 'Double-Gang Boxes', 'Junction Boxes', 'Weatherproof Boxes', 'Ceiling Fan Boxes'] },
    { name: 'Devices', items: ['Duplex Receptacles', 'GFCI Outlets', 'AFCI Outlets', 'Switches', 'Dimmer Switches', 'Occupancy Sensors'] },
    { name: 'Protection', items: ['Circuit Breakers', 'Fuses', 'Surge Protectors', 'Disconnect Switches'] },
    { name: 'Panels', items: ['Main Panels', 'Subpanels', 'Meter Sockets'] },
    { name: 'Lighting Materials', items: ['LED Fixtures', 'Recessed Lights', 'Light Switches', 'Light Bulbs', 'Exit Signs', 'Emergency Lights'] },
    { name: 'Connectors & Fittings', items: ['Wire Nuts', 'Wago Connectors', 'EMT Connectors', 'Couplings', 'Bushings', 'Locknuts'] },
    { name: 'Grounding Materials', items: ['Ground Rods', 'Ground Clamps', 'Ground Bars', 'Bonding Jumpers'] },
    { name: 'Fasteners & Supports', items: ['Conduit Straps', 'Beam Clamps', 'Cable Staples', 'J-Hooks', 'Strut Channel', 'Anchors'] },
    { name: 'Consumables', items: ['Electrical Tape', 'Heat Shrink Tubing', 'Anti-Oxidant Compound', 'Cable Ties', 'Labels'] },
    { name: 'Common Truck Stock', items: ['Wire (12/2)', 'Wire (14/2)', 'Wire (12 THHN)', 'Wire Nuts', 'Receptacles', 'Switches', 'GFCI Outlets', 'Breakers', 'Electrical Tape', 'Junction Boxes', 'EMT Connectors', 'Conduit Straps', 'Ground Rod Clamps', 'Cable Staples', 'LED Lamps', 'Wago Connectors', 'Zip Ties'] },
  ],
};

export const TRADE_CATALOGS: Record<string, TradeCatalog> = {
  plumber: PLUMBING,
  electrician: ELECTRICAL,
};

export function catalogForTrade(trade: string | null | undefined): TradeCatalog | null {
  if (!trade) return null;
  return TRADE_CATALOGS[trade] || null;
}
