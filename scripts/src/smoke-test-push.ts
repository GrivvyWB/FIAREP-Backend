export {};

const required = (key: string): string => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
};

const configuredApiUrl = process.env["FIAREP_STAGING_API_URL"]?.trim();
const developmentDomain = process.env["REPLIT_DEV_DOMAIN"]?.trim();
const apiUrl = (
  configuredApiUrl ??
  (developmentDomain ? `https://${developmentDomain}/api` : "")
).replace(/\/$/, "");
if (!apiUrl) {
  throw new Error(
    "FIAREP_STAGING_API_URL is required outside a Replit development environment",
  );
}
const tenantId = required("FIAREP_STAGING_TENANT_ID");
const name = required("FIAREP_STAGING_STAFF_NAME");
const code = required("FIAREP_STAGING_STAFF_CODE");
const tokenInput = required("FIAREP_STAGING_EXPO_TOKEN");
const normalizeExpoToken = (input: string): string => {
  let candidate = input;
  try {
    const parsed = JSON.parse(input) as unknown;
    if (typeof parsed === "string") candidate = parsed;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "data" in parsed &&
      typeof parsed.data === "string"
    ) {
      candidate = parsed.data;
    }
  } catch {
    // Plain token input is expected and needs no JSON parsing.
  }
  const match = candidate.match(/(?:Expo|Exponent)PushToken\[[^\]]+\]/);
  if (!match) {
    throw new Error(
      "FIAREP_STAGING_EXPO_TOKEN must contain an ExpoPushToken[...] or ExponentPushToken[...] value",
    );
  }
  return match[0];
};
const token = normalizeExpoToken(tokenInput);
const role = process.env["FIAREP_STAGING_STAFF_ROLE"]?.trim();
const timeoutMinutes = Number(
  process.env["FIAREP_STAGING_SMOKE_TIMEOUT_MINUTES"] ?? "25",
);
if (!Number.isFinite(timeoutMinutes) || timeoutMinutes < 16) {
  throw new Error("FIAREP_STAGING_SMOKE_TIMEOUT_MINUTES must be at least 16");
}

class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  init: RequestInit,
  accessToken?: string,
): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new RequestError(
      response.status,
      `${init.method ?? "GET"} ${path} failed (${response.status}): ${
        body.error ?? "Unknown error"
      }`,
    );
  }
  return body;
}

let auth: { accessToken: string };
try {
  auth = await request<{ accessToken: string }>("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ name, code, ...(role ? { role } : {}) }),
  });
} catch (error) {
  if (!(error instanceof RequestError) || error.status !== 401) throw error;
  process.stdout.write(
    `No matching staging login found; bootstrapping the isolated ${tenantId} tenant.\n`,
  );
  auth = await request<{ accessToken: string }>("/v1/auth/bootstrap", {
    method: "POST",
    body: JSON.stringify({ name, code, tenantId }),
  });
}

await request(
  "/v1/devices/token",
  {
    method: "POST",
    body: JSON.stringify({ token, platform: "staging-smoke-test" }),
  },
  auth.accessToken,
);

const smoke = await request<{ notificationId: string; message: string }>(
  "/v1/push-smoke-test",
  { method: "POST", body: "{}" },
  auth.accessToken,
);

process.stdout.write(
  `Sent staging alert "${smoke.message}" (${smoke.notificationId}).\n`,
);
process.stdout.write(
  "Keep the staging phone locked and confirm the alert appears while this check waits for Expo's final receipt.\n",
);

const deadline = Date.now() + timeoutMinutes * 60_000;
const terminal = new Set([
  "delivered",
  "failed",
  "rejected",
  "request_failed",
  "receipt_timeout",
]);

while (Date.now() < deadline) {
  const rows = await request<
    Array<{
      status: string;
      ticketId?: string | null;
      errorCode?: string | null;
      detail?: string | null;
      completedAt?: string | null;
    }>
  >(
    `/v1/push-deliveries?notificationId=${encodeURIComponent(
      smoke.notificationId,
    )}`,
    { method: "GET" },
    auth.accessToken,
  );
  const delivery = rows[0];
  if (delivery && terminal.has(delivery.status)) {
    process.stdout.write(
      `${JSON.stringify({
        notificationId: smoke.notificationId,
        status: delivery.status,
        ticketId: delivery.ticketId ?? null,
        errorCode: delivery.errorCode ?? null,
        detail: delivery.detail ?? null,
        completedAt: delivery.completedAt ?? null,
      })}\n`,
    );
    if (delivery.status !== "delivered") process.exit(1);
    process.stdout.write(
      "Expo confirmed delivery. Visually confirm the matching alert on the staging phone before approving the release.\n",
    );
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 30_000));
}

throw new Error(
  `No final Expo receipt after ${timeoutMinutes} minutes for ${smoke.notificationId}`,
);