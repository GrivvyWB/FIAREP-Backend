import { Router, type IRouter } from "express";
import {
  LookupNycPropertyQueryParams,
  LookupNycPropertyResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { lookupNycPropertyData } from "../lib/nycProperty";
import { lookupDofCharges } from "../lib/dofCharges";
import { rateLimit } from "../lib/rateLimit";

const router: IRouter = Router();

// Public (used on the Join page): what a building owes the City, by address → block & lot.
router.get("/v1/public/dof-charges", rateLimit("dof-charges", 30), async (req, res): Promise<void> => {
  const address = String(req.query["address"] ?? "").trim().slice(0, 200);
  res.setHeader("Cache-Control", "no-store");
  if (address.length < 4) { res.status(400).json({ error: "Enter a building address." }); return; }
  try {
    const result = await lookupDofCharges(address);
    if (!result) { res.status(404).json({ error: "That address could not be matched to an NYC property." }); return; }
    res.json(result);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "NYC Open Data is temporarily unavailable." });
  }
});

router.get("/v1/property/nyc-lookup", requireAuth, async (req, res): Promise<void> => {
  const parsed = LookupNycPropertyQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid NYC street address." });
    return;
  }
  try {
    const result = await lookupNycPropertyData(parsed.data.address, parsed.data.limit);
    if (!result) {
      res.status(404).json({ error: "That address could not be matched to an NYC property." });
      return;
    }
    res.json(LookupNycPropertyResponse.parse(result));
  } catch (error) {
    req.log.warn(
      { error: error instanceof Error ? error.message : String(error) },
      "NYC property lookup failed",
    );
    res.status(502).json({ error: "NYC property records are temporarily unavailable." });
  }
});

export default router;