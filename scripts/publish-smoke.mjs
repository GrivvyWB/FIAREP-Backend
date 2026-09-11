/*
 * Authenticated publish smoke checks. Run against a running API with:
 *   SMOKE_BASE_URL=https://... OWNER_ACCESS_TOKEN=... STAFF_ACCESS_TOKEN=... \
 *   ORG_ID=... REPORT_ID=... PHOTO_ID=... node scripts/publish-smoke.mjs
 * No credentials are printed. The script intentionally skips checks whose
 * fixture identifiers are not supplied.
 */
const base = process.env.SMOKE_BASE_URL || "http://localhost:3000/api";
const owner = process.env.OWNER_ACCESS_TOKEN;
const staff = process.env.STAFF_ACCESS_TOKEN;
const org = process.env.ORG_ID;
const report = process.env.REPORT_ID;
const photo = process.env.PHOTO_ID;

async function request(path, init = {}) {
  return fetch(`${base}${path}`, {
    ...init,
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers || {}) },
  });
}
function requireStatus(response, expected, label) {
  if (response.status !== expected) throw new Error(`${label}: expected ${expected}, got ${response.status}`);
}

const unauthenticated = await request(`/v1/platform/organizations/${encodeURIComponent(org || "missing")}/properties`);
requireStatus(unauthenticated, 401, "owner property route rejects unauthenticated access");

if (owner && org) {
  const headers = { authorization: `Bearer ${owner}` };
  const properties = await request(`/v1/platform/organizations/${encodeURIComponent(org)}/properties`, { headers });
  requireStatus(properties, 200, "owner property list");
  const patch = await request(`/v1/platform/organizations/${encodeURIComponent(org)}`, {
    method: "PATCH", headers, body: JSON.stringify({ status: "active" }),
  });
  requireStatus(patch, 200, "organization status patch");
}
if (staff && report) {
  const headers = { authorization: `Bearer ${staff}` };
  const photos = await request(`/v1/resident-report-photos?reportId=${encodeURIComponent(report)}`, { headers });
  requireStatus(photos, 200, "scoped photo list");
  if (photo) {
    const download = await request(`/v1/resident-report-photos/${encodeURIComponent(photo)}/download-url`, { method: "POST", headers });
    requireStatus(download, 200, "scoped photo download");
  }
}
console.log("Publish smoke checks passed (fixture-dependent checks run when configured).");