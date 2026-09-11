// Shared Scope of Work model (CSI). Used by the CPM scope form and the
// vendor quote form. CPM fills descriptions/qty/unit/cost; vendor receives the
// same lines with prices stripped and fills only Unit Cost. Divisions follow
// CSI MasterFormat (00-49), pre-seeded with the contract's sections.

export type ScopeLine = {
  id: string;
  description: string;
  quantity: string;
  unit: string;
  unitCost: string;
};

export type ScopeSection = {
  id: string;
  code: string;
  lines: ScopeLine[];
};

export type ScopeDivision = {
  id: string;
  title: string;
  sections: ScopeSection[];
};

export type VendorScopeHeader = {
  contractor?: string;
  multiBuilding?: string;
  date?: string;
  projectManager?: string;
  numDUs?: string;
  revisionDate?: string;
  projectName?: string;
  address?: string;
};

export type VendorScope = {
  header: VendorScopeHeader;
  divisions: ScopeDivision[];
};

export const UNIT_OPTIONS = ['Each', 'L.F.', 'S.F.', 'C.Y.', 'L.S.', 'D.U.'];

let _n = 0;
const sid = () => 'vs' + (Date.now().toString(36)) + (_n++).toString(36);

const line = (): ScopeLine => ({ id: sid(), description: '', quantity: '', unit: '', unitCost: '' });
const section = (code: string): ScopeSection => ({ id: sid(), code, lines: [line()] });
const division = (title: string, sectionCodes: string[]): ScopeDivision => ({
  id: sid(), title, sections: sectionCodes.map(section),
});

