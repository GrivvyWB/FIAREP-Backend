import type { Request } from "express";
import type { Actor } from "./auth";
import { isSuperintendentE } from "./domain";

/**
 * Supervisors, managers, directors and administrators act on fiarep.com; on
 * the phone app they are view-only. Field staff (workers, inspectors, CPMs,
 * emergency crews) keep full use of the app. Superintendent Ⓔ is exempt: they
 * respond in the field.
 *
 * Still allowed from the app for these roles: their own time off, attendance
 * (/v1/time-clock), the Inbox (/v1/notifications), and emergency requests to
 * workers (emergency jobs/units, or assigning a complaint to an emergency
 * worker).
 */
export const APP_READ_ONLY_MESSAGE =
  "Supervisors and managers take action on fiarep.com. The app is view-only for your role " +
  "(time off, attendance, Inbox and emergency requests still work).";

/** A request from the FIAREP phone app (iOS/Android native networking), not a browser. */
export function isMobileAppRequest(req: Request): boolean {
  const explicit = String(req.get("x-fiarep-client") || "").trim().toLowerCase();
  if (explicit === "web") return false;
  if (explicit === "mobile") return true;
  const agent = String(req.get("user-agent") || "");
  if (/Mozilla\//.test(agent)) return false;
  return /CFNetwork|Darwin\/|okhttp|Expo|Exponent/i.test(agent);
}

export function isAppReadOnlyActor(actor: Actor): boolean {
  return (actor.role === "management" || actor.role === "administrator") &&
    !isSuperintendentE(actor);
}

export type AppReadOnlyDecision = "allow" | "block" | "emergency-assign-only";

/** method + entity + path below /v1/:entity (e.g. "/", "/<id>", "/<id>/actions/assign"). */
export function appReadOnlyDecision(method: string, entity: string, subPath: string): AppReadOnlyDecision {
  const verb = method.toUpperCase();
  if (verb === "GET" || verb === "HEAD" || verb === "OPTIONS") return "allow";
  if (entity === "emergency-jobs" || entity === "emergency-units") return "allow";
  const path = subPath.replace(/\/+$/, "") || "/";
  if (entity === "leave-requests" && verb === "POST" && path === "/") return "allow";
  if (entity === "resident-reports" && verb === "POST" && /^\/[^/]+\/actions\/assign$/.test(path)) {
    return "emergency-assign-only";
  }
  return "block";
}
