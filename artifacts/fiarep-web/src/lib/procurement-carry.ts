// Carries the name and code typed on the staff sign-in page to the
// Procurement sign-in page, in memory only (never stored in the browser).
let carried: { name: string; code: string } | null = null;

export function carryProcurementCredentials(name: string, code: string) {
  carried = { name: name.trim(), code: code.trim().toUpperCase() };
}

export function takeProcurementCredentials(): { name: string; code: string } | null {
  const value = carried;
  carried = null;
  return value;
}
