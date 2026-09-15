import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, staffAccounts } from "@workspace/db";
import {
  issueSession,
  revokeRefreshToken,
  rotateSession,
  licenseAllows,
  evaluateLicense,
  platformOwnerCredentialsMatch,
  issuePlatformOwnerSession,
  rotatePlatformOwnerSession,
  revokePlatformOwnerSession,
  issueProcurementChallenge,
  verifyProcurementChallenge,
} from "../lib/auth";
import { requireAuth, requirePlatformOwner } from "../middlewares/auth";
import { rateLimit } from "../lib/rateLimit";
import { canUseGeneralStaffLogin } from "../lib/domain";

const router: IRouter = Router();

function publicStaff(staff: typeof staffAccounts.$inferSelect) {
  const { code: _code, sessionVersion: _version, ...safe } =
    staff;
  return safe;
}

router.post("/v1/auth/bootstrap", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const tenantId =
    typeof body["tenantId"] === "string" && body["tenantId"].trim()
      ? body["tenantId"].trim()
      : "default";
  if (tenantId !== "default") {
    res.status(403).json({ error: "Only the default organization may use public bootstrap" });
    return;
  }
  const name = typeof body["name"] === "string" ? body["name"].trim() : "";
  const code =
    typeof body["code"] === "string" ? body["code"].trim().toUpperCase() : "";
  if (!name || !/^[A-HJ-NP-Z2-9]{4}$/.test(code)) {
    res.status(400).json({
      error: "Name and a valid 4-digit access code are required",
    });
    return;
  }
  const [existing] = await db
    .select({ id: staffAccounts.id })
    .from(staffAccounts)
    .where(
      and(
        eq(staffAccounts.tenantId, tenantId),
        eq(staffAccounts.role, "administrator"),
      ),
    )
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "An administrator already exists" });
    return;
  }
  const [staff] = await db
    .insert(staffAccounts)
    .values({
      id: randomUUID(),
      tenantId,
      name,
      firstName:
        typeof body["firstName"] === "string" ? body["firstName"] : null,
      lastName:
        typeof body["lastName"] === "string" ? body["lastName"] : null,
      code,
      role: "administrator",
      position: "Borough Director",
      status: "approved",
      developments: [],
      issuerName: "System bootstrap",
    })
    .returning();
  res.status(201).json({
    ...(await issueSession(staff!)),
    staff: publicStaff(staff!),
  });
});

router.get("/v1/auth/bootstrap-status", async (_req, res) => {
  const [existing] = await db
    .select({ id: staffAccounts.id })
    .from(staffAccounts)
    .where(
      and(
        eq(staffAccounts.tenantId, "default"),
        eq(staffAccounts.role, "administrator"),
      ),
    )
    .limit(1);
  res.json({ hasAdministrator: Boolean(existing) });
});

router.post("/v1/auth/login", rateLimit("owner-login", 12), async (req, res) => {
  const { name, code, role, organizationId } = req.body as {
    name?: unknown;
    code?: unknown;
    role?: unknown;
    organizationId?: unknown;
  };
  if (typeof name !== "string" || typeof code !== "string") {
    res.status(400).json({ error: "name and code are required" });
    return;
  }
  const conditions = [
    sql`lower(${staffAccounts.name}) = lower(${name.trim()})`,
    eq(staffAccounts.code, code.trim().toUpperCase()),
    eq(staffAccounts.status, "approved"),
  ];
  const tenantId = typeof organizationId === "string" && organizationId.trim() ? organizationId.trim() : null;
  if (tenantId) conditions.push(eq(staffAccounts.tenantId, tenantId));
  if (typeof role === "string") conditions.push(eq(staffAccounts.role, role));
  const matches = await db
    .select()
    .from(staffAccounts)
    .where(and(...conditions))
    .limit(2);
  if (matches.length !== 1) {
    res.status(401).json({ error: "Invalid staff name or code" });
    return;
  }
  const staff = matches[0]!;
  if (!canUseGeneralStaffLogin(staff.role)) {
    res.status(401).json({ error: "Invalid staff name or code" });
    return;
  }
  if (staff.role === "procurement") {
    if (!licenseAllows(await evaluateLicense(staff.tenantId), staff.tenantId)) {
      res.status(403).json({ error: "Organization license is not active" });
      return;
    }
    res.status(202).json({
      requiresProcurementVerification: true,
      ...issueProcurementChallenge(staff),
    });
    return;
  }
  if (!licenseAllows(await evaluateLicense(staff.tenantId), staff.tenantId)) {
    res.status(403).json({ error: "Organization license is not active" });
    return;
  }
  res.json({ ...(await issueSession(staff)), staff: publicStaff(staff) });
});

