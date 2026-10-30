// A complaint the page already has (the Complaint Dashboard card, an alert's list) is shown the
// moment it is pressed; the page then refreshes it from the server in the background.
type Report = { id: string; development?: string | null; state?: Record<string, unknown>; createdAt: string };
const cache = new Map<string, Report>();
export const rememberComplaint = (id: string, r: Report) => { cache.set(id, r); };
export const knownComplaint = (id: string) => cache.get(id) ?? null;
