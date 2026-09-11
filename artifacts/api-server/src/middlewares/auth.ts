import type { NextFunction, Request, Response } from "express";
import { loadCurrentActor, verifyAccessToken, verifyPlatformOwnerToken, type Actor } from "../lib/auth";

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
    res.locals["actor"] = current.actor;
    res.locals["staff"] = current.staff;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired access token" });
  }
}

export function requirePlatformOwner(req: Request, res: Response, next: NextFunction) {
  try {
    const authorization = req.header("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Platform owner authentication required" });
      return;
    }
    res.locals["platformOwner"] = verifyPlatformOwnerToken(authorization.slice(7));
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired platform owner token" });
  }
}

export function actorFrom(res: Response): Actor {
  return res.locals["actor"] as Actor;
}