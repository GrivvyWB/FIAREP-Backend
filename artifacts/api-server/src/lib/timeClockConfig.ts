export type TimeClockProvider = string | null;

export type TimeClockConfig = {
  integrationEnabled: boolean;
  externalAuthoritative: boolean;
  mobileClockEnabled: boolean;
  provider: TimeClockProvider;
};

export const DEFAULT_TIME_CLOCK_CONFIG: TimeClockConfig = {
  integrationEnabled: false,
  externalAuthoritative: true,
  mobileClockEnabled: false,
  provider: null,
};

export function canonicalizeProvider(provider: string): string {
  return provider.trim().toLowerCase();
}

/** Safely resolve the feature flag without trusting malformed tenant JSON. */
export function getTimeClockConfig(features: unknown): TimeClockConfig {
  const value = features && typeof features === "object" && !Array.isArray(features)
    ? (features as Record<string, unknown>)["timeClock"]
    : undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_TIME_CLOCK_CONFIG };
  }
  const input = value as Record<string, unknown>;
  return {
    integrationEnabled: input.integrationEnabled === true,
    externalAuthoritative: true,
    mobileClockEnabled: input.mobileClockEnabled === true,
    provider: typeof input.provider === "string" && input.provider.trim() ? canonicalizeProvider(input.provider) : null,
  };
}

export function mergeTimeClockConfig(features: unknown, patch: Partial<TimeClockConfig>): Record<string, unknown> {
  const existing = features && typeof features === "object" && !Array.isArray(features)
    ? { ...(features as Record<string, unknown>) }
    : {};
  existing.timeClock = {
    ...getTimeClockConfig(features),
    ...patch,
    externalAuthoritative: true,
  };
  return existing;
}

export function expectedDirection(latest: { direction: "in" | "out" } | null): "in" | "out" {
  return latest?.direction === "in" ? "out" : "in";
}

export function isMobileClockMutationAllowed(config: TimeClockConfig): boolean {
  return config.mobileClockEnabled === true;
}

export type TimeClockPunchForSerialization = {
  id: string;
  direction: "in" | "out";
  source: "external" | "fiarep-mobile";
  punchAt: Date;
  recordedAt: Date;
  provider: string | null;
  externalId: string | null;
};

export function serializeTimeClockPunch(punch: TimeClockPunchForSerialization) {
  return {
    id: punch.id,
    direction: punch.direction,
    source: punch.source,
    punchAt: punch.punchAt.toISOString(),
    recordedAt: punch.recordedAt.toISOString(),
    provider: punch.provider,
    externalId: punch.externalId,
    readOnly: punch.source === "external",
  };
}

export function rejectUnimplementedExternalIntegration(patch: {
  integrationEnabled?: boolean;
  provider?: string | null;
}): string | null {
  if (patch.integrationEnabled === true) return "External time-clock integration is not available until a provider adapter is configured";
  if ("provider" in patch) return "The external time-clock provider is managed by the provider adapter";
  return null;
}

export function classifyMobileIdempotency(
  existing: { staffId: string; source: string; direction: "in" | "out" } | null,
  actorId: string,
  direction: "in" | "out",
): "new" | "retry" | "conflict" {
  if (!existing) return "new";
  return existing.staffId === actorId && existing.source === "fiarep-mobile" && existing.direction === direction
    ? "retry"
    : "conflict";
}