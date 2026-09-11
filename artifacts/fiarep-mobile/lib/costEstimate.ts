export type CostCategory = { id: string; title: string };

export const COST_CATEGORIES: CostCategory[] = [
  { id: 'generals', title: 'GENERALS REQUIREMENTS' },
  { id: 'exterior', title: "BUILDING'S EXTERIOR" },
  { id: 'facades', title: 'FACADES' },
  { id: 'apt-reno', title: 'APARTMENT RENOVATION' },
  { id: 'public-reno', title: 'PUBLIC PARTS RENOVATION' },
  { id: 'lead', title: 'LEAD-BASED PAINT REMOVAL' },
  { id: 'mold', title: 'MOLD ABATEMENT' },
  { id: 'windows', title: 'WINDOWS' },
  { id: 'roof-acm', title: 'ROOF/ACM REMOVAL' },
  { id: 'fire-escape', title: 'FIRE ESCAPE' },
  { id: 'gutters', title: 'GUTTERS & LEADERS, ROOF DRAINS' },
  { id: 'bulkhead', title: 'ROOF BULKHEAD & SKYLIGHT' },
  { id: 'bldg-entrance', title: 'BUILDING ENTRANCE' },
  { id: 'intercom', title: 'INTERCOM SYSTEM' },
  { id: 'public-halls', title: 'PUBLIC HALLS/APT. ENTRY DOORS' },
  { id: 'cellar', title: 'STRUCTURAL PROBLEMS INTERIOR CELLAR' },
  { id: 'cellar-basement', title: 'CELLAR / BASEMENT' },
  { id: 'electrical', title: 'ELECTRICAL SERVICE' },
  { id: 'gas', title: 'GAS SYSTEM' },
  { id: 'boiler', title: 'BOILER ROOM' },
  { id: 'heating', title: 'HEATING' },
  { id: 'hot-water', title: 'HOT WATER HEATER' },
  { id: 'pipe-insul', title: 'PIPE INSULATION' },
  { id: 'domestic-water', title: 'DOMESTIC WATER' },
  { id: 'drainage', title: 'DRAINAGE/WASTE SYSTEMS' },
  { id: 'pest', title: 'PEST MANAGEMENT/EXTERMINATION' },
];

export type CostRow = { location?: string; description?: string; cost?: string };

export type CostEstimateState = {
  header: {
    buildingAddress?: string;
    inspectionDates?: string;
    projectManager?: string;
    companyName?: string;
    date?: string;
  };
  rows: Record<string, CostRow>;
  totals: {
    costEstimate?: string;
    contingency?: string;
    total?: string;
    costPerDU?: string;
    numUnits?: string;
  };
};

export const EMPTY_COST_ESTIMATE: CostEstimateState = { header: {}, rows: {}, totals: {} };

export const COST_DISCLAIMER =
  'THIS ESTIMATE IS BASED UPON EXTRAPOLATING THE REPAIR COST OF CONDITIONS ACTUALLY OBSERVED TO ALL UNITS IN THE BUILDING. THE ACTUAL COST OF REPAIRS MAY VARY FROM THIS ESTIMATE DUE TO UNSEEN CIRCUMSTANCES.';
