export type IntakeState = {
  header: Record<string, string>;
  buildingType: string[];
  stories: string;
  basementCellar: string[];
  duTotal: string;
  aptDist: { oneBed?: string; twoBed?: string; threeBed?: string };
  sro: { bedrooms?: string; kitchens?: string; bathrooms?: string };
  aptsInspected: string;
  vacancies: string;
  commercialSpace: string;
  recordedVacates: string;
  violations: { classA?: string; classB?: string; classC?: string; lead?: string; leadApts?: string; mold?: string; moldApts?: string; dob?: string; ecb?: string; photos?: string };
  scopeOfWork: Record<string, boolean>;
  highlights: string;
  leadNote: string;
  moldNote: string;
  structuralNote: string;
  fields: Record<string, string[]>;
  totals: Record<string, string>;
  describe: Record<string, string>;
  apartments: IntakeApartment[];
};

export type IntakeApartment = {
  id: string;
  number: string;
  bedrooms: string;
  checks: Record<string, string>;
  recommendations: { id: string; condition: string; work: string }[];
};

export const EMPTY_INTAKE: IntakeState = {
  header: {}, buildingType: [], stories: '', basementCellar: [], duTotal: '',
  aptDist: {}, sro: {}, aptsInspected: '', vacancies: '', commercialSpace: '',
  recordedVacates: '', violations: {}, scopeOfWork: {}, highlights: '',
  leadNote: '', moldNote: '', structuralNote: '',
  fields: {}, totals: {}, describe: {}, apartments: [],
};

export const SCOPE_ITEMS: { id: string; label: string }[] = [
  { id: 'sc1', label: 'Roof-Asbestos & Roof Replacement' },
  { id: 'sc2', label: 'Lead-based Paint Removal' },
  { id: 'sc3', label: 'Apartment' },
  { id: 'sc4', label: 'Electric Replacement' },
  { id: 'sc5', label: 'Cellar Repair/Structural' },
  { id: 'sc6', label: 'Replace Gas Meter/Gas Distribution Line' },
  { id: 'sc7', label: 'Building Exterior' },
  { id: 'sc8', label: 'Apartment Entry Doors Replacement' },
  { id: 'sc9', label: 'Replace Waste System' },
  { id: 'sc10', label: 'Public Hall' },
  { id: 'sc11', label: 'Replace Domestic Water System' },
  { id: 'sc12', label: 'Window Replacement' },
  { id: 'sc13', label: 'Heating Plant Replacement' },
  { id: 'sc14', label: 'Heat Distribution Replacement' },
  { id: 'sc15', label: 'Sprinkler System Replacement' },
  { id: 'sc16', label: 'Pest Management/Extermination' },
  { id: 'sc17', label: 'Elevator' },
];

export const APT_CHECK_ITEMS: { id: string; label: string; options: string[] }[] = [
  { id: 'kitchen-defl', label: 'Kitchen Floor Deflection', options: ['Yes', 'No'] },
  { id: 'bath-defl', label: 'Bathroom Floor Deflection', options: ['Yes', 'No'] },
  { id: 'breaker', label: 'Circuit Breaker Panel Box', options: ['Yes', 'No'] },
  { id: 'fuse', label: 'Ceramic Fuse Box', options: ['Yes', 'No'] },
  { id: 'exposed-wiring', label: 'Exposed Electrical Wiring', options: ['Yes', 'No'] },
  { id: 'k-reconnect', label: 'Kitchen: Reconnect existing fixtures', options: ['Yes', 'No'] },
  { id: 'k-replace', label: 'Kitchen: Replace existing fixtures', options: ['Yes', 'No'] },
  { id: 'k-sink', label: 'Kitchen: Sink/drain assembly', options: ['Good', 'Poor'] },
  { id: 'k-mold', label: 'Kitchen: Mold', options: ['Yes', 'No'] },
  { id: 'k-cabinets', label: 'Kitchen: Cabinets', options: ['Good', 'Poor'] },
  { id: 'b-tub-replace', label: 'Bathroom: Bathtub replace', options: ['Yes', 'No'] },
  { id: 'b-tub-reglaze', label: 'Bathroom: Bathtub reglaze', options: ['Yes', 'No'] },
  { id: 'b-shower', label: 'Bathroom: Replace shower body', options: ['Yes', 'No'] },
  { id: 'b-toilet-recon', label: 'Bathroom: Toilet reconnect', options: ['Yes', 'No'] },
  { id: 'b-toilet-replace', label: 'Bathroom: Toilet replace', options: ['Yes', 'No'] },
  { id: 'b-wash-replace', label: 'Bathroom: Washbasin replace', options: ['Yes', 'No'] },
  { id: 'b-wash-recon', label: 'Bathroom: Washbasin reconnect', options: ['Yes', 'No'] },
  { id: 'b-mold', label: 'Bathroom: Mold', options: ['Yes', 'No'] },
];

