import test from "node:test";

test("process lifecycle fixture", async () => {
  if (process.env.PUSH_TEST_FIXTURE_HANG === "1") {
    await new Promise<never>(() => undefined);
  }
});