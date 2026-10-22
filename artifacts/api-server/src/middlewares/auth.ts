import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db, organizations } from "@workspace/db";
import { loadCurrentActor, verifyAccessToken, verifyPlatformOwnerToken, loadPlatformOwnerSession, type Actor } from "../lib/auth";

/** HR extras: functions the client's HR person gets on top of HR, switched on per client. */
async function hrExtrasFor(tenantId: string): Promise<string[]> {
  const [org] = await db.select({ features: organizations.features }).from(organizations).where(eq(organizations.id, tenantId)).limit(1);
  const modules = ((org?.features as Record<string, unknown> | null)?.["modules"] ?? {}) as Record<string, unknown>;
  return ["siteCheckins", "calendar", "reports"].filter((k) => modules[`hr.${k}`] === true);
}

export type AuthenticatedLocals = {
  actor: Actor;
};

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const authorization = req.header("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const payload = verifyAccessToken(authorization.slice(7));
    const current = await loadCurrentActor(payload);
    if (!current) {
      res.status(401).json({ error: "Session is no longer valid" });
      return;
    }
    if (current.actor.role === "human_resources") current.actor.hrExtras = await hrExtrasFor(current.actor.tenantId);
    res.locals["actor"] = current.actor;
    res.locals["staff"] = current.staff;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired access token" });
  }
}

export async function requirePlatformOwner(req: Request, res: Response, next: NextFunction) {
  try {
    const authorization = req.header("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Platform owner authentication required" });
      return;
    }
    const payload = verifyPlatformOwnerToken(authorization.slice(7));
    if (!(await loadPlatformOwnerSession(payload))) {
      res.status(401).json({ error: "Platform owner session is no longer valid" });
      return;
    }
    res.locals["platformOwner"] = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired platform owner token" });
  }
}

export function actorFrom(res: Response): Actor {
  return res.locals["actor"] as Actor;
}