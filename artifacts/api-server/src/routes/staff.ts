import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, asc, eq, sql, count } from "drizzle-orm";
import { db, entityRecords, staffAccounts, organizations, organizationProperties } from "@workspace/db";
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

function safe(
  staff: typeof staffAccounts.$inferSelect,
  includeCode = false,
  actor?: ReturnType<typeof actorFrom>,
) {
  const { sessionVersion: _version, ...data } = staff;
  const permissions = actor
    ? {
        canManage: canManageStaff(actor, staff),
        canResetCode: canManageStaff(actor, staff),
        canRevoke: canManageStaff(actor, staff) && staff.status !== "revoked",
      }
    : {};
  if (includeCode) return data;
  const { code: _code, ...withoutCode } = data;
  return { ...withoutCode, ...permissions };
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
  if (target.position === "Borough Director" || target.role === "administrator") {
    return false;
  }
  if (!developmentsWithinScope(actor, target.developments)) return false;
  if (actor.role === "administrator") return true;
  if (actor.role !== "management") return false;
  if (target.role === "management") {
    return actor.position === "Regional Director";
  }
  return ["worker", "inspector", "emergency"].includes(target.role);
}

function canIssueStaff(
  actor: ReturnType<typeof actorFrom>,
  role: string,
  position: string,
  developments: string[],
) {
  // Resident is a supported domain/directory role, but can never be issued
  // through employee management.
  if (role === "resident") return false;
  if (position === "Borough Director" && !isBoroughDirector(actor)) return false;
  if (!developmentsWithinScope(actor, developments)) return false;
  if (isBoroughDirector(actor)) return true;
  if (actor.role === "administrator") {
    return role !== "administrator";
  }
  if (actor.role !== "management") return false;
  if (role === "management") return actor.position === "Regional Director";
  return ["worker", "inspector", "emergency"].includes(role);
}

export function scopedDevelopmentNames(
  values: Array<string | null | undefined>,
  actor: ReturnType<typeof actorFrom>,
) {
  const names = [...new Set(values.filter((value): value is string =>
    typeof value === "string" && value.trim().length > 0,
  ).map((value) => value.trim()))].sort((a, b) => a.localeCompare(b));
  if (isBoroughDirector(actor)) return names;
  const allowed = new Set(actor.developments);
  return names.filter((name) => allowed.has(name));
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
  res.json(rows.map((row) => safe(row, false, actor)));
});

router.get("/v1/staff/developments", async (_req, res) => {
  const actor = actorFrom(res);
  const [propertyRows, staffRows, recordRows] = await Promise.all([
    db
      .select({ development: organizationProperties.development })
      .from(organizationProperties)
      .where(and(
        eq(organizationProperties.organizationId, actor.tenantId),
        eq(organizationProperties.active, true),
      )),
    db
      .select({ developments: staffAccounts.developments })
      .from(staffAccounts)
      .where(eq(staffAccounts.tenantId, actor.tenantId)),
    db
      .select({ development: entityRecords.development })
      .from(entityRecords)
      .where(and(
        eq(entityRecords.tenantId, actor.tenantId),
        eq(entityRecords.deleted, false),
      )),
  ]);
  res.json(scopedDevelopmentNames([
    ...propertyRows.map((row) => row.development),
    ...staffRows.flatMap((row) => row.developments),
    ...recordRows.map((row) => row.development),
  ], actor));
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
  const canIssue = canIssueStaff(actor, role, position, developments);
  if (!canIssue) {
    res.status(403).json({ error: "Not allowed to issue this account" });
    return;
  }
  const [organization] = await db.select({ staffLimit: organizations.staffLimit }).from(organizations).where(eq(organizations.id, actor.tenantId)).limit(1);
  const suppliedCode =
    typeof input["code"] === "string" ? input["code"].toUpperCase() : undefined;
  if (suppliedCode && !/^[A-Z0-9]{4}$/.test(suppliedCode)) {
    res.status(400).json({ error: "Code must be exactly 4 letters or numbers" });
    return;
  }
  if (suppliedCode) {
    const [existing] = await db
      .select()
      .from(staffAccounts)
      .where(
        and(
          eq(staffAccounts.tenantId, actor.tenantId),
          sql`lower(${staffAccounts.name}) = lower(${name})`,
          eq(staffAccounts.code, suppliedCode),
        ),
      )
      .limit(1);
      if (existing) {
       res.json(safe(existing, true, actor));
      return;
    }
  }
  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`staff-limit:${actor.tenantId}`}))`);
    if (organization?.staffLimit !== null && organization?.staffLimit !== undefined) {
      const [{ value }] = await tx.select({ value: count() }).from(staffAccounts).where(eq(staffAccounts.tenantId, actor.tenantId));
      if (Number(value) >= organization.staffLimit) throw Object.assign(new Error("Organization staff license limit reached"), { status: 403 });
    }
    const now = new Date();
    const [row] = await tx
      .insert(staffAccounts)
      .values({
       id: randomUUID(),
      tenantId: actor.tenantId,
      name,
      firstName:
        typeof input["firstName"] === "string" ? input["firstName"] : null,
      lastName:
        typeof input["lastName"] === "string" ? input["lastName"] : null,
      role,
      position,
      code: suppliedCode ?? staffCode(),
       status: "approved",
      developments,
      createdBy: actor.id,
      issuerName: actor.name,
      createdAt: now,
      updatedAt: now,
      })
      .returning();
    return row;
  }).catch((error: any) => {
    if (error?.status) { res.status(error.status).json({ error: error.message }); return null; }
    throw error;
  });
  if (!created) return;
  await audit(actor, "staff.created", `Issued account for ${name}`, created?.id);
  res.status(201).json(safe(created!, true, actor));
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
  res.json(safe(updated, true, actor));
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
  res.json(safe(updated, false, actor));
});

export default router;