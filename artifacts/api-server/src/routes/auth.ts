import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, staffAccounts } from "@workspace/db";
import {
  issueSession,
  revokeRefreshToken,
  rotateSession,
} from "../lib/auth";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

function publicStaff(staff: typeof staffAccounts.$inferSelect) {
  const { code: _code, sessionVersion: _version, tenantId: _tenant, ...safe } =
    staff;
  return safe;
}

router.post("/v1/auth/bootstrap", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const tenantId =
    typeof body["tenantId"] === "string" && body["tenantId"].trim()
      ? body["tenantId"].trim()
      : "default";
  const name = typeof body["name"] === "string" ? body["name"].trim() : "";
  const code =
    typeof body["code"] === "string" ? body["code"].trim().toUpperCase() : "";
  if (!name || !/^[A-HJ-NP-Z2-9]{4}$/.test(code)) {
    res.status(400).json({
      error: "name and a 4-character code without 0/O/1/I are required",
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

router.post("/v1/auth/login", async (req, res) => {
  const { name, code, role } = req.body as {
    name?: unknown;
    code?: unknown;
    role?: unknown;
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
  if (typeof role === "string") conditions.push(eq(staffAccounts.role, role));
  const [staff] = await db
    .select()
    .from(staffAccounts)
    .where(and(...conditions))
    .limit(1);
  if (!staff) {
    res.status(401).json({ error: "Invalid staff name or code" });
    return;
  }
  res.json({ ...(await issueSession(staff)), staff: publicStaff(staff) });
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