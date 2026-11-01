// From the moment a job is assigned: the member's phone (staff or freelance — no time clock needed)
// watches for the job's address and the arrival is marked by GPS, time stamped.
import { Router, type IRouter } from "express";
import { actorFrom, requireAuth } from "../middlewares/auth";
import { autoArrivals, jobsToWatch } from "../lib/complaintReceipts";

const router: IRouter = Router();
router.use("/v1/jobs", requireAuth);

router.get("/v1/jobs/tracking", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ jobs: await jobsToWatch(actorFrom(res)).catch(() => []) });
});

router.post("/v1/jobs/track", async (req, res) => {
  const actor = actorFrom(res);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const latitude = Number(b["latitude"]), longitude = Number(b["longitude"]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) { res.status(400).json({ error: "latitude and longitude are required" }); return; }
  const arrived = await autoArrivals(actor, { latitude, longitude, address: typeof b["address"] === "string" ? b["address"].slice(0, 300) : null, at: new Date() }).catch(() => 0);
  res.setHeader("Cache-Control", "no-store");
  res.json({ arrived, remaining: (await jobsToWatch(actor).catch(() => [])).length });
});

export default router;