router.post("/v1/auth/procurement/login", rateLimit("procurement-login", 12), async (req, res) => {
  const { name, code, challengeCode, challengeToken } = req.body as {
    name?: unknown; code?: unknown; challengeCode?: unknown; challengeToken?: unknown;
  };
  if (typeof name !== "string" || typeof code !== "string" ||
      !/^[A-Z0-9]{4}$/i.test(code.trim()) ||
      typeof challengeCode !== "string" || !/^\d{2}$/.test(challengeCode) ||
      typeof challengeToken !== "string") {
    res.status(400).json({ error: "Procurement credentials and verification number are required" });
    return;
  }
  let challenge;
  try {
    challenge = verifyProcurementChallenge(challengeToken);
  } catch {
    res.status(401).json({ error: "Invalid or expired procurement verification" });
    return;
  }
  if (challenge.challengeCode !== challengeCode) {
    res.status(401).json({ error: "Invalid or expired procurement verification" });
    return;
  }
  const [staff] = await db.select().from(staffAccounts).where(and(
    eq(staffAccounts.id, challenge.staffId),
    sql`lower(${staffAccounts.name}) = lower(${name.trim()})`,
    eq(staffAccounts.code, code.trim().toUpperCase()),
    eq(staffAccounts.role, "procurement"),
    eq(staffAccounts.status, "approved"),
    eq(staffAccounts.tenantId, challenge.tenantId),
  )).limit(1);
  if (!staff) {
    res.status(401).json({ error: "Invalid procurement credentials" });
    return;
  }
  if (!licenseAllows(await evaluateLicense(staff.tenantId), staff.tenantId)) {
    res.status(403).json({ error: "Organization license is not active" });
    return;
  }
  res.json({ ...(await issueSession(staff)), staff: publicStaff(staff) });
});

router.post("/v1/platform/auth/login", rateLimit("platform-owner-login", 12), async (req, res) => {
  const { name, code } = req.body as { name?: unknown; code?: unknown };
  if (typeof name !== "string" || typeof code !== "string" || !platformOwnerCredentialsMatch(name, code)) {
    res.status(401).json({ error: "Invalid platform owner credentials" });
    return;
  }
  const session = await issuePlatformOwnerSession(name.trim());
  res.setHeader("Set-Cookie", `fiarep_owner_refresh=${encodeURIComponent(session.refreshToken)}; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/platform/auth; Max-Age=2592000`);
  res.json({ accessToken: session.accessToken, expiresIn: session.expiresIn, ownerName: session.ownerName });
});

router.post("/v1/platform/auth/refresh", async (req, res) => {
  const cookie = String(req.headers.cookie ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith("fiarep_owner_refresh="));
  const token = cookie ? decodeURIComponent(cookie.slice("fiarep_owner_refresh=".length)) : undefined;
  if (typeof token !== "string" || !token) { res.status(400).json({ error: "refreshToken is required" }); return; }
  const session = await rotatePlatformOwnerSession(token);
  if (!session) { res.status(401).json({ error: "Invalid or expired platform owner refresh token" }); return; }
  res.setHeader("Set-Cookie", `fiarep_owner_refresh=${encodeURIComponent(session.refreshToken)}; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/platform/auth; Max-Age=2592000`);
  res.json({ accessToken: session.accessToken, expiresIn: session.expiresIn, ownerName: session.ownerName });
});

router.post("/v1/platform/auth/logout", async (req, res) => {
  const cookie = String(req.headers.cookie ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith("fiarep_owner_refresh="));
  const token = cookie ? decodeURIComponent(cookie.slice("fiarep_owner_refresh=".length)) : undefined;
  if (typeof token === "string") await revokePlatformOwnerSession(token);
  res.setHeader("Set-Cookie", "fiarep_owner_refresh=; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/platform/auth; Max-Age=0");
  res.status(204).send();
});

router.get("/v1/platform/auth/me", requirePlatformOwner, (req, res) => {
  res.json(res.locals["platformOwner"]);
});

router.post("/v1/auth/refresh", async (req, res) => {
  const refreshToken = (req.body as { refreshToken?: unknown }).refreshToken;
  if (typeof refreshToken !== "string") {
    res.status(400).json({ error: "refreshToken is required" });
    return;
  }
  const session = await rotateSession(refreshToken);
  if (!session) {
    res.status(401).json({ error: "Invalid or expired refresh token" });
    return;
  }
  res.json({ ...session, staff: publicStaff(session.staff) });
});

router.post("/v1/auth/logout", async (req, res) => {
  const refreshToken = (req.body as { refreshToken?: unknown }).refreshToken;
  if (typeof refreshToken === "string") await revokeRefreshToken(refreshToken);
  res.status(204).send();
});

router.get("/v1/auth/me", requireAuth, (_req, res) => {
  res.json(publicStaff(res.locals["staff"] as typeof staffAccounts.$inferSelect));
});

export default router;