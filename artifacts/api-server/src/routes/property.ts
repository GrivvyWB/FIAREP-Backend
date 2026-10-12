import { Router, type IRouter } from "express";
import {
  LookupNycPropertyQueryParams,
  LookupNycPropertyResponse,
} from "@workspace/api-zod";
import { requireAuth, requirePlatformOwner } from "../middlewares/auth";
import { lookupNycPropertyData } from "../lib/nycProperty";
import { lookupDofCharges } from "../lib/dofCharges";
import { rateLimit } from "../lib/rateLimit";

const router: IRouter = Router();

// ── Public (used on the Join page): what a building owes the City ──
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

// ═══════════════════════════════════════════════════════════════════
// Platform Control: address autocomplete for registering a client's
// buildings. The register itself lives on
// /v1/platform/organizations/:organizationId/properties (organizations.ts),
// which holds the property limit, the licensed-unit check and the
// configuredDevelopments bookkeeping.
// ═══════════════════════════════════════════════════════════════════

const GEOSEARCH_AUTOCOMPLETE = "https://geosearch.planninglabs.nyc/v2/autocomplete";

router.get("/v1/platform/properties/address-suggest", requirePlatformOwner, rateLimit("address-suggest", 60), async (req, res): Promise<void> => {
  const q = String(req.query["q"] ?? "").trim();
  if (q.length < 3) { res.json([]); return; }
  try {
    const url = new URL(GEOSEARCH_AUTOCOMPLETE);
    url.searchParams.set("text", q);
    const response = await fetch(url.toString(), {
      headers: { accept: "application/json", "user-agent": "FIAREP/1.0" },
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) { res.json([]); return; }
    const data = (await response.json()) as { features?: Array<{ properties?: Record<string, unknown> }> };
    const suggestions = (data.features || [])
      .filter((f) => f.properties?.housenumber && f.properties?.street)
      .slice(0, 8)
      .map((f) => {
        const p = f.properties!;
        return {
          address: `${p.housenumber} ${p.street}`,
          borough: String(p.borough ?? ""),
          label: String(p.label ?? `${p.housenumber} ${p.street}`),
        };
      });
    res.json(suggestions);
  } catch {
    res.json([]);
  }
});

export default router;
