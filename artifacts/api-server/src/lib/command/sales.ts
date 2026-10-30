// Command Center sales: "XYZ has 475 units — what would the platform cost, and the plan?"
// Prices come only from the owner's pricing ladder (Platform Control → Pricing ladder)
// and the pilot prices; a band with no rate typed in has no price. A contract is the
// same document Platform Control's contract builder makes, saved as a Command Center
// report so it can be opened, printed and attached to an email.
import { and, eq } from "drizzle-orm";
import { db, entityRecords } from "@workspace/db";
import { bandFor, bandHours, SETUP_FEE, type Band } from "../contracts/ladder";
import { PLAN, EXPEDITER } from "../contracts/plans";
import { setBands } from "../contracts/bands";
import { buildContractHtml, contractNumber, monthlyFee, type ContractInput } from "../contracts/contract";
import { getPilotPrices } from "../pilot";
import { saveReport } from "./scopes";

export async function savedBands(): Promise<Band[] | null> {
  const [row] = await db.select().from(entityRecords).where(and(eq(entityRecords.id, "pricing-overrides"), eq(entityRecords.entity, "pricing-overrides"))).limit(1);
  const b = (row?.state as { bands?: unknown } | undefined)?.bands;
  return Array.isArray(b) ? (b as Band[]) : null;
}

const money = (n: number) => Math.round(n * 100) / 100;

export async function quotePlans(units: number) {
  if (!Number.isFinite(units) || units < 1 || units > 1_000_000) return { error: "Give the number of units (1 or more)." };
  const u = Math.round(units);
  const band = bandFor(u, setBands(await savedBands()));
  const notSet = (what: string) => `The ${what} rate for the ${band.label} units band isn't set yet (Platform Control → Pricing ladder).`;
  const platform = band.platformRate == null ? { notSet: notSet("platform") } : {
    ratePerUnit: band.platformRate, minimum: band.platformMin ?? 0, monthly: money(Math.max(u * band.platformRate, band.platformMin ?? 0)),
    setupFee: PLAN.platform.setup, setupNote: `Setup ($${SETUP_FEE}) waived on any annual contract; pay a year up front and get 2 months free.`,
  };
  const hours = bandHours(band);
  const plan = band.planRate == null ? { notSet: notSet("FIAREP plan") } : {
    ratePerUnit: band.planRate, minimum: band.planMin ?? 0, monthly: money(Math.max(u * band.planRate, band.planMin ?? 0)),
    laborHoursPerYear: hours == null ? null : Math.round(hours * u), materials: "Appliances, parts and materials at cost + 10% handling",
  };
  const pilot = await getPilotPrices();
  return {
    units: u, band: band.label, platform, plan,
    pilot: { "60 days": pilot["60"], "90 days": pilot["90"], "1 year": pilot["365"], refundPercentIfTheyDontBuy: pilot.refundPercent },
    hpdCure: { noPlan: EXPEDITER.perApartment, onPlanOrPlatform: EXPEDITER.perApartmentPlan },
    source: "Platform Control → Pricing ladder (monthly = the greater of units × rate and the band minimum)",
  };
}

export type ContractRequest = {
  kind: "fiarep" | "platform"; company: string; contact: string; title?: string; email?: string; phone?: string; address?: string;
  units: number; buildings?: Array<{ name?: string; address?: string; units?: number }>; startDate?: string; termMonths?: number; pilot?: boolean; notes?: string;
};

export async function createContract(tenantId: string, r: ContractRequest, by: string, runId?: string) {
  const units = Math.round(Number(r.units));
  if (!r.company?.trim() || !r.contact?.trim()) return { error: "I need the company name and who signs for them." };
  if (!Number.isFinite(units) || units < 1) return { error: "Give the number of units." };
  const iso = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }));
  setBands(await savedBands());
  const c: ContractInput = {
    kind: r.kind === "platform" ? "platform" : "fiarep", number: contractNumber(), date: iso(), fiarepSigner: "Tim Winn, Managing Member", fiarepEntity: "Grivvy Com LLC d/b/a FIAREP",
    client: { company: r.company.trim(), contact: r.contact.trim(), title: r.title?.trim() ?? "", address: r.address?.trim() ?? "", email: r.email?.trim() ?? "", phone: r.phone?.trim() ?? "" },
    buildings: (r.buildings ?? []).slice(0, 200).map((b) => ({ name: String(b.name ?? "").slice(0, 120), address: String(b.address ?? "").slice(0, 200), units: Math.max(0, Math.round(Number(b.units) || 0)) })),
    units, flatFee: 0, pilot: r.pilot === true, startDate: iso(r.startDate), termMonths: Math.min(Math.max(Math.round(Number(r.termMonths) || 12), 1), 120),
    scope: [], engineering: null, expediter: null, notes: String(r.notes ?? "").slice(0, 4000),
  };
  const fee = monthlyFee(c);
  if (!fee.monthly) return { error: `${fee.basis}. Set it there, then ask again.` };
  const html = buildContractHtml(c);
  const saved = await saveReport(tenantId, `Contract ${c.number} — ${c.client.company}`, html, by, runId).catch(() => null);
  if (!saved) return { error: "The contract couldn't be saved." };
  return { title: saved.title, number: c.number, kind: c.kind, monthly: fee.monthly, basis: fee.basis, setupFee: fee.setup, pilot: c.pilot, startDate: c.startDate, termMonths: c.termMonths };
}
