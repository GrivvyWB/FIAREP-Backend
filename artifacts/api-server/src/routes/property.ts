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
import { CITY_SOURCES, citySwitches, lookupCityRecords, setCitySwitch, type CitySourceId } from "../lib/cityRecords";

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

// ── City records outside New York City (lib/cityRecords.ts) ──
// Any signed-in member: the city's record for an address, when that place is switched on.
router.get("/v1/property/city-records", requireAuth, rateLimit("city-records", 60), async (req, res): Promise<void> => {
  const address = String(req.query["address"] ?? "").trim().slice(0, 200);
  res.setHeader("Cache-Control", "no-store");
  if (address.length < 4) { res.status(400).json({ error: "Enter a building address." }); return; }
  try {
    const r = await lookupCityRecords(address);
    if (!r) { res.status(404).json({ error: "No city records for that address. FIAREP reads New York City, and the places switched on in Platform Control → City Records (Connecticut, Philadelphia, Maryland, Washington DC, Chicago)." }); return; }
    if ("off" in r) { res.status(404).json({ error: `${r.label} records are off. Switch them on in Platform Control → City Records.`, off: r.off }); return; }
    res.json(r);
  } catch (error) {
    req.log.warn({ err: error }, "City records lookup failed");
    res.status(502).json({ error: "The city's records service is not answering right now. Try again." });
  }
});

// Platform Control → City Records: each place's On / Off button.
router.get("/v1/platform/city-records", requirePlatformOwner, async (_req, res): Promise<void> => {
  const on = await citySwitches();
  res.json(CITY_SOURCES.map((x) => ({ ...x, on: on[x.id] })));
});
router.put("/v1/platform/city-records/:id", requirePlatformOwner, async (req, res): Promise<void> => {
  const id = String(req.params["id"]) as CitySourceId;
  if (!CITY_SOURCES.some((x) => x.id === id)) { res.status(404).json({ error: "Unknown place" }); return; }
  await setCitySwitch(id, (req.body as { on?: unknown })?.on === true);
  const on = await citySwitches();
  res.json(CITY_SOURCES.map((x) => ({ ...x, on: on[x.id] })));
});
router.post("/v1/platform/city-records/test", requirePlatformOwner, async (req, res): Promise<void> => {
  const address = String((req.body as { address?: unknown })?.address ?? "").trim().slice(0, 200);
  try { res.json(await lookupCityRecords(address)); } catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : "Lookup failed" }); }
});

export default router;
