export interface OrganizationResearchResult {
  organizationName: string;
  officialWebsite: string | null;
  organizationType: string | null;
  developments: string[];
  sources: string[];
}

function responseText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const output = (payload as { output?: unknown }).output;
  if (!Array.isArray(output)) return "";
  for (const item of output) {
    if (!item || typeof item !== "object" || !Array.isArray((item as { content?: unknown }).content)) continue;
    for (const content of (item as { content: unknown[] }).content) {
      if (content && typeof content === "object" && typeof (content as { text?: unknown }).text === "string") {
        return (content as { text: string }).text;
      }
    }
  }
  return "";
}

function validateResult(value: unknown, requestedName: string): OrganizationResearchResult {
  if (!value || typeof value !== "object") throw new Error("AI returned an invalid organization profile");
  const record = value as Record<string, unknown>;
  const developments = Array.isArray(record["developments"])
    ? record["developments"]
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
    : [];
  const sources = Array.isArray(record["sources"])
    ? record["sources"]
        .filter((item): item is string => typeof item === "string" && /^https:\/\//i.test(item))
        .map((item) => item.trim())
    : [];
  return {
    organizationName: typeof record["organizationName"] === "string" && record["organizationName"].trim()
      ? record["organizationName"].trim()
      : requestedName,
    officialWebsite: typeof record["officialWebsite"] === "string" && /^https:\/\//i.test(record["officialWebsite"])
      ? record["officialWebsite"].trim()
      : null,
    organizationType: typeof record["organizationType"] === "string" && record["organizationType"].trim()
      ? record["organizationType"].trim()
      : null,
    developments: [...new Set(developments)].sort((a, b) => a.localeCompare(b)),
    sources: [...new Set(sources)],
  };
}

export async function researchOrganization(
  organizationName: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OrganizationResearchResult> {
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5.6-terra",
      max_output_tokens: 16_000,
      tools: [{ type: "web_search" }],
      input: [
        {
          role: "system",
          content: "Research organizations using current public web sources. Prefer the organization's official website. Return only verified named developments, properties, projects, or managed sites that sit under the organization. Never invent entries or convert a unit count into a development count.",
        },
        {
          role: "user",
          content: `Research "${organizationName}". Find its official website, organization type, and complete published list of developments, properties, projects, or managed sites. Return JSON only with keys organizationName, officialWebsite, organizationType, developments, and sources. developments and sources must be arrays of strings.`,
        },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`OpenAI organization research failed with status ${response.status}`);
  const text = responseText(await response.json());
  if (!text) throw new Error("AI returned an empty organization profile");
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  return validateResult(JSON.parse(cleaned), organizationName);
}