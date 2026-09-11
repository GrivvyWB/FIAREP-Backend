import { Router, type IRouter } from "express";
import {
  LookupNycPropertyQueryParams,
  LookupNycPropertyResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { lookupNycPropertyData } from "../lib/nycProperty";

const router: IRouter = Router();

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