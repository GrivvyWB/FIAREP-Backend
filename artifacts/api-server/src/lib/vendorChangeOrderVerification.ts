// Quiet verification of a vendor's change work order photos. Never shown to the
// vendor. Two checks:
//   1. Where each photo was taken (GPS stamped by the phone at capture time)
//      against the job's address.
//   2. What the photo shows (AI) against what the vendor says changed, and
//      whether the setting fits the job's location.
// Anything doubtful goes only to the supervisors handling the job, worded as
// a request to verify, not an accusation.
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, entityRecords, notifications } from "@workspace/db";
import { deliverPushNotification } from "./push";
import { distanceMeters, geocodeNycPoint } from "./nycProperty";

export type PhotoStamp = { capturedAt?: string; lat?: number; lng?: number; accuracy?: number };

export type ChangeOrderVerification = {
  checkedAt: string;
  needsReview: boolean;
  summary: string;              // one line for the supervisor
  location: {
    jobAddress: string;
    jobGeo: { latitude: number; longitude: number } | null;
    photos: Array<{ index: number; capturedAt: string; hasGeo: boolean; distanceMeters: number | null; ok: boolean }>;
    note: string;
  };
  content: {
    matchesDescription: boolean | null;
    settingFitsLocation: boolean | null;
    confidence: number;
    observation: string;
    skipped?: string;
  };
};

const FAR_METERS = 200;      // beyond this the photo was not taken at the job site
const MAX_ACCURACY = 500;    // a fix looser than this cannot place the phone

