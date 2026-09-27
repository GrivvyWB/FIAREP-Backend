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
  { label: 'General', phrases: [
    'Emergency repair', 'Property damage', 'Maintenance request', 'Building repair',
    'Tenant repair request', 'Safety hazard', 'Water damage', 'Storm damage', 'Mold problem',
    'Structural damage', 'Broken fixture', 'Repair needed',
  ] },
];

const ALL_PHRASES: string[] = [...new Set(PHRASE_GROUPS.flatMap((g) => g.phrases))];

// Everyday words people type → words used in the phrases.
const SYNONYMS: Record<string, string[]> = {
  busted: ['broken', 'burst', 'busted'], broke: ['broken'], broken: ['broken', 'busted', 'burst', 'damaged'],
  leaking: ['leak', 'leaking'], leaks: ['leak', 'leaking'], leak: ['leak', 'leaking'], dripping: ['leak', 'leaking'],
  clog: ['clogged'], stopped: ['clogged'], stuck: ['stuck', 'clogged'],
  electric: ['electrical', 'electricity', 'power'], power: ['power', 'electricity', 'electrical'],
  light: ['lights', 'light'], lights: ['lights', 'light'], cold: ['heat', 'cold', 'radiator'],
  heat: ['heat', 'heating', 'heater'], ac: ['ac', 'air', 'hvac'], air: ['air', 'airflow', 'ac'],
  mold: ['mold'], mould: ['mold'], hole: ['hole'], crack: ['crack', 'cracked'], cracked: ['crack', 'cracked'],
  flood: ['flooding', 'overflowing'], flooding: ['flooding', 'overflowing'], smell: ['smell'],
  window: ['window'], door: ['door'], lock: ['lock'], toilet: ['toilet'], sink: ['sink'], pipe: ['pipe', 'pipes'],
  roof: ['roof', 'shingles'], wall: ['wall', 'drywall'], ceiling: ['ceiling'], tile: ['tile'],
};

const STOP = new Set(['no', 'the', 'a', 'an', 'is', 'my', 'in', 'on', 'of', 'and', 'it', 'to', 'at', 'not', 'there', 'has', 'have', 'i', 'from', 'with', 'for']);

function words(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 2 && !STOP.has(w));
}

/**
 * Phrases that fit what someone is typing ("broken water" → "Broken water line",
 * "Water leak", …). Returns [] until at least one real word is typed.
 */
export function suggestPhrases(text: string, limit = 6): string[] {
  const typed = words(text).slice(-6);
  if (!typed.length) return [];
  const current = text.trim().toLowerCase();
  const scored: { phrase: string; score: number }[] = [];
  for (const phrase of ALL_PHRASES) {
    const pw = words(phrase);
    if (phrase.toLowerCase() === current) continue;
    let score = 0;
    for (const t of typed) {
      const variants = SYNONYMS[t] || [t];
      if (pw.some((w) => w === t)) score += 3;
      else if (pw.some((w) => variants.includes(w))) score += 2;
      else if (t.length >= 3 && pw.some((w) => w.startsWith(t))) score += 2;
    }
    if (score > 0) scored.push({ phrase, score });
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
