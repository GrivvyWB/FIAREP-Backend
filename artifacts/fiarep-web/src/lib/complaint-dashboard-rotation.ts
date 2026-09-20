export const DEVELOPMENTS_PER_ROTATION = 10;
export const DEVELOPMENT_ROTATION_MS = 30 * 60 * 1000;

export type DevelopmentPageAction =
  | { type: "filtersChanged" }
  | { type: "countChanged"; pageCount: number }
  | { type: "next"; pageCount: number }
  | { type: "previous"; pageCount: number };

export function getDevelopmentPageCount(developmentCount: number) {
  return Math.max(1, Math.ceil(developmentCount / DEVELOPMENTS_PER_ROTATION));
}

export function getVisibleDevelopmentPage<T>(developments: T[], page: number) {
  const start = page * DEVELOPMENTS_PER_ROTATION;
  return developments.slice(start, start + DEVELOPMENTS_PER_ROTATION);
}

export function updateDevelopmentPage(current: number, action: DevelopmentPageAction) {
  if (action.type === "filtersChanged") return 0;

  const pageCount = Math.max(1, action.pageCount);
  if (action.type === "countChanged") return Math.min(current, pageCount - 1);
  if (action.type === "next") return (current + 1) % pageCount;
  return (current - 1 + pageCount) % pageCount;
}

export function getComplaintPulseLevel(activeCount: number) {
  if (activeCount >= 20) return "red";
  if (activeCount >= 10) return "orange";
  return "standard";
}