// Standard skeleton: full CSI MasterFormat divisions with contract sections merged.
export function seedVendorScope(): VendorScope {
  return {
    header: { multiBuilding: 'NO' },
    divisions: [
      division('DIVISION 00. PROCUREMENT AND CONTRACTING REQUIREMENTS', ['Section 00 00 00 - Procurement and Contracting Requirements', 'Section 00 01 01 - Project Title Page', 'Section 00 01 03 - Project Directory', 'Section 00 01 10 - Table of Contents', 'Section 00 10 00 - Solicitation', 'Section 00 20 00 - Instructions for Procurement', 'Section 00 30 00 - Available Information', 'Section 00 40 00 - Procurement Forms and Supplements', 'Section 00 50 00 - Contracting Forms and Supplements', 'Section 00 60 00 - Project Forms', 'Section 00 70 00 - Conditions of the Contract', 'Section 00 90 00 - Addenda and Modifications']),
      division('DIVISION 01. GENERAL REQUIREMENTS', ['Section 01 00 00 - General Requirements', 'Section 01 10 00 - Summary', 'Section 01 20 00 - Price and Payment Procedures', 'Section 01 21 00 - Allowances', 'Section 01 22 00 - Unit Prices', 'Section 01 23 00 - Alternates', 'Section 01 30 00 - Administrative Requirements', 'Section 01 32 00 - Construction Progress Documentation', 'Section 01 40 00 - Quality Requirements', 'Section 01 50 00 - Temporary Facilities and Controls', 'Section 01 60 00 - Product Requirements', 'Section 01 70 00 - Execution and Closeout Requirements', 'Section 01 78 00 - Closeout Submittals', 'Section 011000 - Summary']),
      division('DIVISION 02. EXISTING CONDITIONS', ['Section 02 00 00 - Existing Conditions', 'Section 02 41 00 - Demolition', 'Section 02 41 19 - Selective Structural Demolition', 'Section 02 82 00 - Asbestos Remediation', 'Section 02 83 00 - Lead Remediation', 'Section 02 84 00 - Mold Remediation', 'Section 024119 - Selective Structural Installation / Demolition', 'Section 028200 - Asbestos Remediation', 'Section 028333.13 - Lead-Based Paint Removal and Disposal', 'Mold Abatement']),
      division('DIVISION 03. CONCRETE', ['Section 03 00 00 - Concrete', 'Section 03 10 00 - Concrete Forming and Accessories', 'Section 03 20 00 - Concrete Reinforcing', 'Section 03 30 00 - Cast-in-Place Concrete', 'Section 03 35 00 - Concrete Finishing', 'Section 03 40 00 - Precast Concrete']),
      division('DIVISION 04. MASONRY', ['Section 04 00 00 - Masonry', 'Section 04 05 00 - Common Work Results for Masonry', 'Section 04 20 00 - Unit Masonry', 'Section 04 40 00 - Stone Assemblies', 'Section 040120 - Maintenance of Unit Masonry / 321313 - Concrete Paving']),
      division('DIVISION 05. METALS', ['Section 05 00 00 - Metals', 'Section 05 05 00 - Common Work Results for Metals', 'Section 05 12 00 - Structural Steel Framing', 'Section 05 50 00 - Metal Fabrications', 'Section 055100 - Metal Stairs']),
      division('DIVISION 06. WOOD, PLASTICS, AND COMPOSITES', ['Section 06 00 00 - Wood, Plastics, and Composites', 'Section 06 10 00 - Rough Carpentry', 'Section 06 20 00 - Finish Carpentry', 'Section 06 40 00 - Architectural Woodwork', 'Section 062033 - Interior Finish Carpentry']),
      division('DIVISION 07. THERMAL AND MOISTURE PROTECTION', ['Section 07 00 00 - Thermal and Moisture Protection', 'Section 07 10 00 - Damp-proofing and Waterproofing', 'Section 07 20 00 - Thermal Protection', 'Section 07 50 00 - Roofing', 'Section 075213 - APP Modified Bituminous Membrane', 'Section 077200 - Roof Accessories']),
      division('DIVISION 08. OPENINGS', ['Section 08 00 00 - Openings', 'Section 08 10 00 - Doors and Frames', 'Section 08 30 00 - Specialty Doors', 'Section 08 50 00 - Windows', 'Section 081113 - Hollow Doors And Frames', 'Section 083113 - Access Doors and Frames', 'Section 084113 - Aluminum-Framed Entrances and Storefronts', 'Section 085113 - Aluminum Windows', 'Section 086300 - Metal-Framed Skylights']),
      division('DIVISION 09. FINISHES', ['Section 09 00 00 - Finishes', 'Section 09 20 00 - Plaster and Gypsum Board', 'Section 09 30 00 - Tiling', 'Section 09 90 00 - Painting and Coating', 'Section 092900 - Gypsum Board', 'Section 093000 - Tiling', 'Section 096519 - Resilient Flooring', 'Section 099123 - Interior Painting', 'Section 099113 - Exterior Painting']),
      division('DIVISION 10. SPECIALTIES', ['Section 10 00 00 - Specialties', 'Section 10 14 00 - Signage', 'Section 10 28 00 - Toilet, Bath, and Laundry Accessories', 'Section 102800 - Toilet, Bath and Laundry Accessories']),
      division('DIVISION 11. EQUIPMENT', ['Section 11 00 00 - Equipment', 'Section 11 40 00 - Food Service Equipment']),
      division('DIVISION 12. FURNISHINGS', ['Section 12 00 00 - Furnishings', 'Section 12 20 00 - Window Treatments', 'Section 12 30 00 - Casework', 'Section 123530 - Residential Casework']),
      division('DIVISION 13. SPECIAL CONSTRUCTION', ['Section 13 00 00 - Special Construction', 'Section 13 34 00 - Fabricated Structures']),
      division('DIVISION 14. CONVEYING EQUIPMENT', ['Section 14 00 00 - Conveying Equipment', 'Section 14 20 00 - Elevators']),
      division('DIVISION 21. FIRE SUPPRESSION', ['Section 21 00 00 - Fire Suppression', 'Section 21 13 00 - Fire-Suppression Sprinkler Systems']),
      division('DIVISION 22. PLUMBING', ['Section 22 00 00 - Plumbing', 'Section 22 40 00 - Plumbing Fixtures', 'Section 221119 - Domestic Water Piping Specialties', 'Section 221423 - Storm Drainage Piping Specialties', 'Section 224100 - Residential Plumbing Fixtures']),
      division('DIVISION 23. HVAC', ['Section 23 00 00 - HVAC', 'Section 23 30 00 - HVAC Air Distribution', 'Section 235100 - Breechings, Chimneys, and Stacks', 'Section 238236 - Cast Iron Radiation Heaters']),
      division('DIVISION 25. INTEGRATED AUTOMATION', ['Section 25 00 00 - Integrated Automation']),
      division('DIVISION 26. ELECTRICAL', ['Section 26 00 00 - Electrical', 'Section 26 05 00 - Common Work Results for Electrical', 'Section 26 24 00 - Switchboards and Panelboards', 'Section 262726 - Wiring Devices', 'Section 265100 - Interior Lighting']),
      division('DIVISION 27. COMMUNICATIONS', ['Section 27 00 00 - Communications', 'Section 27 10 00 - Structured Cabling', 'Section 275123 - Intercommunications and Program Systems']),
      division('DIVISION 28. ELECTRONIC SAFETY AND SECURITY', ['Section 28 00 00 - Electronic Safety and Security', 'Section 28 16 00 - Intrusion Detection']),
      division('DIVISION 31. EARTHWORK', ['Section 31 00 00 - Earthwork', 'Section 31 20 00 - Earth Moving']),
      division('DIVISION 32. EXTERIOR IMPROVEMENTS', ['Section 32 00 00 - Exterior Improvements', 'Section 32 12 00 - Asphalt Paving']),
      division('DIVISION 33. UTILITIES', ['Section 33 00 00 - Utilities', 'Section 33 40 00 - Storm Drainage']),
      division('DIVISION 34. TRANSPORTATION', ['Section 34 00 00 - Transportation']),
      division('DIVISION 35. WATERWAY AND MARINE CONSTRUCTION', ['Section 35 00 00 - Waterway and Marine Construction']),
      division('DIVISION 40. PROCESS INTEGRATION', ['Section 40 00 00 - Process Integration']),
      division('DIVISION 41. MATERIAL PROCESSING AND HANDLING EQUIPMENT', ['Section 41 00 00 - Material Processing and Handling Equipment']),
      division('DIVISION 42. PROCESS HEATING, COOLING, AND DRYING EQUIPMENT', ['Section 42 00 00 - Process Heating, Cooling, and Drying Equipment']),
      division('DIVISION 43. PROCESS GAS AND LIQUID HANDLING EQUIPMENT', ['Section 43 00 00 - Process Gas and Liquid Handling Equipment']),
      division('DIVISION 44. POLLUTION AND WASTE CONTROL EQUIPMENT', ['Section 44 00 00 - Pollution and Waste Control Equipment']),
      division('DIVISION 45. INDUSTRY-SPECIFIC MANUFACTURING EQUIPMENT', ['Section 45 00 00 - Manufacturing Equipment']),
      division('DIVISION 46. WATER AND WASTEWATER EQUIPMENT', ['Section 46 00 00 - Water and Wastewater Equipment']),
      division('DIVISION 48. ELECTRICAL POWER GENERATION', ['Section 48 00 00 - Electrical Power Generation']),
    ],
  };
}