export const BUILDING_TYPE_OPTS = ['Old law', 'New Law', 'Walk up', 'Elevator'];

// Data-driven building/systems sections (pages 2-11). Each field: label + checkbox options.
// User selections stored in state.fields[fieldId]; totals in state.totals[fieldId]; describe in state.describe[sectionId].
export type IntakeField = { id: string; label: string; options: string[]; total?: string };
export type IntakeSysSection = { id: string; title: string; fields: IntakeField[] };

export const SYSTEM_SECTIONS: IntakeSysSection[] = [
  { id: 'exterior', title: "Building's Exterior", fields: [
    { id: 'ext-sidewalks', label: 'Sidewalks', options: ['Concrete', 'Good', 'Repair', 'Replace'], total: 's.f.' },
    { id: 'ext-curbs', label: 'Curbs', options: ['Concrete', 'Metal', 'Good', 'Repair', 'Replace'], total: 'l.f.' },
    { id: 'ext-grills', label: 'Sidewalk Grills', options: ['None', 'Metal', 'Good', 'Repair', 'Replace'], total: 's.f.' },
    { id: 'ext-steps', label: 'Entrance Stairs Steps', options: ['None', 'Concrete', 'Brick', 'Good', 'Repair', 'Replace'], total: 's.f.' },
    { id: 'ext-ramps', label: 'Entrance Ramps', options: ['None', 'Concrete', 'Brick', 'Good', 'Repair', 'Replace'], total: 's.f.' },
    { id: 'ext-cellarwin', label: 'Cellar Windows', options: ['Yes', 'None', 'Good', 'Repair', 'Replace'], total: 'ea.' },
    { id: 'ext-cellardoors', label: 'Cellar Entrance/Hatch Doors', options: ['Yes', 'None', 'Good', 'Repair', 'Replace'], total: 'ea.' },
    { id: 'ext-railings', label: 'Railings/Gates/Fences', options: ['Yes', 'None', 'Good', 'Repair', 'Replace'], total: 's.f.' },
  ]},
  { id: 'facades', title: 'Facades', fields: [
    { id: 'fac-foundation', label: 'Exterior Foundation Walls', options: ['Concrete', 'Brick', 'CMU', 'Good', 'Repair', 'Pointing', 'Crack repair'], total: 's.f.' },
    { id: 'fac-extwalls', label: 'Exterior Walls', options: ['Brick', 'Wood frame', 'Good', 'Repair', 'Pointing', 'Cracking'], total: 's.f.' },
    { id: 'fac-cornices', label: 'Cornices', options: ['Yes', 'None', 'Good', 'Scrape & paint', 'Replace'], total: 'l.f.' },
    { id: 'fac-lintels', label: 'Windows Lintels', options: ['Good', 'Corroded', 'None'], total: 'replace' },
    { id: 'fac-sills', label: 'Windows Sills', options: ['Good', 'Broken', 'None'], total: 'replace' },
    { id: 'fac-fireescape', label: 'Fire Escapes', options: ['Good', 'Repair / SPP', 'Gooseneck'], total: 'landings' },
  ]},
  { id: 'doors', title: 'Exterior Doors', fields: [
    { id: 'doors-type', label: 'Type', options: ['None', 'Wood', 'Metal'], total: 'ea.' },
    { id: 'doors-cond', label: 'Condition', options: ['Good', 'Repair', 'Replace'], total: 'ea.' },
  ]},
  { id: 'windows', title: 'Windows', fields: [
    { id: 'win-type', label: 'Type', options: ['Wood', 'Aluminum', 'Storm windows', 'Vinyl'] },
    { id: 'win-cond', label: 'Condition', options: ['Good', 'Repair', 'Replace'] },
    { id: 'win-repair', label: 'Total to Repair', options: [], total: 'ea.' },
    { id: 'win-replace', label: 'Total to Replace', options: [], total: 'ea.' },
  ]},
  { id: 'roof', title: 'Roof', fields: [
    { id: 'roof-cond', label: 'Condition', options: ['Good', 'Repair', 'Replace'] },
    { id: 'roof-type', label: 'Type', options: ['Flat roof', 'Other'], total: 's.f.' },
    { id: 'roof-covering', label: 'Covering', options: ['Tar paper', 'Rubber', 'Shingles', 'Requires replacement', 'Patch repair'], total: 's.f.' },
    { id: 'roof-flashing', label: 'Flashing', options: ['Parapets', 'Bulkheads', 'Facades', 'Good', 'Requires replacement'], total: 's.f.' },
  ]},
  { id: 'bldg-entrance', title: 'Building Entrance', fields: [
    { id: 'be-door', label: 'Door Type', options: ['Wood', 'Metal', 'Sidelights', 'Transom', 'None'], total: 's.f.' },
    { id: 'be-cond', label: 'Condition', options: ['Good', 'Repair', 'Replace'] },
  ]},
  { id: 'intercom', title: 'Intercom System', fields: [
    { id: 'ic-cond', label: 'Condition', options: ['Good', 'Repair', 'Replace', 'None exist'], total: 'ea.' },
  ]},
  { id: 'public-hall', title: 'Public Hall', fields: [
    { id: 'ph-stairs', label: 'Stairs', options: ['Wood', 'Metal', 'Metal pan marble/slate', 'Repair'], total: 's.f.' },
    { id: 'ph-walls', label: 'Walls/Wainscoting', options: ['Ceramic tile', 'Marble', 'Plaster', 'Sheetrock', 'Good', 'Replace'], total: 's.f.' },
    { id: 'ph-floors', label: 'Floors', options: ['Tile', 'Stone', 'VCT', 'Good', 'Repair', 'Replace'], total: 's.f.' },
    { id: 'ph-ceiling', label: 'Ceiling', options: ['Plaster', 'Sheetrock', 'Good', 'Repair', 'Replace'], total: 's.f.' },
  ]},
  { id: 'cellar', title: 'Structural Problems Interior Cellar', fields: [
    { id: 'cel-foundation', label: 'Foundation Walls', options: ['Concrete', 'Brick', 'CMU', 'Good', 'Replacement', 'Patch repair'], total: 's.f.' },
    { id: 'cel-girders', label: 'Girders', options: ['Wood', 'Metal', 'Good', 'Repair', 'Replace', 'None exist'], total: 'l.f.' },
    { id: 'cel-floorslabs', label: 'Floor Slabs', options: ['Concrete', 'Stone', 'Good', 'Repair', 'Replace'], total: 's.f.' },
  ]},
  { id: 'electrical', title: 'Electrical System', fields: [
    { id: 'elec-service', label: 'Cellar Service', options: ['Adequate', 'Inadequate'] },
    { id: 'elec-meters', label: 'Meters Location', options: ['Apartment', 'Basement', 'Cellar', 'Good', 'Replace', 'Missing'], total: 'total' },
    { id: 'elec-protection', label: 'Circuit Protection', options: ['Fuses', 'Circuit Breakers', 'None exist', 'Good', 'Replace'] },
    { id: 'elec-risers', label: 'Apartment Risers', options: ['Good', 'Replace'], total: 'total' },
  ]},
  { id: 'gas', title: 'Gas System', fields: [
    { id: 'gas-meters', label: 'Meters Location', options: ['Apartment', 'Basement', 'Cellar', 'Missing'], total: 'No.' },
    { id: 'gas-piping', label: 'Piping', options: ['Good', 'Repair', 'Replace', 'None exist'] },
  ]},
  { id: 'boiler', title: 'Boiler Room', fields: [
    { id: 'boil-walls', label: 'Walls', options: ['Concrete', 'Brick', 'CMU', 'Wood frame', 'Good', 'Replacement', 'Patch repair'], total: 's.f.' },
    { id: 'boil-ceiling', label: 'Ceiling', options: ['Metal', 'Plaster', 'Sheetrock', 'Good', 'Replacement'], total: 's.f.' },
  ]},
  { id: 'heating', title: 'Heating', fields: [
    { id: 'heat-type', label: 'Type', options: ['Gas', 'Oil', 'Steam', 'Hot water', 'Hot air', 'Good', 'Repair', 'Replace'] },
  ]},
  { id: 'hotwater', title: 'Hot Water Heater', fields: [
    { id: 'hw-cond', label: 'Condition', options: ['Good', 'Repair', 'Replace', 'None exist'] },
    { id: 'hw-loc', label: 'Location', options: ['Boiler room', 'Basement', 'Cellar', 'Other'], total: 'gal.' },
  ]},
  { id: 'plumbing', title: 'Domestic Water / Plumbing', fields: [
    { id: 'pl-meter', label: 'Water Meter', options: ['Good', 'Repair', 'Replace', 'None exist'] },
    { id: 'pl-lines', label: 'Plumbing Lines', options: ['Good', 'Repair', 'Replace', 'Galvanized', 'Brass', 'Copper', 'Mixture'], total: 'l.f.' },
    { id: 'pl-leaks', label: 'Active Leaks', options: ['Signs of leaking', 'Active leak'] },
    { id: 'pl-sprinklers', label: 'Fire Sprinklers', options: ['Present', 'Good', 'Repair', 'Replace', 'None exist'], total: 'heads' },
    { id: 'pl-stoppages', label: 'Stoppages', options: ['None', 'Minor', 'Major', 'Requires snaking/jetting'] },
    { id: 'pl-watertower', label: 'Water Tower', options: ['Present', 'Good', 'Repair', 'Replace', 'None exist'] },
  ]},
  { id: 'drainage', title: 'Drainage / Waste Systems', fields: [
    { id: 'dr-roof', label: 'Roof Drain', options: ['Good', 'Repair', 'Replace', 'None exist'], total: 'l.f.' },
    { id: 'dr-house', label: 'House Drain', options: ['Good', 'Repair', 'Replace', 'None exist'], total: 'l.f.' },
    { id: 'dr-sewer', label: 'Sewer Pit', options: ['Good', 'Repair', 'Replace', 'None exist'], total: 's.f.' },
  ]},
  { id: 'publicspace', title: 'Public Space', fields: [
    { id: 'ps-condition', label: 'Overall Condition', options: ['Good', 'Fair', 'Poor', 'Requires repair'], total: 's.f.' },
    { id: 'ps-flooring', label: 'Flooring', options: ['Good', 'Repair', 'Replace'], total: 's.f.' },
    { id: 'ps-lighting', label: 'Lighting', options: ['Adequate', 'Repair', 'Replace', 'None exist'], total: 'ea.' },
    { id: 'ps-signage', label: 'Signage / Egress', options: ['Present', 'Missing', 'Requires update'] },
  ]},
  { id: 'hallway', title: 'Hallway', fields: [
    { id: 'hw-walls', label: 'Walls', options: ['Good', 'Peeling paint', 'Repair', 'Replace'], total: 's.f.' },
    { id: 'hw-floors', label: 'Floors', options: ['Good', 'Repair', 'Replace'], total: 's.f.' },
    { id: 'hw-ceiling', label: 'Ceiling', options: ['Good', 'Repair', 'Replace'], total: 's.f.' },
    { id: 'hw-lighting', label: 'Lighting', options: ['Adequate', 'Repair', 'Replace'], total: 'ea.' },
    { id: 'hw-doors', label: 'Hallway Doors', options: ['Good', 'Repair', 'Replace'], total: 'ea.' },
  ]},
  { id: 'handrail', title: 'Handrail', fields: [
    { id: 'hr-condition', label: 'Condition', options: ['Good', 'Loose', 'Repair', 'Replace', 'Missing'], total: 'l.f.' },
    { id: 'hr-material', label: 'Material', options: ['Metal', 'Wood', 'Other'] },
    { id: 'hr-compliance', label: 'Code Compliance', options: ['Compliant', 'Non-compliant', 'Requires bracket'] },
  ]},
  { id: 'magdoors', title: 'Magnetic Doors', fields: [
    { id: 'md-operation', label: 'Operation', options: ['Functional', 'Intermittent', 'Not working'] },
    { id: 'md-hardware', label: 'Mag Lock Hardware', options: ['Good', 'Repair', 'Replace'], total: 'ea.' },
    { id: 'md-power', label: 'Power / Wiring', options: ['Good', 'Repair', 'Replace'] },
    { id: 'md-release', label: 'Release / Fail-safe', options: ['Present', 'Missing', 'Requires update'] },
  ]},
];
