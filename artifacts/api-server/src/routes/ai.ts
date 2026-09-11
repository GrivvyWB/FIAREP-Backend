import { Router, type IRouter } from "express";
import { ClassifyViolationBody } from "@workspace/api-zod";
import { classifyViolationImage } from "../lib/violationClassification";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.post("/ai/classify-violation", requireAuth, async (req, res) => {
  const parsed = ClassifyViolationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A valid JPEG, PNG, or WebP image is required" });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    req.log.error("OPENAI_API_KEY is not configured");
    res.status(503).json({ error: "AI classification is unavailable" });
    return;
  }

  try {
    res.json(await classifyViolationImage(parsed.data.image, apiKey));
  } catch (error) {
    req.log.warn({ err: error }, "Violation classification failed");
    const malformed =
      error instanceof Error &&
      error.message === "OpenAI returned an invalid violation classification";
    res.status(malformed ? 502 : 503).json({
      error: malformed
        ? "AI returned an unusable classification"
        : "AI classification is temporarily unavailable",
    });
  }
});

export default router;