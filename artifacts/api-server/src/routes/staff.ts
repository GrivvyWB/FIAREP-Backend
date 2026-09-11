import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, staffAccounts } from "@workspace/db";
import { audit } from "../lib/audit";
import {
  STAFF_POSITIONS,
  STAFF_ROLES,
  isBoroughDirector,
  isElevated,
  staffCode,
} from "../lib/domain";
import { actorFrom, requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
router.use("/v1/staff", requireAuth);

function safe(staff: typeof staffAccounts.$inferSelect, includeCode = false) {
  const { sessionVersion: _version, tenantId: _tenant, ...data } = staff;
  if (includeCode) return data;
  const { code: _code, ...withoutCode } = data;
  return withoutCode;
}

function developmentsWithinScope(
  actor: ReturnType<typeof actorFrom>,
  values: string[],
) {
  return (
    isBoroughDirector(actor) ||
    (actor.developments.length > 0 &&
      values.length > 0 &&
      values.every((value) => actor.developments.includes(value)))
  );
}

function canManageStaff(
  actor: ReturnType<typeof actorFrom>,
  target: Pick<
    typeof staffAccounts.$inferSelect,
    "role" | "position" | "developments"
  >,
) {
  if (isBoroughDirector(actor)) return true;
  if (actor.role !== "administrator") return false;
  if (target.position === "Borough Director" || target.role === "administrator") {
    return false;
  }
  return developmentsWithinScope(actor, target.developments);
}

router.get("/v1/staff", async (req, res) => {
  const actor = actorFrom(res);
  const status =
    typeof req.query["status"] === "string" ? req.query["status"] : undefined;
  const rows = await db
    .select()
    .from(staffAccounts)
    .where(
      status
        ? and(
            eq(staffAccounts.tenantId, actor.tenantId),
            eq(staffAccounts.status, status),
          )
        : eq(staffAccounts.tenantId, actor.tenantId),
    )
    .orderBy(asc(staffAccounts.name));
  res.json(rows.map((row) => safe(row)));
});

router.post("/v1/staff", async (req, res) => {
  const actor = actorFrom(res);
  const input = req.body as Record<string, unknown>;
  const name = typeof input["name"] === "string" ? input["name"].trim() : "";
  const role = typeof input["role"] === "string" ? input["role"] : "";
  const position =
    typeof input["position"] === "string" ? input["position"] : "";
  const developments = Array.isArray(input["developments"])
    ? input["developments"].filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  if (
    !name ||
    !STAFF_ROLES.has(role) ||
    !STAFF_POSITIONS.includes(position as (typeof STAFF_POSITIONS)[number])
  ) {
    res.status(400).json({ error: "Valid name, role, and position are required" });
    return;
  }
  const canIssue =
    isBoroughDirector(actor) ||
    (actor.role === "administrator" &&
      role !== "administrator" &&
      position !== "Borough Director" &&
      developmentsWithinScope(actor, developments)) ||
    (actor.role === "management" &&
      ((actor.position === "Regional Director" && role !== "administrator") ||
        (["worker", "inspector"].includes(role) && isElevated(actor))));
  if (!canIssue) {
    res.status(403).json({ error: "Not allowed to issue this account" });
    return;
  }
  const now = new Date();
  const [created] = await db
    .insert(staffAccounts)
    .values({
      id: typeof input["id"] === "string" ? input["id"] : randomUUID(),
      tenantId: actor.tenantId,
      name,
      firstName:
        typeof input["firstName"] === "string" ? input["firstName"] : null,
      lastName:
        typeof input["lastName"] === "string" ? input["lastName"] : null,
      role,
      position,
      code:
        typeof input["code"] === "string"
          ? input["code"].toUpperCase()
          : staffCode(),
      status:
        typeof input["status"] === "string" ? input["status"] : "approved",
      developments,
      createdBy: actor.id,
      issuerName: actor.name,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  await audit(actor, "staff.created", `Issued account for ${name}`, created?.id);
  res.status(201).json(safe(created!, true));
});

router.post("/v1/staff/:id/reset-code", async (req, res) => {
  const actor = actorFrom(res);
  const [target] = await db
    .select()
    .from(staffAccounts)
    .where(
      and(
        eq(staffAccounts.id, req.params["id"]!),
        eq(staffAccounts.tenantId, actor.tenantId),
      ),
    )
    .limit(1);
  if (!target) {
    res.status(404).json({ error: "Staff account not found" });
    return;
  }
  if (!canManageStaff(actor, target)) {
    res.status(403).json({ error: "Not allowed to manage this staff account" });
    return;
  }
  const code = staffCode();
  const [updated] = await db
    .update(staffAccounts)
    .set({
      code,
      sessionVersion: sql`${staffAccounts.sessionVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(staffAccounts.id, req.params["id"]!),
        eq(staffAccounts.tenantId, actor.tenantId),
      ),
    )
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Staff account not found" });
    return;
  }
  await audit(actor, "staff.code_reset", `Reset code for ${updated.name}`, updated.id);
  res.json(safe(updated, true));
});

router.post("/v1/staff/:id/revoke", async (req, res) => {
  const actor = actorFrom(res);
  const [target] = await db
    .select()
    .from(staffAccounts)
    .where(
      and(
        eq(staffAccounts.id, req.params["id"]!),
        eq(staffAccounts.tenantId, actor.tenantId),
      ),
    )
    .limit(1);
  if (!target) {
    res.status(404).json({ error: "Staff account not found" });
    return;
  }
  if (!canManageStaff(actor, target)) {
    res.status(403).json({ error: "Not allowed to manage this staff account" });
    return;
  }
  const [updated] = await db
    .update(staffAccounts)
    .set({
      status: "revoked",
      sessionVersion: sql`${staffAccounts.sessionVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(staffAccounts.id, req.params["id"]!),
        eq(staffAccounts.tenantId, actor.tenantId),
      ),
    )
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Staff account not found" });
    return;
  }
  await audit(actor, "staff.revoked", `Revoked ${updated.name}`, updated.id);
  res.json(safe(updated));
});

export default router;