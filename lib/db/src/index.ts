import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;
const testSchema = process.env.TEST_DATABASE_SCHEMA;
const TEST_SCHEMA_PATTERN = /^integration_test_[a-z0-9_]+$/;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

if (process.env.NODE_ENV === "test" && !testSchema) {
  throw new Error(
    "Integration tests require TEST_DATABASE_SCHEMA and refuse to use the default database schema.",
  );
}

if (testSchema && !TEST_SCHEMA_PATTERN.test(testSchema)) {
  throw new Error(
    "TEST_DATABASE_SCHEMA must be a disposable integration_test_* schema.",
  );
}

if (testSchema && process.env.NODE_ENV !== "test") {
  throw new Error("TEST_DATABASE_SCHEMA may only be used when NODE_ENV=test.");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: testSchema ? `-c search_path=${testSchema}` : undefined,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
