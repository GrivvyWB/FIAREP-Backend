import { Router, type IRouter } from "express";
import { and, asc, eq, ilike, or } from "drizzle-orm";
import { db, nychaAddresses, nychaDevelopments } from "@workspace/db";
import {
  ListNychaDevelopmentsResponse,
  SearchNychaAddressesQueryParams,
  SearchNychaAddressesResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/v1/nycha/developments", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: nychaDevelopments.id,
      sequence: nychaDevelopments.sequence,
      name: nychaDevelopments.name,
      program: nychaDevelopments.program,
      borough: nychaDevelopments.borough,
      tds: nychaDevelopments.tds,
    })
    .from(nychaDevelopments)
    .orderBy(asc(nychaDevelopments.sequence));

  res.json(ListNychaDevelopmentsResponse.parse(rows));
});

router.get("/v1/nycha/addresses", async (req, res): Promise<void> => {
  const parsed = SearchNychaAddressesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid address search." });
    return;
  }

  const query = parsed.data.query?.trim().toLowerCase();
  const development = parsed.data.development?.trim().toLowerCase();
  const filters = [
    parsed.data.developmentId
      ? eq(nychaAddresses.developmentId, parsed.data.developmentId)
      : undefined,
    development
      ? eq(nychaDevelopments.normalizedName, development.replace(/\s+/g, " "))
      : undefined,
    query
      ? or(
          ilike(nychaAddresses.normalizedAddress, `%${query}%`),
          ilike(nychaAddresses.zipcode, `${query}%`),
        )
      : undefined,
  ].filter((value) => value !== undefined);

  const rows = await db
    .select({
      id: nychaAddresses.id,
      developmentId: nychaAddresses.developmentId,
      development: nychaDevelopments.name,
      address: nychaAddresses.address,
      zipcode: nychaAddresses.zipcode,
      borough: nychaAddresses.borough,
      city: nychaAddresses.city,
      state: nychaAddresses.state,
      building: nychaAddresses.building,
      bin: nychaAddresses.bin,
      latitude: nychaAddresses.latitude,
      longitude: nychaAddresses.longitude,
    })
    .from(nychaAddresses)
    .innerJoin(
      nychaDevelopments,
      eq(nychaDevelopments.id, nychaAddresses.developmentId),
    )
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(asc(nychaDevelopments.sequence), asc(nychaAddresses.address))
    .limit(parsed.data.limit);

  res.json(SearchNychaAddressesResponse.parse(rows));
});

export default router;