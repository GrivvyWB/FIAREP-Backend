// Take me there: turn an HPD violation's own wording into steps inside the
// building. HPD writes where a condition is in a fixed pattern, with compass
// directions - e.g. "...in the bathroom located at apt 3B, 3rd story, 1st
// apartment from east at north" or "...in the 2nd room from north at west".
// FIAREP reads that and guides with the phone's compass. HPD keeps no
// coordinates, so this gets you to the apartment, the room and the surface -
// the inspector's words are the most exact location there is.

export type Dir = 'north' | 'south' | 'east' | 'west';
export const BEARING: Record<Dir, number> = { north: 0, east: 90, south: 180, west: 270 };

export type GuideStep = {
  title: string;
  detail: string;
  /** Face this way (degrees from north) for this step; the arrow turns green when you do. */
  bearing?: number;
  facing?: string;
};

const ORD = '(\\d+)(?:st|nd|rd|th)';
const DIR = '(north|south|east|west)';
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const nth = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;

const ROOMS = [
  'kitchen', 'bathroom', 'living room', 'dining room', 'foyer', 'bedroom', 'hallway', 'hall', 'closet', 'entrance',
  'public hall', 'stairway', 'stairs', 'cellar', 'basement', 'roof', 'boiler room', 'laundry room', 'lobby', 'courtyard',
];
const SURFACES = [
  'ceiling', 'floor', 'wall', 'walls', 'window', 'windows', 'window guard', 'door', 'entrance door', 'radiator', 'sink',
  'bathtub', 'toilet', 'water closet', 'basin', 'outlet', 'light fixture', 'smoke detector', 'carbon monoxide detector',
  'cabinet', 'cabinets', 'stove', 'range', 'refrigerator', 'baseboard', 'tiles', 'plaster', 'paint',
];

export function guideFor(input: { description: string; apartment?: string | null; story?: string | null }): { steps: GuideStep[]; found: boolean } {
  const text = (input.description || '').toLowerCase().replace(/\s+/g, ' ');
  const steps: GuideStep[] = [];
  let found = false;

  // Floor and apartment.
  const storyText = (input.story || '').trim() || (text.match(new RegExp(`${ORD} story`))?.[1] ?? '');
  const apt = (input.apartment || '').trim() || (text.match(/\bapt\.?\s*([a-z0-9-]+)/)?.[1] ?? '').toUpperCase();
  if (storyText || apt) {
    found = true;
    const floor = /^\d+$/.test(storyText) ? `${nth(Number(storyText))} floor` : storyText ? `floor ${storyText}` : '';
    steps.push({ title: [floor && `Go to the ${floor}`, apt && `Apt ${apt}`].filter(Boolean).join(' → '), detail: 'Take the stairs or elevator to this floor.' });
  }

  // Which apartment on the floor: "1st apartment from east at north".
  const aptWhere = text.match(new RegExp(`${ORD} apartment from ${DIR} at ${DIR}`));
  if (aptWhere) {
    found = true;
    const n = Number(aptWhere[1]); const from = aptWhere[2] as Dir; const side = aptWhere[3] as Dir;
    steps.push({ title: `Walk toward the ${cap(from)} end of the hall`, detail: `Follow the arrow until it turns green and walk that way.`, bearing: BEARING[from], facing: cap(from) });
    steps.push({ title: `${cap(nth(n))} apartment on the ${cap(side)} side`, detail: `Counting from the ${from} end, it is the ${nth(n)} door on the ${side} side${apt ? ` - Apt ${apt}` : ''}.`, bearing: BEARING[side], facing: cap(side) });
  }

  // Which room: "2nd room from north at west", or a named room.
  const roomWhere = text.match(new RegExp(`${ORD} room from ${DIR} at ${DIR}`));
  if (roomWhere) {
    found = true;
    const n = Number(roomWhere[1]); const from = roomWhere[2] as Dir; const side = roomWhere[3] as Dir;
    steps.push({ title: `Inside: walk toward the ${cap(from)}`, detail: 'Follow the arrow and count the rooms as you pass them.', bearing: BEARING[from], facing: cap(from) });
    steps.push({ title: `${cap(nth(n))} room on the ${cap(side)} side`, detail: `Counting from the ${from}, it is the ${nth(n)} room on the ${side} side.`, bearing: BEARING[side], facing: cap(side) });
  } else {
    const room = ROOMS.find((r) => new RegExp(`\\b${r}\\b`).test(text));
    if (room) { found = true; steps.push({ title: `Go to the ${cap(room)}`, detail: `The violation is in the ${room}.` }); }
  }

  // Which wall: "...at north wall", "east wall".
  const wall = text.match(new RegExp(`${DIR} wall`));
  const surface = SURFACES.filter((s) => new RegExp(`\\b${s}\\b`).test(text)).sort((a, b) => b.length - a.length)[0];
  if (wall) {
    found = true;
    const d = wall[1] as Dir;
    steps.push({ title: `Face the ${cap(d)} wall`, detail: surface ? `Look for the ${surface} on that wall.` : 'The condition is on this wall.', bearing: BEARING[d], facing: cap(d) });
  } else if (surface) {
    found = true;
    steps.push({ title: `Look at the ${surface}`, detail: `The violation is on the ${surface}${/\bceiling\b/.test(surface) ? ' - look up' : /\bfloor\b/.test(surface) ? ' - look down' : ''}.` });
  }

  return { steps, found };
}