async function analyzePhotos(
  apiKey: string,
  photos: string[],
  description: string,
  reason: string,
  scope: string,
  address: string,
): Promise<ChangeOrderVerification["content"]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5-mini",
        messages: [
          {
            role: "system",
            content: `You review construction change-order photos for a housing authority. Compare the photos with the vendor's
description of extra work and the awarded scope. Answer strictly as JSON. Be factual and cautious: when the photos plausibly show
what is described, matchesDescription is true. settingFitsLocation is whether the setting (residential apartment / hallway /
building exterior / basement etc.) is consistent with the job address and scope; it is false only when the photos clearly show a
different kind of place (e.g. a private house, a store, a different building type, outdoors when the job is an apartment interior).
Keep observation to two short factual sentences a supervisor can act on.`,
          },
          {
            role: "user",
            content: [
              { type: "text", text: `Job address: ${address}\nAwarded scope: ${scope.slice(0, 1500)}\nVendor says changed: ${description}\nVendor's reason: ${reason}` },
              ...photos.slice(0, 4).map((image) => ({ type: "image_url", image_url: { url: image, detail: "high" } })),
            ],
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "change_order_photo_review",
            strict: true,
            schema: {
              type: "object", additionalProperties: false,
              required: ["matchesDescription", "settingFitsLocation", "confidence", "observation"],
              properties: {
                matchesDescription: { type: "boolean" },
                settingFitsLocation: { type: "boolean" },
                confidence: { type: "number" },
                observation: { type: "string" },
              },
            },
          },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`OpenAI ${response.status}`);
    const payload = (await response.json()) as any;
    const content = payload?.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content : Array.isArray(content) ? content.find((p: any) => p?.type === "text")?.text : null;
    const parsed = JSON.parse(String(text || "{}"));
    return {
      matchesDescription: typeof parsed.matchesDescription === "boolean" ? parsed.matchesDescription : null,
      settingFitsLocation: typeof parsed.settingFitsLocation === "boolean" ? parsed.settingFitsLocation : null,
      confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0,
      observation: typeof parsed.observation === "string" ? parsed.observation : "",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function verifyVendorChangeOrder(input: {
  tenantId: string;
  changeOrderId: string;
  address: string;
  scope: string;
  description: string;
  reason: string;
  photos: string[];
  stamps: PhotoStamp[];
  supervisorIds: string[];
  vendorName: string;
  ref: string;
}): Promise<void> {
  const checkedAt = new Date().toISOString();
  // 1. Location
  const jobGeo = await geocodeNycPoint(input.address).catch(() => null);
  const photoChecks = input.photos.map((_p, index) => {
    const stamp = input.stamps[index] || {};
    const hasGeo = typeof stamp.lat === "number" && typeof stamp.lng === "number" && Number.isFinite(stamp.lat) && Number.isFinite(stamp.lng);
    const usable = hasGeo && (typeof stamp.accuracy !== "number" || stamp.accuracy <= MAX_ACCURACY);
    const distance = jobGeo && usable ? distanceMeters({ latitude: stamp.lat!, longitude: stamp.lng! }, jobGeo) : null;
    const ok = distance === null ? !hasGeo && !jobGeo ? true : false : distance <= FAR_METERS;
    return { index, capturedAt: String(stamp.capturedAt || ""), hasGeo, distanceMeters: distance, ok };
  });
  const noGeo = photoChecks.filter((p) => !p.hasGeo).length;
  const far = photoChecks.filter((p) => p.distanceMeters !== null && p.distanceMeters > FAR_METERS);
  let locationNote = "";
  if (!jobGeo) locationNote = "The job address could not be placed on the map, so photo locations could not be compared.";
  else if (far.length) locationNote = `${far.length === photoChecks.length ? "The photos were" : `${far.length} of ${photoChecks.length} photos were`} taken about ${Math.round(Math.max(...far.map((p) => p.distanceMeters!)) / 100) / 10} km from the job address.`;
  else if (noGeo === photoChecks.length) locationNote = "The photos carry no location (location access was off when they were taken), so where they were taken could not be confirmed.";
  else if (noGeo) locationNote = `${noGeo} of ${photoChecks.length} photos carry no location.`;
  else locationNote = "All photos were taken at the job address.";

  // 2. Content
  let content: ChangeOrderVerification["content"] = { matchesDescription: null, settingFitsLocation: null, confidence: 0, observation: "", skipped: "" };
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) content.skipped = "AI photo review is not set up on the server.";
  else {
    try { content = await analyzePhotos(apiKey, input.photos, input.description, input.reason, input.scope, input.address); }
    catch (error) { content.skipped = `AI photo review could not run (${String((error as Error)?.message || error)})`; }
  }

  const needsReview =
    far.length > 0 ||
    (jobGeo !== null && noGeo === photoChecks.length) ||
    content.matchesDescription === false ||
    content.settingFitsLocation === false;
  const reasons: string[] = [];
  if (far.length || (jobGeo && noGeo === photoChecks.length)) reasons.push(locationNote);
  if (content.settingFitsLocation === false) reasons.push("The setting in the photos does not appear to match the job location.");
  if (content.matchesDescription === false) reasons.push("The photos do not clearly show the change the vendor describes.");
  const summary = needsReview
    ? `Please verify before approving: ${reasons.join(" ")}`
    : `Photos check out: ${locationNote}${content.matchesDescription === true ? " They show the change described." : ""}`;

  const verification: ChangeOrderVerification = {
    checkedAt, needsReview, summary,
    location: { jobAddress: input.address, jobGeo, photos: photoChecks, note: locationNote },
    content,
  };
  await db.update(entityRecords)
    .set({ state: sql`${entityRecords.state} || ${JSON.stringify({ verification })}::jsonb` })
    .where(and(eq(entityRecords.id, input.changeOrderId), eq(entityRecords.tenantId, input.tenantId)));

  if (needsReview) {
    for (const target of input.supervisorIds) {
      const [n] = await db.insert(notifications).values({
        id: randomUUID(), tenantId: input.tenantId, target,
        message: "Change work order — please verify the photo location",
        detail: `${input.vendorName} · ${input.ref} — ${reasons.join(" ")} Confirm with the vendor where and when the photos were taken before approving.`,
        reportId: input.changeOrderId,
      }).returning();
      if (n) void deliverPushNotification(n).catch(() => undefined);
    }
  }
}
