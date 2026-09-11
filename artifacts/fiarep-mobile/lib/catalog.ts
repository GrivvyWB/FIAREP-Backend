export type Unit = 'each' | 'sqft' | 'lnft' | 'sq' | 'cuyd' | 'flat';
export type Category =
  | 'Drywall' | 'Electrical' | 'Plumbing' | 'Roofing'
  | 'Doors' | 'Windows' | 'HVAC' | 'Masonry' | 'Exterior'
  | 'Structural' | 'Remediation' | 'Flooring' | 'Site' | 'Repair' | 'Other';

export type LineItem = {
  id: string;
  category: Category;
  description: string;
  quantity: number;
  unit: Unit;
  unitPrice: number;
  origPrice?: number;
  priceBy?: string;
};

export const CATEGORIES: Category[] = [
  'Drywall', 'Electrical', 'Plumbing', 'Roofing', 'Doors', 'Windows',
  'HVAC', 'Masonry', 'Exterior', 'Structural', 'Remediation', 'Flooring',
  'Site', 'Repair', 'Other',
];

export const UNIT_LABEL: Record<Unit, string> = {
  each: 'each', sqft: 'sq ft', lnft: 'linear ft', sq: 'square', cuyd: 'cu yd', flat: 'flat',
};

export type Preset = { category: Category; description: string; unit: Unit; unitPrice: number };

