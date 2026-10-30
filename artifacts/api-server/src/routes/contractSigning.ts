// Contracts: the owner's saved signature (Platform Control) and the client's signing page (public link).
import { Router, type IRouter } from "express";
import { requirePlatformOwner } from "../middlewares/auth";
import { rateLimit } from "../lib/rateLimit";
import { clientSigns, ownerSignature, saveOwnerSignature, signedForAutopay, signingView } from "../lib/contracts/signing";
import { autopayList, enroll, enrolledFor, setAutopayOn, squareConfig, squareReady } from "../lib/billing";
import { notify } from "../lib/audit";
import type { Actor } from "../lib/auth";

const router: IRouter = Router();
const s = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");

router.get("/v1/platform/signature", requirePlatformOwner, async (_req, res) => {
  const sig = await ownerSignature();
  res.json(sig ? { saved: true, name: sig.name, image: sig.image, savedAt: sig.savedAt } : { saved: false });
});
router.put("/v1/platform/signature", requirePlatformOwner, async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const r = await saveOwnerSignature(s(b["image"], 400_000), s(b["name"], 120));
  if ("error" in r) { res.status(400).json(r); return; }
  res.json({ saved: true, name: r.name, image: r.image, savedAt: r.savedAt });
});

router.get("/v1/public/contracts/:id", rateLimit("contract-view", 60), async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const v = await signingView(s(req.params["id"], 60), s(req.query["t"], 100));
  if (!v) { res.status(404).json({ error: "This signing link isn't valid." }); return; }
  res.json(v);
});
router.post("/v1/public/contracts/:id/sign", rateLimit("contract-sign", 10), async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const b = (req.body ?? {}) as Record<string, unknown>;
  const r = await clientSigns(s(req.params["id"], 60), s(b["t"], 100), {
    name: s(b["name"], 120), image: s(b["image"], 400_000), agree: b["agree"] === true,
    ip: String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0]!.trim(), userAgent: String(req.headers["user-agent"] ?? ""),
  });
  if ("error" in r) { res.status(400).json(r); return; }
  // FIAREP's administrators hear about it on their phones.
  const system = { id: "contract-signing", tenantId: "default", name: "Contract signing", role: "administrator", position: "", developments: [], sessionVersion: 0 } as Actor;
  await notify(system, "administrator", `Contract signed: ${r.company}`, `Agreement ${r.number} signed — the signed copy is in FIAREP's mailbox.`).catch(() => undefined);
  res.json(r);
});

// Platform Control: create a client's contract and send it to sign (a monthly fee typed here, e.g. a $1 test, replaces the ladder price).
router.post("/v1/platform/contracts/send", requirePlatformOwner, async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const { clientContract } = await import("../lib/command/siteControl");
  const owner = res.locals["platformOwner"] as { name: string };
  const r = await clientContract({ client: s(b["client"], 120), kind: s(b["kind"], 10) || undefined, email: s(b["email"], 200) || undefined, contact: s(b["contact"], 120) || undefined, monthly: Number(b["monthly"]) || undefined, units: Number(b["units"]) || undefined }, owner.name);
  if ("error" in r && !("signingLink" in r)) { res.status(400).json(r); return; }
  res.json(r);
});

// ── Monthly autopay (Square) ──
router.get("/v1/public/contracts/:id/autopay", rateLimit("autopay-view", 60), async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const sg = await signedForAutopay(s(req.params["id"], 60), s(req.query["t"], 100));
  if (!sg) { res.json({ available: false }); return; }
  const c = squareConfig();
  res.json({ available: squareReady(), appId: c.appId, locationId: c.locationId, sdk: c.sdk, monthly: sg.monthly, enrolled: await enrolledFor(sg.id) });
});
router.post("/v1/public/contracts/:id/autopay", rateLimit("autopay-enroll", 6), async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const b = (req.body ?? {}) as Record<string, unknown>;
  const sg = await signedForAutopay(s(req.params["id"], 60), s(b["t"], 100));
  if (!sg) { res.status(400).json({ error: "Sign the agreement first." }); return; }
  const r = await enroll(sg, s(b["sourceId"], 500));
  if ("error" in r && !("enrolled" in r)) { res.status(400).json(r); return; }
  res.json(r);
});
router.get("/v1/platform/billing", requirePlatformOwner, async (_req, res) => {
  res.json({ ready: squareReady(), sandbox: squareConfig().sandbox, clients: await autopayList() });
});
router.put("/v1/platform/billing/:id", requirePlatformOwner, async (req, res) => {
  const r = await setAutopayOn(s(req.params["id"], 80), (req.body as Record<string, unknown> | undefined)?.["on"] === true);
  if ("error" in r) { res.status(404).json(r); return; }
  res.json({ ready: squareReady(), sandbox: squareConfig().sandbox, clients: await autopayList() });
});

export default router;
