// Lotto Generator app: new draws since a date. Public and read-only, open to the app from any origin.
import { Router } from "express";
import { lottoSince, lottoTick } from "../lib/lotto";

const router = Router();
router.get("/", async (req, res) => {
  lottoTick();
  try {
    res.set("cache-control", "public, max-age=600");
    res.json(await lottoSince(String(req.query["since"] ?? "")));
  } catch {
    res.status(503).json({ error: "Not available right now" });
  }
});
export default router;
