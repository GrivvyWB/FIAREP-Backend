import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, refreshSessions, platformOwnerSessions, staffAccounts, organizations, type StaffAccount, type Organization } from "@workspace/db";

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_DAYS = 30;

export type Actor = {
  id: string;
  tenantId: string;
  name: string;
  role: string;
  position: string;
  developments: string[];
  sessionVersion: number;
};

export type PlatformOwner = { name: string; sessionId: string; typ: "platform_owner"; iat: number; exp: number };

type AccessPayload = Actor & {
  exp: number;
  iat: number;
  typ: "access";
};

type ProcurementChallengePayload = {
  staffId: string;
  tenantId: string;
  challengeCode: string;
  exp: number;
  iat: number;
  typ: "procurement_challenge";
};

function secret(): string {
  const value = process.env["SESSION_SECRET"];
  if (!value) throw new Error("SESSION_SECRET is required");
  return value;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeHeader(value: string): { alg?: unknown; typ?: unknown } {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { alg?: unknown; typ?: unknown };
}

function signature(input: string): string {
  return createHmac("sha256", secret()).update(input).digest("base64url");
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function evaluateLicense(tenantId: string): Promise<Organization | null> {
  const [organization] = await db.select().from(organizations).where(eq(organizations.id, tenantId)).limit(1);
  if (!organization && tenantId === "default") {
    const [defaultOrganization] = await db.insert(organizations).values({
      id: "default",
      name: "Default Organization",
      status: "active",
      unrestricted: true,
      features: {},
    }).onConflictDoNothing().returning();
    if (defaultOrganization) return defaultOrganization;
    const [existingDefault] = await db.select().from(organizations).where(eq(organizations.id, "default")).limit(1);
    return existingDefault ?? null;
  }
  return organization ?? null;
}

export function effectiveLicenseStatus(
  organization: Organization,
  now = new Date(),
): Organization["status"] {
  if (organization.status === "active" && organization.endsAt && organization.endsAt <= now) {
    return "expired";
  }
  return organization.status;
}

export function licenseAllows(
  organization: Organization | null,
  tenantId: string,
  now = new Date(),
): boolean {
  if (!organization) return tenantId === "default";
  return effectiveLicenseStatus(organization, now) === "active" &&
    (!organization.startsAt || organization.startsAt <= now) &&
    (!organization.endsAt || organization.endsAt > now);
}

export function actorFromStaff(staff: StaffAccount): Actor {
  return {
    id: staff.id,
    tenantId: staff.tenantId,
    name: staff.name,
    role: staff.role,
    position: staff.position,
    developments: staff.developments,
    sessionVersion: staff.sessionVersion,
  };
}

export function signAccessToken(actor: Actor): string {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    ...actor,
    iat: now,
    exp: now + ACCESS_TTL_SECONDS,
    typ: "access",
  } satisfies AccessPayload);
  const input = `${header}.${payload}`;
  return `${input}.${signature(input)}`;
}

export function issueProcurementChallenge(staff: StaffAccount) {
  const now = Math.floor(Date.now() / 1000);
  const challengeCode = randomInt(0, 100).toString().padStart(2, "0");
  const payload: ProcurementChallengePayload = {
    staffId: staff.id,
    tenantId: staff.tenantId,
    challengeCode,
    iat: now,
    exp: now + 5 * 60,
    typ: "procurement_challenge",
  };
  const encodedPayload = encode(payload);
  return {
    challengeCode,
    challengeToken: `${encodedPayload}.${signature(encodedPayload)}`,
    expiresIn: 5 * 60,
  };
}

export function verifyProcurementChallenge(token: string): ProcurementChallengePayload {
  const [payload, received, ...extra] = token.split(".");
  if (!payload || !received || extra.length) throw new Error("Malformed procurement challenge");
  const expected = Buffer.from(signature(payload));
  const actual = Buffer.from(received);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("Invalid procurement challenge");
  }
  const parsed = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  ) as ProcurementChallengePayload;
  if (parsed.typ !== "procurement_challenge" || parsed.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("Expired procurement challenge");
  }
  return parsed;
}