export function newLine(): ScopeLine { return line(); }
export function newSection(code: string = 'New section'): ScopeSection { return section(code); }
export function newDivision(title: string = 'NEW DIVISION'): ScopeDivision { return { id: sid(), title, sections: [] }; }

const num = (v?: string) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, '')); return isNaN(n) ? 0 : n; };
export function lineAmount(l: ScopeLine): number { return num(l.quantity) * num(l.unitCost); }
export function sectionTotal(s: ScopeSection): number { return s.lines.reduce((sum, l) => sum + lineAmount(l), 0); }
export function grandTotal(scope: VendorScope): number {
  return scope.divisions.reduce((sum, d) => sum + d.sections.reduce((ss, s) => ss + sectionTotal(s), 0), 0);
}
export function costPerDU(scope: VendorScope): number {
  const du = num(scope.header.numDUs);
  return du > 0 ? grandTotal(scope) / du : 0;
}

// Strip all pricing from a scope so the vendor receives the work but no prices.
export function stripPrices(scope: VendorScope): VendorScope {
  return {
    ...scope,
    divisions: scope.divisions.map((d) => ({
      ...d,
      sections: d.sections.map((s) => ({
        ...s,
        lines: s.lines.map((l) => ({ ...l, unitCost: '' })),
      })),
    })),
  };
}

