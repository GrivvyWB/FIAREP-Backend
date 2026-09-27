// Complaint phrases residents and field staff can pick from. KEEP THE TWO
// COPIES IDENTICAL: fiarep-mobile/lib/complaintPhrases.ts and
// fiarep-web/src/lib/complaint-phrases.ts. (Routing keywords live on the
// server in api-server/src/lib/complaintTrades.ts.)

export type PhraseGroup = { label: string; phrases: string[] };

export const PHRASE_GROUPS: PhraseGroup[] = [
  { label: 'Plumbing', phrases: [
    'Pipe burst', 'Busted pipe', 'Leaking pipe', 'Water leak', 'Ceiling leak', 'Toilet clogged',
    'Toilet overflowing', "Toilet won't flush", 'Clogged drain', 'Drain backing up', 'Sink clogged',
    'Bathtub drain clogged', 'Sewer backup', 'Sewage smell', 'Low water pressure', 'No water',
    'No hot water', 'Water heater not working', 'Water heater leaking', 'Faucet leaking',
    'Faucet broken', 'Shower leaking', "Shower won't drain", 'Water running continuously',
    'Frozen pipes', 'Broken water line',
  ] },
  { label: 'Electrical', phrases: [
    'Power out', 'Lights out', 'No electricity', 'Electrical outage', 'Outlet not working',
    'Socket not working', 'Electrical socket broken', 'Breaker keeps tripping', 'Fuse blown',
    'Lights flickering', 'Switch not working', 'Ceiling fan not working', 'Electrical burning smell',
    'Sparking outlet', 'Power surge damage', 'Exposed wiring', 'Faulty wiring', 'Panel problem',
    'Circuit overload', 'Light fixture broken',
  ] },
  { label: 'Heating / HVAC', phrases: [
    'No heat', 'Heat not working', 'Heater broken', 'Furnace not working', 'Boiler not working',
    'Radiator cold', 'Thermostat not working', 'HVAC not working', 'AC not cooling',
    'Air conditioner broken', 'No airflow', 'Loud furnace noise', 'Heating system failure',
    'Heat pump not working', 'Thermostat replacement', 'Ventilation problem', 'Uneven heating',
    'Emergency heating repair',
  ] },
  { label: 'Carpentry / Doors / Windows', phrases: [
    'Broken door', "Door won't close", 'Door stuck', 'Damaged door frame', 'Broken lock',
    "Window won't open", 'Broken window', 'Damaged trim', 'Loose railing', 'Staircase repair',
    'Damaged cabinets', 'Cabinet door broken', 'Damaged floorboards', 'Wood rot', 'Deck repair',
    'Porch repair', 'Framing damage', 'Broken shelves',
  ] },
  { label: 'Painting & Drywall', phrases: [
    'Wall damaged', 'Drywall hole', 'Drywall crack', 'Ceiling crack', 'Peeling paint', 'Paint damage',
    'Water stained wall', 'Water stained ceiling', 'Repaint room', 'Mold on wall', 'Wallpaper removal',
    'Wall repair', 'Ceiling repair',
  ] },
  { label: 'Roofing', phrases: [
    'Roof leak', 'Leaking roof', 'Missing shingles', 'Roof damage', 'Storm damage roof',
    'Water entering attic', 'Roof replacement needed', 'Flashing damage', 'Gutter leaking',
    'Gutter clogged', 'Gutter detached', 'Skylight leaking', 'Roof inspection needed',
  ] },
  { label: 'Masonry / Brick', phrases: [
    'Broken bricks', 'Cracked bricks', 'Damaged masonry', 'Cracked foundation', 'Foundation repair',
    'Retaining wall damage', 'Chimney damaged', 'Chimney leaning', 'Loose bricks', 'Brick wall repair',
    'Stone wall repair', 'Cracked concrete', 'Paver repair', 'Sidewalk crack', 'Masonry restoration',
  ] },
  { label: 'Bathroom', phrases: [
    'Bathroom tile broken', 'Cracked tile', 'Loose tile', 'Shower tile repair', 'Bathtub damaged',
    'Shower leaking', 'Mold in bathroom', 'Bathroom renovation needed', 'Bathroom water damage',
    'Toilet loose', 'Vanity damaged',
  ] },
  { label: 'Kitchen', phrases: [
    'Kitchen leak', 'Sink clogged', 'Garbage disposal not working', 'Cabinet damaged',
    'Countertop damaged', 'Kitchen flooding', 'Faucet leaking', 'Appliance water leak',
  ] },
  { label: 'Safety', phrases: [
    'Smoke detector not working', 'Smoke detector missing', 'Smoke detector beeping',
    'Carbon monoxide detector not working', 'Carbon monoxide detector missing',
    'Window guard missing', 'Window guard broken', 'Fire escape blocked', 'Fire escape broken',
    'Sprinkler leaking', 'Exit sign out', 'Self-closing door broken', 'Gas smell',
  ] },
  { label: 'Pests', phrases: [
    'Mice in apartment', 'Rats', 'Roaches', 'Bed bugs', 'Ants', 'Pest control needed',
  ] },
  { label: 'Intercom / Doorbell', phrases: [
    'Intercom not working', 'Buzzer not working', 'Doorbell broken', 'Entrance door lock broken',
  ] },
  { label: 'Appliances / Gas', phrases: [
    'Stove not working', 'Oven not working', 'Stove burner not lighting', 'Cooking gas shut off',
    'Refrigerator not cooling', 'Refrigerator broken', 'Range hood broken',
  ] },
  { label: 'Building / Public Areas', phrases: [
    'Elevator not working', 'Elevator stuck', 'Hallway lights out', 'Stairwell lights out',
    'Garbage not collected', 'Trash chute clogged', 'Lead paint peeling', 'Damaged floor',
    'Loose floor tile', 'Unsanitary conditions',
  ] },
  { label: 'General', phrases: [
    'Emergency repair', 'Property damage', 'Maintenance request', 'Building repair',
    'Tenant repair request', 'Safety hazard', 'Water damage', 'Storm damage', 'Mold problem',
    'Structural damage', 'Broken fixture', 'Repair needed',
  ] },
];

