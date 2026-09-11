import type { Request, Response, NextFunction } from "express";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;

export function rateLimit(scope: string, max: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Do not use X-Forwarded-For unless the application explicitly enables
    // Express trust proxy; socket address is the safe default.
    const ip = req.socket.remoteAddress ?? "unknown";
    const key = `${scope}:${ip}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + WINDOW_MS };
      buckets.set(key, bucket);
    }
    bucket.count++;
    if (bucket.count > max) {
      res.setHeader("Retry-After", Math.ceil((bucket.resetAt - now) / 1000));
      res.status(429).json({ error: "Too many requests" });
      return;
    }
    next();
  };
}