import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, refreshSessions, staffAccounts, type StaffAccount } from "@workspace/db";

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

type AccessPayload = Actor & {
  exp: number;
  iat: number;
  typ: "access";
};

function secret(): string {
  const value = process.env["SESSION_SECRET"];
  if (!value) throw new Error("SESSION_SECRET is required");
  return value;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signature(input: string): string {
  return createHmac("sha256", secret()).update(input).digest("base64url");
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
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

export function verifyAccessToken(token: string): AccessPayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed access token");
  const [header, payload, received] = parts as [string, string, string];
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
  if (!staff || staff.status !== "approved") return null;

  await db
    .update(refreshSessions)
    .set({ revokedAt: now, updatedAt: now })
    .where(eq(refreshSessions.id, session.id));
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
  return { staff, actor: actorFromStaff(staff) };
}