// Keep only sections/divisions the CPM actually used (any line with a
// description), so the vendor is not handed the entire empty CSI skeleton.
export function usedOnly(scope: VendorScope): VendorScope {
  const divisions = scope.divisions
    .map((d) => ({
      ...d,
      sections: d.sections
        .map((s) => ({ ...s, lines: s.lines.filter((l) => String(l.description || '').trim()) }))
        .filter((s) => s.lines.length > 0),
    }))
    .filter((d) => d.sections.length > 0);
  return { ...scope, divisions };
}

// Full catalog of divisions + sections for the CPM's dropdown pickers.
export const SCOPE_CATALOG: { title: string; sections: string[] }[] = [
  { title: 'DIVISION 00. PROCUREMENT AND CONTRACTING REQUIREMENTS', sections: ['Section 00 00 00 - Procurement and Contracting Requirements', 'Section 00 01 01 - Project Title Page', 'Section 00 01 03 - Project Directory', 'Section 00 01 10 - Table of Contents', 'Section 00 10 00 - Solicitation', 'Section 00 20 00 - Instructions for Procurement', 'Section 00 30 00 - Available Information', 'Section 00 40 00 - Procurement Forms and Supplements', 'Section 00 50 00 - Contracting Forms and Supplements', 'Section 00 60 00 - Project Forms', 'Section 00 70 00 - Conditions of the Contract', 'Section 00 90 00 - Addenda and Modifications'] },
  { title: 'DIVISION 01. GENERAL REQUIREMENTS', sections: ['Section 01 00 00 - General Requirements', 'Section 01 10 00 - Summary', 'Section 01 20 00 - Price and Payment Procedures', 'Section 01 21 00 - Allowances', 'Section 01 22 00 - Unit Prices', 'Section 01 23 00 - Alternates', 'Section 01 30 00 - Administrative Requirements', 'Section 01 32 00 - Construction Progress Documentation', 'Section 01 40 00 - Quality Requirements', 'Section 01 50 00 - Temporary Facilities and Controls', 'Section 01 60 00 - Product Requirements', 'Section 01 70 00 - Execution and Closeout Requirements', 'Section 01 78 00 - Closeout Submittals', 'Section 011000 - Summary'] },
  { title: 'DIVISION 02. EXISTING CONDITIONS', sections: ['Section 02 00 00 - Existing Conditions', 'Section 02 41 00 - Demolition', 'Section 02 41 19 - Selective Structural Demolition', 'Section 02 82 00 - Asbestos Remediation', 'Section 02 83 00 - Lead Remediation', 'Section 02 84 00 - Mold Remediation', 'Section 024119 - Selective Structural Installation / Demolition', 'Section 028200 - Asbestos Remediation', 'Section 028333.13 - Lead-Based Paint Removal and Disposal', 'Mold Abatement'] },
  { title: 'DIVISION 03. CONCRETE', sections: ['Section 03 00 00 - Concrete', 'Section 03 10 00 - Concrete Forming and Accessories', 'Section 03 20 00 - Concrete Reinforcing', 'Section 03 30 00 - Cast-in-Place Concrete', 'Section 03 35 00 - Concrete Finishing', 'Section 03 40 00 - Precast Concrete'] },
  { title: 'DIVISION 04. MASONRY', sections: ['Section 04 00 00 - Masonry', 'Section 04 05 00 - Common Work Results for Masonry', 'Section 04 20 00 - Unit Masonry', 'Section 04 40 00 - Stone Assemblies', 'Section 040120 - Maintenance of Unit Masonry / 321313 - Concrete Paving'] },
  { title: 'DIVISION 05. METALS', sections: ['Section 05 00 00 - Metals', 'Section 05 05 00 - Common Work Results for Metals', 'Section 05 12 00 - Structural Steel Framing', 'Section 05 50 00 - Metal Fabrications', 'Section 055100 - Metal Stairs'] },
  { title: 'DIVISION 06. WOOD, PLASTICS, AND COMPOSITES', sections: ['Section 06 00 00 - Wood, Plastics, and Composites', 'Section 06 10 00 - Rough Carpentry', 'Section 06 20 00 - Finish Carpentry', 'Section 06 40 00 - Architectural Woodwork', 'Section 062033 - Interior Finish Carpentry'] },
  { title: 'DIVISION 07. THERMAL AND MOISTURE PROTECTION', sections: ['Section 07 00 00 - Thermal and Moisture Protection', 'Section 07 10 00 - Damp-proofing and Waterproofing', 'Section 07 20 00 - Thermal Protection', 'Section 07 50 00 - Roofing', 'Section 075213 - APP Modified Bituminous Membrane', 'Section 077200 - Roof Accessories'] },
  { title: 'DIVISION 08. OPENINGS', sections: ['Section 08 00 00 - Openings', 'Section 08 10 00 - Doors and Frames', 'Section 08 30 00 - Specialty Doors', 'Section 08 50 00 - Windows', 'Section 081113 - Hollow Doors And Frames', 'Section 083113 - Access Doors and Frames', 'Section 084113 - Aluminum-Framed Entrances and Storefronts', 'Section 085113 - Aluminum Windows', 'Section 086300 - Metal-Framed Skylights'] },
  { title: 'DIVISION 09. FINISHES', sections: ['Section 09 00 00 - Finishes', 'Section 09 20 00 - Plaster and Gypsum Board', 'Section 09 30 00 - Tiling', 'Section 09 90 00 - Painting and Coating', 'Section 092900 - Gypsum Board', 'Section 093000 - Tiling', 'Section 096519 - Resilient Flooring', 'Section 099123 - Interior Painting', 'Section 099113 - Exterior Painting'] },
  { title: 'DIVISION 10. SPECIALTIES', sections: ['Section 10 00 00 - Specialties', 'Section 10 14 00 - Signage', 'Section 10 28 00 - Toilet, Bath, and Laundry Accessories', 'Section 102800 - Toilet, Bath and Laundry Accessories'] },
  { title: 'DIVISION 11. EQUIPMENT', sections: ['Section 11 00 00 - Equipment', 'Section 11 40 00 - Food Service Equipment'] },
  { title: 'DIVISION 12. FURNISHINGS', sections: ['Section 12 00 00 - Furnishings', 'Section 12 20 00 - Window Treatments', 'Section 12 30 00 - Casework', 'Section 123530 - Residential Casework'] },
  { title: 'DIVISION 13. SPECIAL CONSTRUCTION', sections: ['Section 13 00 00 - Special Construction', 'Section 13 34 00 - Fabricated Structures'] },
  { title: 'DIVISION 14. CONVEYING EQUIPMENT', sections: ['Section 14 00 00 - Conveying Equipment', 'Section 14 20 00 - Elevators'] },
  { title: 'DIVISION 21. FIRE SUPPRESSION', sections: ['Section 21 00 00 - Fire Suppression', 'Section 21 13 00 - Fire-Suppression Sprinkler Systems'] },
  { title: 'DIVISION 22. PLUMBING', sections: ['Section 22 00 00 - Plumbing', 'Section 22 40 00 - Plumbing Fixtures', 'Section 221119 - Domestic Water Piping Specialties', 'Section 221423 - Storm Drainage Piping Specialties', 'Section 224100 - Residential Plumbing Fixtures'] },
  { title: 'DIVISION 23. HVAC', sections: ['Section 23 00 00 - HVAC', 'Section 23 30 00 - HVAC Air Distribution', 'Section 235100 - Breechings, Chimneys, and Stacks', 'Section 238236 - Cast Iron Radiation Heaters'] },
  { title: 'DIVISION 25. INTEGRATED AUTOMATION', sections: ['Section 25 00 00 - Integrated Automation'] },
  { title: 'DIVISION 26. ELECTRICAL', sections: ['Section 26 00 00 - Electrical', 'Section 26 05 00 - Common Work Results for Electrical', 'Section 26 24 00 - Switchboards and Panelboards', 'Section 262726 - Wiring Devices', 'Section 265100 - Interior Lighting'] },
  { title: 'DIVISION 27. COMMUNICATIONS', sections: ['Section 27 00 00 - Communications', 'Section 27 10 00 - Structured Cabling', 'Section 275123 - Intercommunications and Program Systems'] },
  { title: 'DIVISION 28. ELECTRONIC SAFETY AND SECURITY', sections: ['Section 28 00 00 - Electronic Safety and Security', 'Section 28 16 00 - Intrusion Detection'] },
  { title: 'DIVISION 31. EARTHWORK', sections: ['Section 31 00 00 - Earthwork', 'Section 31 20 00 - Earth Moving'] },
  { title: 'DIVISION 32. EXTERIOR IMPROVEMENTS', sections: ['Section 32 00 00 - Exterior Improvements', 'Section 32 12 00 - Asphalt Paving'] },
  { title: 'DIVISION 33. UTILITIES', sections: ['Section 33 00 00 - Utilities', 'Section 33 40 00 - Storm Drainage'] },
  { title: 'DIVISION 34. TRANSPORTATION', sections: ['Section 34 00 00 - Transportation'] },
  { title: 'DIVISION 35. WATERWAY AND MARINE CONSTRUCTION', sections: ['Section 35 00 00 - Waterway and Marine Construction'] },
  { title: 'DIVISION 40. PROCESS INTEGRATION', sections: ['Section 40 00 00 - Process Integration'] },
  { title: 'DIVISION 41. MATERIAL PROCESSING AND HANDLING EQUIPMENT', sections: ['Section 41 00 00 - Material Processing and Handling Equipment'] },
  { title: 'DIVISION 42. PROCESS HEATING, COOLING, AND DRYING EQUIPMENT', sections: ['Section 42 00 00 - Process Heating, Cooling, and Drying Equipment'] },
  { title: 'DIVISION 43. PROCESS GAS AND LIQUID HANDLING EQUIPMENT', sections: ['Section 43 00 00 - Process Gas and Liquid Handling Equipment'] },
  { title: 'DIVISION 44. POLLUTION AND WASTE CONTROL EQUIPMENT', sections: ['Section 44 00 00 - Pollution and Waste Control Equipment'] },
  { title: 'DIVISION 45. INDUSTRY-SPECIFIC MANUFACTURING EQUIPMENT', sections: ['Section 45 00 00 - Manufacturing Equipment'] },
  { title: 'DIVISION 46. WATER AND WASTEWATER EQUIPMENT', sections: ['Section 46 00 00 - Water and Wastewater Equipment'] },
  { title: 'DIVISION 48. ELECTRICAL POWER GENERATION', sections: ['Section 48 00 00 - Electrical Power Generation'] },
];

// An empty scope (header only) — the CPM adds sections from the catalog
// via dropdowns, so they aren't handed all 35 divisions up front.
export function emptyScope(): VendorScope {
  return { header: { multiBuilding: 'NO' }, divisions: [] };
}

// Add (or reuse) a division+section into a scope, returning the new scope
// plus a blank line ready to fill.
export function addSectionToScope(scope: VendorScope, divisionTitle: string, sectionCode: string): VendorScope {
  const divisions = scope.divisions.map((d) => ({ ...d, sections: d.sections.map((s) => ({ ...s })) }));
  let div = divisions.find((d) => d.title === divisionTitle);
  if (!div) { div = newDivision(divisionTitle); divisions.push(div); }
  let sec = div.sections.find((s) => s.code === sectionCode);
  if (!sec) { sec = newSection(sectionCode); div.sections.push(sec); }
  return { ...scope, divisions };
}
