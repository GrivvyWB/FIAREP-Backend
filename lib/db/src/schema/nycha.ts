import {
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const nychaDevelopments = pgTable(
  "nycha_developments",
  {
    id: text("id").primaryKey(),
    sequence: integer("sequence").notNull(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    program: text("program").notNull(),
    borough: text("borough"),
    tds: text("tds"),
    sourceVersion: text("source_version").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("nycha_development_sequence_unique").on(table.sequence),
    index("nycha_development_name_idx").on(table.normalizedName),
    index("nycha_development_program_idx").on(table.program),
  ],
);

export const nychaAddresses = pgTable(
  "nycha_addresses",
  {
    id: text("id").primaryKey(),
    developmentId: text("development_id")
      .notNull()
      .references(() => nychaDevelopments.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    normalizedAddress: text("normalized_address").notNull(),
    zipcode: text("zipcode").notNull(),
    borough: text("borough"),
    city: text("city"),
    state: text("state").notNull().default("NY"),
    building: text("building"),
    bin: text("bin"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    source: text("source").notNull(),
    sourceVersion: text("source_version").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("nycha_address_development_unique").on(
      table.developmentId,
      table.normalizedAddress,
      table.zipcode,
    ),
    index("nycha_address_search_idx").on(table.normalizedAddress),
    index("nycha_address_development_idx").on(table.developmentId),
  ],
);

export const insertNychaDevelopmentSchema = createInsertSchema(nychaDevelopments).omit({
  createdAt: true,
  updatedAt: true,
});
export const insertNychaAddressSchema = createInsertSchema(nychaAddresses).omit({
  createdAt: true,
  updatedAt: true,
});

export type NychaDevelopmentRecord = typeof nychaDevelopments.$inferSelect;
export type NychaAddressRecord = typeof nychaAddresses.$inferSelect;
export type InsertNychaDevelopment = z.infer<typeof insertNychaDevelopmentSchema>;
export type InsertNychaAddress = z.infer<typeof insertNychaAddressSchema>;