const ALL_PHRASES: string[] = [...new Set(PHRASE_GROUPS.flatMap((g) => g.phrases))];

// Everyday words people type → the words used in the phrases (same meaning).
const SYNONYMS: Record<string, string[]> = {
  alarm: ['detector', 'alarm'], alarms: ['detector', 'alarm'], detector: ['detector', 'alarm'], detectors: ['detector'],
  co: ['carbon', 'monoxide'], monoxide: ['monoxide'], carbon: ['carbon'],
  fridge: ['refrigerator'], refrigerator: ['refrigerator'], freezer: ['refrigerator'],
  stove: ['stove', 'burner', 'range'], range: ['stove', 'range'], burner: ['burner', 'stove'], oven: ['oven'],
  mouse: ['mice'], mice: ['mice'], rat: ['rats'], rats: ['rats'], roach: ['roaches'], roaches: ['roaches'],
  cockroach: ['roaches'], cockroaches: ['roaches'], bedbug: ['bed', 'bugs'], bedbugs: ['bed', 'bugs'], bugs: ['bugs', 'pest'],
  pest: ['pest'], pests: ['pest', 'mice', 'roaches'], ant: ['ants'],
  buzzer: ['buzzer', 'intercom'], intercom: ['intercom', 'buzzer'], doorbell: ['doorbell', 'buzzer'], bell: ['doorbell'],
  electric: ['electrical', 'electricity', 'power'], electricity: ['electricity', 'power'], power: ['power', 'electricity'],
  light: ['lights', 'light'], lights: ['lights', 'light'], lamp: ['light'], bulb: ['light', 'lights'],
  outlet: ['outlet', 'socket'], plug: ['outlet', 'socket'], socket: ['socket', 'outlet'],
  heat: ['heat', 'heating', 'heater'], heater: ['heater', 'heat'], radiator: ['radiator'], cold: ['cold', 'cooling'], cooling: ['cooling', 'cold'],
  broken: ['broken', 'not', 'working', 'damaged'], broke: ['broken', 'not', 'working'], busted: ['broken', 'burst', 'busted'],
  dead: ['not', 'working'], beeping: ['beeping'], chirping: ['beeping'],
  ac: ['ac', 'air', 'hvac'], conditioner: ['air', 'ac'],
  leak: ['leak', 'leaking'], leaking: ['leak', 'leaking'], leaks: ['leak'], drip: ['leak', 'leaking'], dripping: ['leak', 'leaking'],
  clog: ['clogged'], clogged: ['clogged'], stopped: ['clogged'], backed: ['backing', 'backup'],
  flood: ['flooding'], flooding: ['flooding'], flooded: ['flooding'],
  mold: ['mold'], mould: ['mold'], mildew: ['mold'],
  pipe: ['pipe', 'pipes'], pipes: ['pipe', 'pipes'], toilet: ['toilet'], sink: ['sink'], tub: ['bathtub'], bathtub: ['bathtub'],
  shower: ['shower'], faucet: ['faucet'], tap: ['faucet'], drain: ['drain'],
  door: ['door'], doors: ['door'], lock: ['lock'], locks: ['lock'], key: ['lock'], window: ['window'], windows: ['window'],
  guard: ['guard'], guards: ['guard'], floor: ['floor', 'floorboards'], ceiling: ['ceiling'], wall: ['wall', 'drywall'],
  roof: ['roof', 'shingles'], elevator: ['elevator'], lift: ['elevator'], garbage: ['garbage', 'trash'], trash: ['trash', 'garbage'],
  gas: ['gas'], paint: ['paint'], peeling: ['peeling'], tile: ['tile'], tiles: ['tile'], cabinet: ['cabinet', 'cabinets'],
  sprinkler: ['sprinkler'], hallway: ['hallway'], stairwell: ['stairwell'], stairs: ['staircase', 'stairwell'],
};

