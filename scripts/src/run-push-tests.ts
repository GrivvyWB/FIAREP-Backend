import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createServer } from "node:net";
import process from "node:process";

const SCHEMA_PREFIX = "integration_test_";
const LOCK_ID = 1_905_202_601;

const SHUTDOWN_GRACE_MS = 1_000;
const testFile =
  process.argv[2] ?? "../artifacts/api-server/src/lib/push.test.ts";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set to prepare the integration database.",
  );
}

if (process.env.NODE_ENV === "production") {
  throw new Error("Integration tests refuse to run with NODE_ENV=production.");
}

const schema = `${SCHEMA_PREFIX}${randomUUID().replaceAll("-", "_")}`;
process.env.NODE_ENV = "test";
process.env.TEST_DATABASE_SCHEMA = schema;
const { pool } = await import("@workspace/db");
const client = await pool.connect();
let child: ReturnType<typeof spawn> | undefined;
let preparationBarrier: ReturnType<typeof createServer> | undefined;
let cleaned = false;

let stopping: Promise<void> | undefined;
function identifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function cleanup(): Promise<void> {
  if (cleaned) return;
  cleaned = true;
  try {
    preparationBarrier?.close();
    await client.query(`drop schema if exists ${identifier(schema)} cascade`);
  } finally {
    client.release();
    await pool.end().catch(() => undefined);
  }
}

function signalChildGroup(signal: NodeJS.Signals): void {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function pauseDuringPreparation(): Promise<void> {
  if (!process.env.PUSH_TEST_PREPARATION_READY_FILE) return;

  preparationBarrier = createServer();
  await new Promise<void>((resolve, reject) => {
    preparationBarrier?.once("error", reject);
    preparationBarrier?.listen(0, "127.0.0.1", resolve);
  });
  writeFileSync(process.env.PUSH_TEST_PREPARATION_READY_FILE, schema);
  await new Promise<void>((resolve) => {
    preparationBarrier?.once("close", resolve);
  });
}

function stop(signal: NodeJS.Signals): Promise<void> {
  stopping ??= (async () => {
    await stopChild(signal);
    await cleanup();
    process.exit(128 + (signal === "SIGINT" ? 2 : 15));
  })();
  return stopping;
}

process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));

try {
  await client.query("select pg_advisory_lock($1)", [LOCK_ID]);

  const staleSchemas = await client.query<{ schema_name: string }>(
    `select schema_name
       from information_schema.schemata
      where schema_name like $1`,
    [`${SCHEMA_PREFIX}%`],
  );
  for (const row of staleSchemas.rows) {
    await client.query(
      `drop schema if exists ${identifier(row.schema_name)} cascade`,
    );
  }

  await client.query(`create schema ${identifier(schema)}`);
  await pauseDuringPreparation();
  const tables = await client.query<{ tablename: string }>(
    `select tablename
       from pg_catalog.pg_tables
      where schemaname = 'public'
      order by tablename`,
  );
  if (tables.rows.length === 0) {
    throw new Error("The development schema has no tables to clone for tests.");
  }
  for (const { tablename } of tables.rows) {
    await client.query(
      `create table ${identifier(schema)}.${identifier(tablename)}
       (like public.${identifier(tablename)} including all)`,
    );
  }

  child = spawn(process.execPath, ["--import", "tsx", "--test", testFile], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      NODE_ENV: "test",
      TEST_DATABASE_SCHEMA: schema,
    },
    detached: true,
    stdio: "inherit",
  });
  if (process.env.PUSH_TEST_CHILD_PID_FILE && child.pid) {
    writeFileSync(process.env.PUSH_TEST_CHILD_PID_FILE, String(child.pid));
  }
  const exitCode = await new Promise<number>((resolve, reject) => {
    child?.once("error", reject);
    child?.once("exit", (code, signal) => {
      resolve(code ?? (signal ? 1 : 0));
    });
  });
  process.exitCode = exitCode;
} finally {
  await cleanup();
}

async function stopChild(signal: NodeJS.Signals): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;

  const exited =
    child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise<void>((resolve) => child?.once("exit", () => resolve()));
  signalChildGroup(signal);
  await new Promise((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS));
  signalChildGroup("SIGKILL");
  await exited;
}
