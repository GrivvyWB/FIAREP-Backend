import test from "node:test";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:net";

test("process lifecycle fixture", async () => {
  if (process.env.PUSH_TEST_FIXTURE_HANG === "1") {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const pidFile = process.env.PUSH_TEST_FIXTURE_PID_FILE;
    if (pidFile) {
      await writeFile(pidFile, String(process.pid));
    }
    await new Promise<never>(() => undefined);
  }
});