// Words that only describe the condition (broken, not working …). They help
// rank phrases but never pick a phrase on their own — the THING that is broken
// ("smoke detector", "toilet") must match.
const CONDITION_WORDS = new Set([
  'broken', 'broke', 'busted', 'not', 'working', 'work', 'works', 'damaged', 'damage', 'repair', 'needed',
  'missing', 'loose', 'stuck', 'cracked', 'crack', 'bad', 'problem', 'issue', 'failure', 'out', 'off',
  'stopped', 'clogged', 'dead', 'chirping', 'cold',
  "won't", 'wont', 'doesnt', "doesn't", 'isnt', "isn't", 'cant', "can't", 'beeping', 'noise', 'loud',
]);

const STOP = new Set(['no', 'the', 'a', 'an', 'is', 'my', 'in', 'on', 'of', 'and', 'it', 'to', 'at', 'there', 'has', 'have', 'i', 'from', 'with', 'for', 'our', 'we', 'this', 'that', 'apartment', 'apt', 'unit', 'room']);

function words(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 2 && !STOP.has(w));
}

/** 3 = same word, 2 = same meaning, 1 = word start ("elec…"), 0 = no match. */
function matchStrength(typed: string, phraseWords: string[]): number {
  if (phraseWords.includes(typed)) return 3;
  const variants = SYNONYMS[typed] || [];
  if (phraseWords.some((w) => variants.includes(w))) return 2;
  if (typed.length >= 4 && phraseWords.some((w) => w.startsWith(typed))) return 1;
  return 0;
}

/**
 * Phrases that fit what someone is typing ("smoke detector broken" →
 * "Smoke detector not working", …). The thing named must match; condition
 * words (broken, not working) only rank. Returns [] until a real word is typed.
 */
export function suggestPhrases(text: string, limit = 6): string[] {
  const typed = words(text).slice(-8);
  if (!typed.length) return [];
  const subjects = typed.filter((w) => !CONDITION_WORDS.has(w));
  const conditions = typed.filter((w) => CONDITION_WORDS.has(w));
  const current = text.trim().toLowerCase();
  const scored: { phrase: string; score: number }[] = [];
  for (const phrase of ALL_PHRASES) {
    if (phrase.toLowerCase() === current) continue;
    const pw = words(phrase);
    const subjectScores = subjects.map((t) => matchStrength(t, pw));
    const subjectHits = subjectScores.filter((n) => n > 0).length;
    if (!subjectHits) continue;
    const conditionScore = conditions.reduce((sum, t) => sum + matchStrength(t, pw), 0);
    // Prefer phrases that match every thing named, then the condition words.
    const score = subjectScores.reduce((a, b) => a + b, 0) * 10 +
      (subjectHits === subjects.length ? 8 : 0) + conditionScore * 2;
    scored.push({ phrase, score });
  }
  scored.sort((a, b) => b.score - a.score || a.phrase.length - b.phrase.length);
  return scored.slice(0, limit).map((s) => s.phrase);
}

/** Put a picked phrase into the text: short text is replaced, longer text keeps the details. */
export function applyPhrase(current: string, phrase: string): string {
  const text = current.trim();
  if (!text || text.length <= 30) return phrase;
  if (text.toLowerCase().startsWith(phrase.toLowerCase())) return text;
  return `${phrase}. ${text}`;
}
