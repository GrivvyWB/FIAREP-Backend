/**
 * FIAREP score calculations.
 *
 * This module deliberately has no database or HTTP dependencies.  Keeping the
 * calculations here makes the scoring contract deterministic and keeps the
 * route from accidentally returning any of the source record state.
 */

export type ScoringRecord = {
  entity: string;
  development?: string | null;
  state: Record<string, unknown>;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

export type VendorScore = {
  vendor: string;
  score: number;
  completed: number;
  onTimeRate: number;
  deductions: number;
};

export type DevelopmentScore = {
  development: string;
  points: number;
  scorePercent: number;
  completed: number;
  open: number;
  overdue: number;
  sampleSize: number;
};

export type BuildingScore = {
  building: string;
  score: number;
  total: number;
  resolved: number;
  open: number;
  overdue: number;
  resolutionRate: number;
};

export type ResidentialScore = {
  address: string;
  score: number;
  total: number;
  resolved: number;
  open: number;
  overdue: number;
  resolutionRate: number;
};

const RESOLVED_STATUSES = new Set(["cleared", "completed", "resolved", "closed"]);
const DEVELOPMENT_ENTITIES = new Set([
  "procurement",
  "route-assignments",
  "building-violations",
  "violations",
  "inspections",
  "resident-reports",
]);
const BUILDING_ENTITIES = new Set([
  "building-violations",
  "violations",
  "inspections",
  "resident-reports",
]);

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function statusOf(record: ScoringRecord): string {
  return text(record.state["status"]).toLowerCase();
}

function firstText(record: ScoringRecord, keys: string[]): string {
  for (const key of keys) {
    const value = text(record.state[key]);
    if (value) return value;
  }
  return "";
}

function dateValue(value: unknown): number | null {
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.getTime();
}

function startedAt(record: ScoringRecord): number | null {
  // These are the source-specific "work began" fields used by the existing
  // mobile score views, followed by the persisted entity timestamp.
  const keys = [
    "createdAt",
    "requestedAt",
    "assignedAt",
    "routedAt",
    "loggedAt",
    "sentAt",
    "submittedAt",
    "startedAt",
  ];
  for (const key of keys) {
    const value = dateValue(record.state[key]);
    if (value !== null) return value;
  }
  return dateValue(record.createdAt);
}

function isResolved(record: ScoringRecord): boolean {
  const status = statusOf(record);
  if (RESOLVED_STATUSES.has(status)) return true;

  // Route assignments contain the workflow status on each stop rather than
  // on the assignment itself.
  if (record.entity === "route-assignments") {
    const stops = record.state["stops"];
    return Array.isArray(stops) && stops.length > 0 &&
      stops.every((stop) => {
        if (!stop || typeof stop !== "object") return false;
        const stopStatus = text((stop as Record<string, unknown>)["status"]).toLowerCase();
        return stopStatus !== "" && stopStatus !== "pending";
      });
  }
  return false;
}

function isOverdue(record: ScoringRecord, now: number): boolean {
  if (isResolved(record)) return false;
  const started = startedAt(record);
  return started !== null && now - started >= 14 * 86400000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function ratio(value: number, total: number): number {
  return total > 0 ? value / total : 0;
}

function groupingValue(record: ScoringRecord, keys: string[]): string {
  return firstText(record, keys) ||
    text(record.development) ||
    firstText(record, ["development"]) ||
    "Unassigned";
}

function sorted<T extends { score?: number; scorePercent?: number; vendor?: string; development?: string; building?: string; address?: string }>(items: T[]): T[] {
  return items.sort((a, b) => {
    const scoreA = a.score ?? a.scorePercent ?? 0;
    const scoreB = b.score ?? b.scorePercent ?? 0;
    return scoreB - scoreA ||
      (a.vendor ?? a.development ?? a.building ?? a.address ?? "")
        .localeCompare(b.vendor ?? b.development ?? b.building ?? b.address ?? "");
  });
}

export function calculateVendorScores(
  records: readonly ScoringRecord[],
): VendorScore[] {
  const buckets = new Map<string, { performance: number[]; completed: number; onTime: number; deductions: number }>();
  const performance: Record<string, number> = { good: 1, fair: 0.6, poor: 0.2 };

  for (const record of records) {
    if (record.entity !== "procurement" || statusOf(record) !== "closed") continue;
    const vendor = firstText(record, ["vendor"]);
    const rating = performance[text(record.state["performance"]).toLowerCase()];
    if (!vendor || rating === undefined) continue;
    const bucket = buckets.get(vendor) ?? { performance: [], completed: 0, onTime: 0, deductions: 0 };
    bucket.completed += 1;
    bucket.performance.push(rating);
    const deduction = record.state["deduction"];
    if (typeof deduction === "number" && Number.isFinite(deduction) && deduction > 0) {
      bucket.deductions += 1;
    }
    const start = dateValue(record.state["awardedAt"]) ?? dateValue(record.state["startedAt"]);
    const done = dateValue(record.state["completedAt"]) ?? dateValue(record.state["closedAt"]);
    if (start !== null && done !== null && done >= start && done - start <= 14 * 86400000) {
      bucket.onTime += 1;
    }
    buckets.set(vendor, bucket);
  }

  return sorted(Array.from(buckets, ([vendor, bucket]) => {
    const performanceAvg = ratio(
      bucket.performance.reduce((sum, value) => sum + value, 0),
      bucket.performance.length,
    );
    const onTimeRate = ratio(bucket.onTime, bucket.completed);
    const deductionRate = ratio(bucket.deductions, bucket.completed);
    return {
      vendor,
      completed: bucket.completed,
      onTimeRate,
      deductions: bucket.deductions,
      score: clamp(Math.round(100 * (
        0.60 * performanceAvg + 0.25 * onTimeRate - 0.15 * deductionRate
      )), 0, 100),
    };
  }));
}

export function calculateDevelopmentScores(
  records: readonly ScoringRecord[],
  now: Date = new Date(),
): DevelopmentScore[] {
  const buckets = new Map<string, { points: number; completed: number; open: number; overdue: number }>();
  const nowMs = now.getTime();
  for (const record of records) {
    if (!DEVELOPMENT_ENTITIES.has(record.entity)) continue;
    const development = text(record.development) ||
      firstText(record, ["development", "address", "building", "propertyAddress"]) ||
      "Unassigned";
    const bucket = buckets.get(development) ?? { points: 0, completed: 0, open: 0, overdue: 0 };
    if (isResolved(record) || (record.entity === "procurement" && statusOf(record) === "closed")) {
      bucket.points += 10;
      bucket.completed += 1;
    } else if (isOverdue(record, nowMs)) {
      bucket.points -= 10;
      bucket.overdue += 1;
    } else {
      bucket.points -= 5;
      bucket.open += 1;
    }
    buckets.set(development, bucket);
  }
  return sorted(Array.from(buckets, ([development, bucket]) => ({
    development,
    points: bucket.points,
    scorePercent: clamp(50 + bucket.points, 0, 100),
    completed: bucket.completed,
    open: bucket.open,
    overdue: bucket.overdue,
    sampleSize: bucket.completed + bucket.open + bucket.overdue,
  })));
}

function calculateResolutionScores(
  records: readonly ScoringRecord[],
  entities: ReadonlySet<string>,
  keyFields: string[],
  now: Date,
): Array<{ key: string; total: number; resolved: number; open: number; overdue: number; resolutionRate: number; score: number }> {
  const buckets = new Map<string, { total: number; resolved: number; open: number; overdue: number }>();
  for (const record of records) {
    if (!entities.has(record.entity)) continue;
    const key = groupingValue(record, keyFields);
    const bucket = buckets.get(key) ?? { total: 0, resolved: 0, open: 0, overdue: 0 };
    bucket.total += 1;
    if (isResolved(record)) bucket.resolved += 1;
    else if (isOverdue(record, now.getTime())) bucket.overdue += 1;
    else bucket.open += 1;
    buckets.set(key, bucket);
  }
  return Array.from(buckets, ([key, bucket]) => {
    const resolutionRate = ratio(bucket.resolved, bucket.total);
    const overdueRate = ratio(bucket.overdue, bucket.total);
    const openRate = ratio(bucket.open, bucket.total);
    return {
      key,
      ...bucket,
      resolutionRate,
      score: Math.round(100 * resolutionRate - 15 * overdueRate - 5 * openRate),
    };
  });
}

export function calculateBuildingScores(
  records: readonly ScoringRecord[],
  now: Date = new Date(),
): BuildingScore[] {
  return sorted(calculateResolutionScores(
    records,
    BUILDING_ENTITIES,
    ["building", "address", "propertyAddress", "development"],
    now,
  ).map(({ key: building, ...score }) => ({ building, ...score })));
}

export function calculateResidentialScores(
  records: readonly ScoringRecord[],
  now: Date = new Date(),
): ResidentialScore[] {
  return calculateResolutionScores(
    records,
    new Set(["resident-reports"]),
    ["address", "building", "development"],
    now,
  )
    .map(({ key: address, score, total, resolved, open, overdue, resolutionRate }) => ({
      address,
      score,
      total,
      resolved,
      open,
      overdue,
      resolutionRate,
    }))
    .sort((a, b) => b.resolutionRate - a.resolutionRate || a.address.localeCompare(b.address));
}