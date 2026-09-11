import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import process from "node:process";
import test, { after } from "node:test";

const SCHEMA_PATTERN = "integration_test_%";
const scriptsDirectory = new URL("..", import.meta.url);
const launcher = new URL("./run-push-tests.ts", import.meta.url).pathname;
const fixture = new URL(
  "./run-push-tests.fixture.test.ts",
  import.meta.url,
).pathname;

process.env.NODE_ENV = "development";
const { pool } = await import("@workspace/db");

after(async () => {
  await pool.end();
});

async function disposableSchemas(): Promise<string[]> {
  const result = await pool.query<{ schema_name: string }>(
    `select schema_name
       from information_schema.schemata
      where schema_name like $1
      order by schema_name`,
    [SCHEMA_PATTERN],
  );
  return result.rows.map(({ schema_name }) => schema_name);
}

async function waitForAbandonedSchema(
  schemasBeforeRun: ReadonlySet<string>,
): Promise<string> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const schema = (await disposableSchemas()).find(
      (name) => !schemasBeforeRun.has(name),
    );
    if (schema) return schema;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the launcher to create its schema.");
}

function runLauncher(
  extraEnvironment: NodeJS.ProcessEnv = {},
): ReturnType<typeof spawn> {
  return spawn(process.execPath, ["--import", "tsx", launcher, fixture], {
    cwd: scriptsDirectory,
    detached: true,
    env: {
      ...process.env,
      NODE_ENV: "development",
      ...extraEnvironment,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForExit(child: ReturnType<typeof spawn>): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
  output: string;
}> {
  let output = "";
  child.stdout?.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    output += String(chunk);
  });

  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal, output }));
  });
}

test(
  "the next run removes a schema abandoned by a force-stopped run",
  { timeout: 60_000 },
  async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL must be set");
    const schemasBeforeRun = new Set(await disposableSchemas());
    const interruptedRun = runLauncher({ PUSH_TEST_FIXTURE_HANG: "1" });
    const interruptedExit = waitForExit(interruptedRun);

    try {
      const abandonedSchema = await waitForAbandonedSchema(schemasBeforeRun);
      assert.ok(interruptedRun.pid, "Launcher did not receive a process ID");
      process.kill(-interruptedRun.pid, "SIGKILL");
      const interruptedResult = await interruptedExit;
      assert.equal(interruptedResult.signal, "SIGKILL");
      assert.ok(
        (await disposableSchemas()).includes(abandonedSchema),
        "Force-stopped run did not leave a schema for the next run to clean",
      );

      const recoveryRun = runLauncher();
      const recoveryResult = await waitForExit(recoveryRun);
      assert.equal(
        recoveryResult.code,
        0,
        `Recovery run failed:\n${recoveryResult.output}`,
      );
      assert.deepEqual(
        await disposableSchemas(),
        [],
        "Disposable schemas remained after the recovery run completed",
      );
    } finally {
      if (interruptedRun.pid && interruptedRun.exitCode === null) {
        try {
          process.kill(-interruptedRun.pid, "SIGKILL");
        } catch {
          // The process group already exited.
        }
      }
      await pool.query(
        `do $$
         declare stale record;
         begin
           for stale in
             select schema_name
               from information_schema.schemata
              where schema_name like '${SCHEMA_PATTERN}'
           loop
             execute format('drop schema if exists %I cascade', stale.schema_name);
           end loop;
         end $$`,
      );
    }
  },
);