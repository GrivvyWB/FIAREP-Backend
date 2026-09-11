import { type GeoStamp } from './geo';
export type InspectionItem = { id: string; label: string; options: string[] };
export type InspectionSection = { title: string; icon: string; items: InspectionItem[] };
export type Apartment = { id: string; label: string };
export type Finding = { id: string; aptIds: string[]; choice?: string; note?: string };
export type ActionRow = { id: string; category: string; action: string; priority: 'High' | 'Medium' | 'Low' | '' };
export type Overview = {
  totalViolations?: string;
  scope?: string;
  categorySummaries?: Record<string, string>;
  actions?: ActionRow[];
};
export const OVERVIEW_CATEGORIES: string[] = [
  'Exterior & Structural',
  'Airway Shaft & Cellar',
  'Apartment Entrances & Egress',
  'Electrical Systems',
  'Windows & Fixtures',
  'Plumbing & Bathrooms',
  'Painting & Finishes',
  'Pest Management',
];
export const ACTION_PRIORITIES: Array<'High' | 'Medium' | 'Low'> = ['High', 'Medium', 'Low'];

export type InspectionState = {
  overview?: Overview;
  apartments: Apartment[];
  items: Record<string, { choice?: string; note?: string; findings?: Finding[] }>;
  geo?: GeoStamp;
};
export const EMPTY_INSPECTION: InspectionState = { overview: { categorySummaries: {}, actions: [] }, apartments: [], items: {} };

export const INSPECTION_TEMPLATE: InspectionSection[] = [
  { title: 'Exterior & Structural', icon: '🏛️', items: [
    { id: 'ext-steps', label: 'Front Steps (Stone Masonry)', options: ['No cracks', 'Minor cracks', 'Major defects (repair required)'] },
    { id: 'ext-door', label: 'Main Entrance Door', options: ['Functional', 'Damaged', 'Needs replacement'] },
    { id: 'ext-intercom', label: 'Intercom System', options: ['Present', 'Missing'] },
    { id: 'ext-lintels', label: 'Window Lintels & Sills', options: ['Intact', 'Cracked', 'Severe deterioration'] },
    { id: 'ext-cornices', label: 'Cornices', options: ['Painted', 'Peeling', 'Requires scraping & repainting'] },
    { id: 'ext-fireescape', label: 'Fire Escape', options: ['Good condition', 'Rust present', 'Needs scraping & painting'] },
  ]},
  { title: 'Roof & Airway Shaft', icon: '🏚️', items: [
    { id: 'roof-cond', label: 'Roof Condition', options: ['No leaks', 'Minor leaks', 'Active leaks into apartments'] },
    { id: 'roof-water', label: 'Stagnant Water', options: ['None', 'Present'] },
    { id: 'roof-skylight', label: 'Skylight Protection', options: ['Wire mesh installed', 'Missing'] },
    { id: 'roof-shaft', label: 'Airway Shaft', options: ['Clean', 'Garbage present', 'Pest activity'] },
    { id: 'roof-cellar', label: 'Cellar Door', options: ['Functional', 'Loose/hanging', 'Needs repair'] },
  ]},
  { title: 'Apartment Entrances & Egress', icon: '🚪', items: [
    { id: 'apt-selfclose', label: 'Apartment Entrance Door (self-closing)', options: ['Self-closing', 'Not self-closing'] },
    { id: 'apt-egress', label: 'Egress / Entrance Doors', options: ['Good condition', 'Wooden, needs repair', 'Replacement recommended'] },
    { id: 'apt-services', label: 'Essential Services (Gas, Hot Water, Heat, Electricity)', options: ['All functional', 'Issues found'] },
  ]},
  { title: 'Electrical Systems', icon: '⚡', items: [
    { id: 'elec-panels', label: 'Breaker Panels', options: ['Adequate breakers', 'Only one breaker'] },
    { id: 'elec-outlets', label: 'Room Outlets', options: ['Sufficient outlets', 'Only one outlet per room'] },
    { id: 'elec-appl', label: 'Dedicated Appliance Outlets', options: ['Present', 'Missing'] },
    { id: 'elec-ac', label: 'Air Conditioning Outlets', options: ['Present', 'Missing'] },
    { id: 'elec-gfci', label: 'GFCI (Kitchen/Bathroom)', options: ['Installed', 'Missing'] },
  ]},
  { title: 'Windows', icon: '🪟', items: [
    { id: 'win-springs', label: 'Spring Balances', options: ['Functional', 'Defective', 'Replacement needed'] },
  ]},
  { title: 'Plumbing & Bathrooms', icon: '🚰', items: [
    { id: 'plumb-leaks', label: 'Bathroom Leaks', options: ['None', 'Minor leaks', 'Active leaks'] },
  ]},
  { title: 'Painting & Finishes', icon: '🎨', items: [
    { id: 'paint-apt', label: 'Apartment Walls', options: ['No peeling', 'Peeling paint', 'Needs priming & repainting'] },
    { id: 'paint-halls', label: 'Public Hallways', options: ['No peeling', 'Peeling paint', 'Needs priming & repainting'] },
  ]},
  { title: 'Pest Management', icon: '🐀', items: [
    { id: 'pest-evidence', label: 'Evidence of Infestation', options: ['None', 'Minor activity', 'Active infestation'] },
    { id: 'pest-garbage', label: 'Garbage Accumulation (Airway Shaft)', options: ['Clean', 'Garbage present'] },
  ]},
];

export function inspectionProgress(state: InspectionState): { done: number; total: number } {
  let total = 0, done = 0;
  for (const sec of INSPECTION_TEMPLATE) {
    for (const it of sec.items) {
      total += 1;
      const rec = state.items?.[it.id];
      if (rec && (rec.choice || (rec.findings && rec.findings.length > 0))) done += 1;
    }
  }
  return { done, total };
}
