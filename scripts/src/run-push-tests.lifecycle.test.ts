import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

async function waitForProcessPid(
  pidFile: string,
  processDescription: string,
): Promise<number> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const pid = Number.parseInt(await readFile(pidFile, "utf8"), 10);
      if (Number.isSafeInteger(pid) && pid > 0) return pid;
    } catch {
      // The fixture has not written its process ID yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${processDescription} to start.`);
}

async function waitForFile(
  file: string,
  description: string,
): Promise<string> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      return await readFile(file, "utf8");
    } catch {
      // The launcher has not reached the requested lifecycle point yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function waitForProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!processExists(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Child process ${pid} remained after launcher shutdown.`);
}

function runLauncher(
  extraEnvironment: NodeJS.ProcessEnv = {},
): ReturnType<typeof spawn> {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "development",
    ...extraEnvironment,
  };
  delete environment.NODE_TEST_CONTEXT;

  return spawn(process.execPath, ["--import", "tsx", launcher, fixture], {
    cwd: scriptsDirectory,
    detached: true,
    env: environment,
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

for (const [signal, expectedExitCode] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const) {
  test(
    `${signal} stops the fixture and removes its disposable schema`,
    { timeout: 60_000 },
    async () => {
      assert.ok(process.env.DATABASE_URL, "DATABASE_URL must be set");
      const schemasBeforeRun = new Set(await disposableSchemas());
      const temporaryDirectory = await mkdtemp(
        join(tmpdir(), "push-test-lifecycle-"),
      );
      const childPidFile = join(temporaryDirectory, "child.pid");
      const fixturePidFile = join(temporaryDirectory, "fixture.pid");
      const interruptedRun = runLauncher({
        PUSH_TEST_FIXTURE_HANG: "1",
        PUSH_TEST_CHILD_PID_FILE: childPidFile,
        PUSH_TEST_FIXTURE_PID_FILE: fixturePidFile,
      });
      const interruptedExit = waitForExit(interruptedRun);
      let childPid: number | undefined;
      let fixturePid: number | undefined;

      try {
        const schema = await waitForAbandonedSchema(schemasBeforeRun);
        childPid = await waitForProcessPid(
          childPidFile,
          "the launcher child",
        );
        fixturePid = await waitForProcessPid(
          fixturePidFile,
          "the hanging fixture",
        );
        assert.ok(processExists(childPid), "Child exited before interruption");
        assert.ok(processExists(fixturePid), "Fixture exited before interruption");
        assert.ok(interruptedRun.pid, "Launcher did not receive a process ID");

        interruptedRun.kill(signal);
        const interruptedResult = await interruptedExit;

        assert.equal(
          interruptedResult.code,
          expectedExitCode,
          `Launcher failed during ${signal} shutdown:\n${interruptedResult.output}`,
        );
        await waitForProcessExit(childPid);
        await waitForProcessExit(fixturePid);
        assert.ok(
          !(await disposableSchemas()).includes(schema),
          "Disposable schema remained after launcher shutdown",
        );
        assert.deepEqual(
          await disposableSchemas(),
          [],
          "Integration-test schemas remained after launcher shutdown",
        );
      } finally {
        if (interruptedRun.pid) {
          try {
            process.kill(-interruptedRun.pid, "SIGKILL");
          } catch {
            // The process group already exited.
          }
        }
        if (childPid && processExists(childPid)) {
          try {
            process.kill(childPid, "SIGKILL");
          } catch {
            // The child already exited.
          }
        }
        if (fixturePid && processExists(fixturePid)) {
          try {
            process.kill(fixturePid, "SIGKILL");
          } catch {
            // The child already exited.
          }
        }
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    },
  );
}

for (const [signal, expectedExitCode] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const) {
  test(
    `${signal} during database preparation removes the partial schema without starting the child`,
    { timeout: 60_000 },
    async () => {
      assert.ok(process.env.DATABASE_URL, "DATABASE_URL must be set");
      const temporaryDirectory = await mkdtemp(
        join(tmpdir(), "push-test-preparation-"),
      );
      const preparationReadyFile = join(temporaryDirectory, "preparation.ready");
      const childPidFile = join(temporaryDirectory, "child.pid");
      const fixturePidFile = join(temporaryDirectory, "fixture.pid");
      const interruptedRun = runLauncher({
        PUSH_TEST_PREPARATION_READY_FILE: preparationReadyFile,
        PUSH_TEST_CHILD_PID_FILE: childPidFile,
        PUSH_TEST_FIXTURE_PID_FILE: fixturePidFile,
      });
      const interruptedExit = waitForExit(interruptedRun);

      try {
        const partialSchema = await waitForFile(
          preparationReadyFile,
          "database preparation to pause",
        );
        assert.ok(
          (await disposableSchemas()).includes(partialSchema),
          "Preparation barrier was reached without a partial schema",
        );
        assert.ok(interruptedRun.pid, "Launcher did not receive a process ID");

        interruptedRun.kill(signal);
        const interruptedResult = await interruptedExit;

        assert.equal(
          interruptedResult.code,
          expectedExitCode,
          `Launcher failed during ${signal} preparation shutdown:\n${interruptedResult.output}`,
        );
        assert.equal(
          processExists(interruptedRun.pid),
          false,
          "Launcher remained after preparation shutdown",
        );
        await assert.rejects(readFile(childPidFile, "utf8"), {
          code: "ENOENT",
        });
        await assert.rejects(readFile(fixturePidFile, "utf8"), {
          code: "ENOENT",
        });
        assert.ok(
          !(await disposableSchemas()).includes(partialSchema),
          "Partial schema remained after preparation shutdown",
        );
        assert.deepEqual(
          await disposableSchemas(),
          [],
          "Integration-test schemas remained after preparation shutdown",
        );
      } finally {
        if (interruptedRun.pid && processExists(interruptedRun.pid)) {
          try {
            process.kill(-interruptedRun.pid, "SIGKILL");
          } catch {
            // The process group already exited.
          }
        }
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    },
  );
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