export const CATALOG: Preset[] = [
  // Drywall
  { category: 'Drywall', description: 'Drywall sheet (4x8)', unit: 'each', unitPrice: 16 },
  { category: 'Drywall', description: 'Hang + finish', unit: 'sqft', unitPrice: 2.1 },
  { category: 'Drywall', description: 'Skim coat / plaster', unit: 'sqft', unitPrice: 2.5 },
  { category: 'Drywall', description: 'Insulation (batt)', unit: 'sqft', unitPrice: 1.2 },
  { category: 'Drywall', description: 'Spray foam insulation', unit: 'sqft', unitPrice: 2.8 },

  // Electrical
  { category: 'Electrical', description: 'Rewire outlet', unit: 'each', unitPrice: 85 },
  { category: 'Electrical', description: 'GFCI/AFCI outlet', unit: 'each', unitPrice: 110 },
  { category: 'Electrical', description: 'Install light fixture', unit: 'each', unitPrice: 120 },
  { category: 'Electrical', description: 'Recessed light', unit: 'each', unitPrice: 140 },
  { category: 'Electrical', description: 'Install ceiling fan', unit: 'each', unitPrice: 175 },
  { category: 'Electrical', description: 'Run new circuit', unit: 'each', unitPrice: 300 },
  { category: 'Electrical', description: 'Upgrade panel (200A)', unit: 'flat', unitPrice: 2200 },
  { category: 'Electrical', description: 'Subpanel', unit: 'flat', unitPrice: 900 },
  { category: 'Electrical', description: 'Wiring run', unit: 'lnft', unitPrice: 6 },
  { category: 'Electrical', description: 'Low-voltage / data run', unit: 'lnft', unitPrice: 4 },
  { category: 'Electrical', description: 'Smoke/CO detector', unit: 'each', unitPrice: 60 },

  // Plumbing
  { category: 'Plumbing', description: 'Copper pipe run', unit: 'lnft', unitPrice: 14 },
  { category: 'Plumbing', description: 'PEX pipe run', unit: 'lnft', unitPrice: 6 },
  { category: 'Plumbing', description: 'Drain/waste line (PVC)', unit: 'lnft', unitPrice: 10 },
  { category: 'Plumbing', description: 'Repair leak', unit: 'each', unitPrice: 180 },
  { category: 'Plumbing', description: 'Install sink + faucet', unit: 'each', unitPrice: 350 },
  { category: 'Plumbing', description: 'Install toilet', unit: 'each', unitPrice: 300 },
  { category: 'Plumbing', description: 'Install tub / shower', unit: 'each', unitPrice: 1200 },
  { category: 'Plumbing', description: 'Gas line run', unit: 'lnft', unitPrice: 20 },
  { category: 'Plumbing', description: 'Water heater (tank)', unit: 'flat', unitPrice: 1400 },
  { category: 'Plumbing', description: 'Water heater (tankless)', unit: 'flat', unitPrice: 2600 },
  { category: 'Plumbing', description: 'Sump pump', unit: 'each', unitPrice: 650 },

  // Roofing
  { category: 'Roofing', description: 'Asphalt shingle roofing', unit: 'sq', unitPrice: 450 },
  { category: 'Roofing', description: 'Rubber / EPDM roofing', unit: 'sq', unitPrice: 550 },
  { category: 'Roofing', description: 'Metal roofing', unit: 'sq', unitPrice: 900 },
  { category: 'Roofing', description: 'Underlayment', unit: 'sq', unitPrice: 60 },
  { category: 'Roofing', description: 'Tear-off existing roof', unit: 'sq', unitPrice: 120 },
  { category: 'Roofing', description: 'Flashing', unit: 'lnft', unitPrice: 14 },
  { category: 'Roofing', description: 'Ridge vent', unit: 'lnft', unitPrice: 12 },
  { category: 'Roofing', description: 'Gutters + downspouts', unit: 'lnft', unitPrice: 9 },

  // Doors
  { category: 'Doors', description: 'Interior door (prehung)', unit: 'each', unitPrice: 350 },
  { category: 'Doors', description: 'Exterior door', unit: 'each', unitPrice: 850 },
  { category: 'Doors', description: 'Fire-rated door', unit: 'each', unitPrice: 1100 },
  { category: 'Doors', description: 'Self-closing door / hardware', unit: 'each', unitPrice: 250 },
  { category: 'Doors', description: 'Sliding glass door', unit: 'each', unitPrice: 1400 },

  // Windows
  { category: 'Windows', description: 'Window replacement (double-hung)', unit: 'each', unitPrice: 650 },
  { category: 'Windows', description: 'Casement window', unit: 'each', unitPrice: 750 },
  { category: 'Windows', description: 'Egress window', unit: 'each', unitPrice: 1800 },
  { category: 'Windows', description: 'Window repair (seals/locks)', unit: 'each', unitPrice: 150 },

  // HVAC
  { category: 'HVAC', description: 'Install boiler', unit: 'flat', unitPrice: 6500 },
  { category: 'HVAC', description: 'Furnace install', unit: 'flat', unitPrice: 4500 },
  { category: 'HVAC', description: 'Mini-split unit', unit: 'each', unitPrice: 3200 },
  { category: 'HVAC', description: 'Central AC', unit: 'flat', unitPrice: 5500 },
  { category: 'HVAC', description: 'Ductwork run', unit: 'lnft', unitPrice: 35 },
  { category: 'HVAC', description: 'Bath/exhaust fan', unit: 'each', unitPrice: 220 },
  { category: 'HVAC', description: 'Radiator', unit: 'each', unitPrice: 600 },
  { category: 'HVAC', description: 'Thermostat (smart)', unit: 'each', unitPrice: 250 },

  // Masonry / Concrete
  { category: 'Masonry', description: 'Concrete pour (4in slab)', unit: 'sqft', unitPrice: 8 },
  { category: 'Masonry', description: 'Concrete (by volume)', unit: 'cuyd', unitPrice: 180 },
  { category: 'Masonry', description: 'Sidewalk repair / replace', unit: 'sqft', unitPrice: 12 },
  { category: 'Masonry', description: 'Cement patching', unit: 'sqft', unitPrice: 9 },
  { category: 'Masonry', description: 'Brick / block wall', unit: 'sqft', unitPrice: 22 },
  { category: 'Masonry', description: 'Foundation footing', unit: 'lnft', unitPrice: 45 },
  { category: 'Masonry', description: 'Waterproofing membrane', unit: 'sqft', unitPrice: 6 },

  // Exterior
  { category: 'Exterior', description: 'Facade pointing / repointing', unit: 'sqft', unitPrice: 18 },
  { category: 'Exterior', description: 'Vinyl siding', unit: 'sqft', unitPrice: 7 },
  { category: 'Exterior', description: 'Fiber cement siding', unit: 'sqft', unitPrice: 11 },
  { category: 'Exterior', description: 'Stucco', unit: 'sqft', unitPrice: 9 },
  { category: 'Exterior', description: 'Exterior paint', unit: 'sqft', unitPrice: 2 },
  { category: 'Exterior', description: 'Soffit / fascia', unit: 'lnft', unitPrice: 14 },

  // Structural / Framing
  { category: 'Structural', description: 'Wall framing (studs)', unit: 'sqft', unitPrice: 12 },
  { category: 'Structural', description: 'Floor framing (joists)', unit: 'sqft', unitPrice: 14 },
  { category: 'Structural', description: 'Roof framing / trusses', unit: 'sqft', unitPrice: 16 },
  { category: 'Structural', description: 'Sheathing (OSB/ply)', unit: 'sqft', unitPrice: 3 },
  { category: 'Structural', description: 'Beam / header', unit: 'each', unitPrice: 400 },

  // Remediation
  { category: 'Remediation', description: 'Mold removal / treatment', unit: 'sqft', unitPrice: 15 },
  { category: 'Remediation', description: 'Asbestos abatement', unit: 'sqft', unitPrice: 25 },
  { category: 'Remediation', description: 'Lead paint abatement', unit: 'sqft', unitPrice: 12 },

  // Flooring
  { category: 'Flooring', description: 'Vinyl plank / LVT', unit: 'sqft', unitPrice: 5.5 },
  { category: 'Flooring', description: 'Tile floor', unit: 'sqft', unitPrice: 12 },
  { category: 'Flooring', description: 'Hardwood', unit: 'sqft', unitPrice: 14 },
  { category: 'Flooring', description: 'Carpet', unit: 'sqft', unitPrice: 4 },
  { category: 'Flooring', description: 'Trim / baseboard', unit: 'lnft', unitPrice: 8 },

  // Site
  { category: 'Site', description: 'Walkway (pavers)', unit: 'sqft', unitPrice: 15 },
  { category: 'Site', description: 'Asphalt paving', unit: 'sqft', unitPrice: 6 },
  { category: 'Site', description: 'Fencing', unit: 'lnft', unitPrice: 30 },
  { category: 'Site', description: 'Landscaping / sod', unit: 'sqft', unitPrice: 3 },
  { category: 'Site', description: 'Dumpster / debris haul', unit: 'flat', unitPrice: 550 },

  // Repair (general)
  { category: 'Repair', description: 'Drywall patch / section', unit: 'sqft', unitPrice: 4.5 },
  { category: 'Repair', description: 'Wall repair (partial)', unit: 'sqft', unitPrice: 5 },
  { category: 'Repair', description: 'Flooring patch', unit: 'sqft', unitPrice: 9 },
  { category: 'Repair', description: 'Trim / molding', unit: 'lnft', unitPrice: 8 },

  // Other
  { category: 'Other', description: 'Custom line', unit: 'flat', unitPrice: 0 },
];

export const lineTotal = (l: LineItem): number => l.quantity * l.unitPrice;
