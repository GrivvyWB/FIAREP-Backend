// Contracts: the owner's saved signature (Platform Control) and the client's signing page (public link).
import { Router, type IRouter } from "express";
import { requirePlatformOwner } from "../middlewares/auth";
import { rateLimit } from "../lib/rateLimit";
import { clientSigns, ownerSignature, saveOwnerSignature, signingView } from "../lib/contracts/signing";
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

export default router;
