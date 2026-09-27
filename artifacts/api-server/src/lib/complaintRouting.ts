// Keyword routing for resident complaints. Inbox alerts go to the triage
// supervisors (on site + emergency). Matching trade supervisors can READ the
// complaint (see domain.ts) but act only once it is sent to them.
// Original design — a complaint goes to:
//   • the supervisors on site (the development's own supervisors),
//   • the emergency supervisor (Superintendent Ⓔ), and
//   • the trade supervisors whose trade the complaint's words point to
//     ("water" → plumbing, "no power" → electrical, "door" → carpentry …).
// Everyone else is left out of the inbox. A supervisor can still transfer the
// complaint with the existing transfer button.
import { and, eq } from "drizzle-orm";
import { db, staffAccounts } from "@workspace/db";
import { isOfficeTradeSupervisorTitle, supervisedTradeForPosition, sameTitle } from "./titles";
import { tradesForComplaint } from "./complaintTrades";
export { tradesForComplaint, tradesForComplaintText } from "./complaintTrades";

const normalize = (value: string | null | undefined) =>
  (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function isEmergencySupervisor(position: string): boolean {
  const p = normalize(position);
  if (!p.startsWith("superintendent")) return false;
  const marker = p.slice("superintendent".length).trim();
  return ["Ⓔ", "ⓔ", "e", "(e)", "[e]"].includes(marker);
}

// Supervisors who run a development (on site). Development-based trade
// supervisors (inspection, grounds) only get complaints of their own trade.
const ON_SITE_TITLES = new Set([
  "superintendent", "assistant superintendent", "maintenance supervisor",
  "property manager", "assistant property manager",
]);

type StaffRow = typeof staffAccounts.$inferSelect;

function worksDevelopment(account: StaffRow, development: string): boolean {
  const target = normalize(development);
  return !!target && account.developments.some((d) => normalize(d) === target);
}

/**
 * Staff ids that should get a new resident complaint in their inbox.
 * When no trade keyword matches, only the on-site and emergency supervisors
 * get it (they triage and transfer).
 */
export async function routedComplaintRecipientIds(
  tenantId: string,
  development: string,
  state: Record<string, unknown>,
  includeTradeSupervisors = false,
): Promise<string[]> {
  const trades = tradesForComplaint(state);
  const staff = await db.select().from(staffAccounts).where(and(
    eq(staffAccounts.tenantId, tenantId),
    eq(staffAccounts.status, "approved"),
  ));
  const ids = new Set<string>();
  for (const account of staff) {
    const position = account.position || "";
    if (isEmergencySupervisor(position)) { ids.add(account.id); continue; }
    if (account.role !== "management") continue;
    const title = normalize(position);
    const supervisedTrade = supervisedTradeForPosition(position);
    const isOffice = isOfficeTradeSupervisorTitle(position, account.developments);
    // Trade supervisors only READ a matching complaint (no inbox alert) until
    // the development / emergency supervisor or upper management sends it to them.
    if (!includeTradeSupervisors && isOffice) continue;
    // Trade supervisors (plumbing, electrical, carpentry, heating …) whose trade matches.
    if (supervisedTrade && trades.some((trade) => sameTitle(trade, supervisedTrade))) {
      if (isOffice && (account.developments.length === 0 || worksDevelopment(account, development))) {
        ids.add(account.id);
        continue;
      }
      if (!isOffice && worksDevelopment(account, development)) { ids.add(account.id); continue; }
    }
    // The supervisors on site at this development.
    if (ON_SITE_TITLES.has(title) && worksDevelopment(account, development)) ids.add(account.id);
  }
  return [...ids];
}