export function verifyAccessToken(token: string): AccessPayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed access token");
  const [header, payload, received] = parts as [string, string, string];
  const parsedHeader = decodeHeader(header);
  if (parsedHeader.alg !== "HS256" || parsedHeader.typ !== "JWT") throw new Error("Invalid access token header");
  const input = `${header}.${payload}`;
  const expected = Buffer.from(signature(input));
  const actual = Buffer.from(received);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("Invalid access token");
  }
  const parsed = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  ) as AccessPayload;
  if (parsed.typ !== "access" || parsed.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("Expired access token");
  }
  return parsed;
}

export async function issueSession(staff: StaffAccount) {
  const refreshToken = randomBytes(48).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  await db.insert(refreshSessions).values({
    id: randomUUID(),
    staffId: staff.id,
    tokenHash: tokenHash(refreshToken),
    expiresAt,
    createdAt: now,
    updatedAt: now,
  });
  return {
    accessToken: signAccessToken(actorFromStaff(staff)),
    refreshToken,
    expiresIn: ACCESS_TTL_SECONDS,
  };
}

/**
 * One-time sign-in code for opening fiarep.com from the app. It is a
 * refresh session that expires in 90 seconds; the website redeems it through
 * the normal /v1/auth/refresh, which revokes it on first use (single-use) and
 * issues the browser its own full session.
 */
export const WEB_HANDOFF_TTL_SECONDS = 90;
export async function issueWebHandoff(staff: StaffAccount) {
  const code = randomBytes(32).toString("base64url");
  const now = new Date();
  await db.insert(refreshSessions).values({
    id: randomUUID(),
    staffId: staff.id,
    tokenHash: tokenHash(code),
    expiresAt: new Date(now.getTime() + WEB_HANDOFF_TTL_SECONDS * 1000),
    createdAt: now,
    updatedAt: now,
  });
  return { code, expiresIn: WEB_HANDOFF_TTL_SECONDS };
}

export async function rotateSession(refreshToken: string) {
  const now = new Date();
  const [session] = await db
    .select()
    .from(refreshSessions)
    .where(
      and(
        eq(refreshSessions.tokenHash, tokenHash(refreshToken)),
        isNull(refreshSessions.revokedAt),
        gt(refreshSessions.expiresAt, now),
      ),
    )
    .limit(1);
  if (!session) return null;

  const [staff] = await db
    .select()
    .from(staffAccounts)
    .where(eq(staffAccounts.id, session.staffId))
    .limit(1);
  if (!staff || staff.status !== "approved" || !licenseAllows(await evaluateLicense(staff.tenantId), staff.tenantId)) return null;

  const [claimed] = await db
    .update(refreshSessions)
    .set({ revokedAt: now, updatedAt: now })
    .where(and(eq(refreshSessions.id, session.id), isNull(refreshSessions.revokedAt)))
    .returning();
  if (!claimed) return null;
  return { staff, ...(await issueSession(staff)) };
}

export async function revokeRefreshToken(refreshToken: string) {
  const now = new Date();
  await db
    .update(refreshSessions)
    .set({ revokedAt: now, updatedAt: now })
    .where(eq(refreshSessions.tokenHash, tokenHash(refreshToken)));
}

export async function loadCurrentActor(payload: AccessPayload) {
  const [staff] = await db
    .select()
    .from(staffAccounts)
    .where(
      and(
        eq(staffAccounts.id, payload.id),
        eq(staffAccounts.tenantId, payload.tenantId),
      ),
    )
    .limit(1);
  if (
    !staff ||
    staff.status !== "approved" ||
    staff.sessionVersion !== payload.sessionVersion
  ) {
    return null;
  }
  if (!licenseAllows(await evaluateLicense(staff.tenantId), staff.tenantId)) return null;
  return { staff, actor: actorFromStaff(staff) };
}

