import { readFile } from "node:fs/promises";
import { db, nychaAddresses, nychaDevelopments } from "@workspace/db";
import { sql } from "drizzle-orm";

type Catalog = {
  sourceVersion: string;
  developmentCount: number;
  addressCount: number;
  developments: Array<{
    id: string;
    sequence: number;
    name: string;
    program: string;
    borough: string | null;
    tds: string | null;
  }>;
  addresses: Array<{
    id: string;
    developmentId: string;
    address: string;
    normalizedAddress: string;
    zipcode: string;
    borough: string | null;
    city: string | null;
    state: string;
    building: string | null;
    bin: string | null;
    latitude: number | null;
    longitude: number | null;
    source: string;
  }>;
};

export async function ensureNychaCatalog(): Promise<void> {
  const [developmentTotal] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(nychaDevelopments);

  if ((developmentTotal?.count ?? 0) > 0) return;

  const catalog = JSON.parse(
    await readFile(new URL("./nycha-catalog-2026.json", import.meta.url), "utf8"),
  ) as Catalog;

  if (
    catalog.developmentCount !== 335 ||
    catalog.developments.length !== 335 ||
    catalog.addressCount !== catalog.addresses.length
  ) {
    throw new Error("The bundled NYCHA catalog snapshot failed count validation.");
  }

  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('fiarep-nycha-catalog'))`);

    const [currentTotal] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(nychaDevelopments);

    if ((currentTotal?.count ?? 0) > 0) return;

    await tx.insert(nychaDevelopments).values(
      catalog.developments.map((development) => ({
        ...development,
        normalizedName: development.name.toLowerCase().replace(/\s+/g, " ").trim(),
        sourceVersion: catalog.sourceVersion,
        createdAt: now,
        updatedAt: now,
      })),
    );

    for (let offset = 0; offset < catalog.addresses.length; offset += 250) {
      await tx.insert(nychaAddresses).values(
        catalog.addresses.slice(offset, offset + 250).map((address) => ({
          ...address,
          sourceVersion: catalog.sourceVersion,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }
  });
}