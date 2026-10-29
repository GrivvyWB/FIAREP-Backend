import { Router, type IRouter } from "express";
import {
  LookupNycPropertyQueryParams,
  LookupNycPropertyResponse,
} from "@workspace/api-zod";
import { requireAuth, requirePlatformOwner } from "../middlewares/auth";
import { lookupNycPropertyData } from "../lib/nycProperty";
import { lookupDofCharges } from "../lib/dofCharges";
import { rateLimit } from "../lib/rateLimit";
import { geocodePlace, suggestAddresses } from "../lib/geocode";

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
      // Outside New York City the address is still found; only the City records are NYC-only.
      const place = await geocodePlace(parsed.data.address).catch(() => null);
      if (place && place.source !== "nyc") {
        res.status(404).json({ error: `Found ${place.label}. City violation records (HPD / DOB) are connected for New York City only; everything else in FIAREP works at this address.`, place });
        return;
      }
      res.status(404).json({ error: "That address could not be matched to a property." });
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

// Any address: New York City (the City's own geocoder, which carries the tax lot),
// the rest of the United States (US Census Bureau), and other countries
// (OpenStreetMap). See lib/geocode.ts.
router.get("/v1/platform/properties/address-suggest", requirePlatformOwner, rateLimit("address-suggest", 60), async (req, res): Promise<void> => {
  const q = String(req.query["q"] ?? "").trim();
  if (q.length < 3) { res.json([]); return; }
  const places = await suggestAddresses(q).catch(() => []);
  res.json(places.map((p) => ({ address: p.address, borough: p.borough, city: p.city, state: p.state, postalCode: p.postalCode, country: p.countryCode === "US" ? "" : p.country, label: p.label })));
});

export default router;
