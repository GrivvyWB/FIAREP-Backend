import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
const configuredOrigins = (process.env["CORS_ORIGINS"] ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || configuredOrigins.length === 0 || configuredOrigins.includes(origin)) callback(null, true);
    else callback(new Error("Origin is not allowed"));
  },
  credentials: true,
}));
// Photo classification (FIAREP Vision, Measurement material detect) posts a
// phone photo as base64 — well over 1 MB. Everything else stays at 1 MB.
app.use("/api/ai", express.json({ limit: "15mb" }));
// A saved measurement carries the picture it was taken from.
app.use("/api/v1/measurements", express.json({ limit: "4mb" }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use("/api", router);
app.use((_req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});
app.use(
  (
    err: unknown,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    req.log.error({ err }, "Unhandled request error");
    res.status(500).json({ error: "Internal server error" });
  },
);

export default app;
