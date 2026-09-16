export function getConfiguredDevelopmentNames(features: unknown): string[] | null {
  if (!features || typeof features !== "object" || Array.isArray(features)) return null;
  const value = (features as Record<string, unknown>)["configuredDevelopments"];
  if (value === undefined) return null;
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

export function addConfiguredDevelopmentName(features: unknown, name: string): Record<string, unknown> {
  const existing = features && typeof features === "object" && !Array.isArray(features)
    ? { ...(features as Record<string, unknown>) }
    : {};
  existing.configuredDevelopments = [...new Set([
    ...(getConfiguredDevelopmentNames(features) ?? []),
    name.trim(),
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return existing;
}

export function addOrganizationNameForDevelopmentType(
  features: unknown,
  organizationName: string,
): Record<string, unknown> {
  const existing = features && typeof features === "object" && !Array.isArray(features)
    ? { ...(features as Record<string, unknown>) }
    : {};
  const organizationType = typeof existing["organizationType"] === "string"
    ? existing["organizationType"].trim().toLowerCase()
    : "";
  return organizationType === "development"
    ? addConfiguredDevelopmentName(existing, organizationName)
    : existing;
}