export function signPlatformOwnerToken(sessionId: string, name: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({ name, sessionId, iat: now, exp: now + 900, typ: "platform_owner" });
  const input = `${header}.${payload}`;
  return `${input}.${signature(input)}`;
}

export function verifyPlatformOwnerToken(token: string): PlatformOwner {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed platform owner token");
  const [header, payload, received] = parts as [string, string, string];
  const parsedHeader = decodeHeader(header);
  if (parsedHeader.alg !== "HS256" || parsedHeader.typ !== "JWT") throw new Error("Invalid platform owner token header");
  const expected = Buffer.from(signature(`${header}.${payload}`));
  const actual = Buffer.from(received);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error("Invalid platform owner token");
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as PlatformOwner;
  if (parsed.typ !== "platform_owner" || parsed.exp <= Math.floor(Date.now() / 1000)) throw new Error("Expired platform owner token");
  return parsed;
}

export async function issuePlatformOwnerSession(name: string) {
  const refreshToken = randomBytes(48).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  const [session] = await db.insert(platformOwnerSessions).values({
    id: randomUUID(), ownerName: name, tokenHash: tokenHash(refreshToken), expiresAt, createdAt: now, updatedAt: now,
  }).returning();
  if (!session) throw new Error("Unable to create owner session");
  return { accessToken: signPlatformOwnerToken(session.id, name), refreshToken, expiresIn: ACCESS_TTL_SECONDS, ownerName: name };
}

export async function rotatePlatformOwnerSession(refreshToken: string) {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(platformOwnerSessions).where(and(
      eq(platformOwnerSessions.tokenHash, tokenHash(refreshToken)),
      isNull(platformOwnerSessions.revokedAt),
      gt(platformOwnerSessions.expiresAt, now),
    )).limit(1);
    if (!session) return null;
    const [claimed] = await tx.update(platformOwnerSessions).set({ revokedAt: now, updatedAt: now })
      .where(and(eq(platformOwnerSessions.id, session.id), isNull(platformOwnerSessions.revokedAt))).returning();
    if (!claimed) return null;
    const replacement = randomBytes(48).toString("base64url");
    const [next] = await tx.insert(platformOwnerSessions).values({
      id: randomUUID(), ownerName: session.ownerName, tokenHash: tokenHash(replacement),
      expiresAt: session.expiresAt, createdAt: now, updatedAt: now,
    }).returning();
    if (!next) return null;
    return { accessToken: signPlatformOwnerToken(next.id, session.ownerName), refreshToken: replacement, expiresIn: ACCESS_TTL_SECONDS, ownerName: session.ownerName };
  });
}

export async function revokePlatformOwnerSession(refreshToken: string) {
  await db.update(platformOwnerSessions).set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(eq(platformOwnerSessions.tokenHash, tokenHash(refreshToken)));
}

export async function loadPlatformOwnerSession(payload: PlatformOwner) {
  const [session] = await db.select().from(platformOwnerSessions).where(and(
    eq(platformOwnerSessions.id, payload.sessionId),
    eq(platformOwnerSessions.ownerName, payload.name),
    isNull(platformOwnerSessions.revokedAt),
    gt(platformOwnerSessions.expiresAt, new Date()),
  )).limit(1);
  return session ?? null;
}

export function platformOwnerCredentialsMatch(name: string, code: string): boolean {
  const expectedName = process.env["FIAREP_PLATFORM_OWNER_NAME"] ?? "";
  const expectedCode = process.env["FIAREP_PLATFORM_OWNER_CODE"] ?? "";
  const a = Buffer.from(name);
  const b = Buffer.from(expectedName);
  const c = Buffer.from(code);
  const d = Buffer.from(expectedCode);
  return a.length === b.length && c.length === d.length && timingSafeEqual(a, b) && timingSafeEqual(c, d);
}