import { db, settings } from "@workspace/db";

const tenantId = process.env["FIAREP_TENANT_ID"] ?? "default";
const now = new Date();

const defaults = [
  {
    key: "leaveAllotments",
    value: {
      Vacation: 20,
      Sick: 10,
      Childcare: 12,
      Personal: 5,
      "Family Emergency": 5,
      Bereavement: 5,
      LOA: 0,
      "Jury Duty": 0,
      Other: 0,
      hoursPerDay: 8,
    },
  },
  {
    key: "staffPositions",
    value: [
      "Borough Director",
      "Regional Director",
      "Property Manager",
      "Assistant Property Manager",
      "Superintendent",
      "Assistant Superintendent",
      "Housing Assistant",
      "Maintenance Worker",
      "Caretaker",
      "Groundskeeper",
      "Janitorial Staff",
      "CPM",
      "Inspector",
      "Elevator Service",
      "Plumber",
      "Electrician",
      "Carpenter",
      "Roofer",
      "General Construction",
      "CCTV Installation",
      "Heating Service",
      "Staff Worker",
      "Director",
      "Other",
    ],
  },
];

for (const item of defaults) {
  await db
    .insert(settings)
    .values({
      tenantId,
      key: item.key,
      value: item.value,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [settings.tenantId, settings.key],
      set: { value: item.value, updatedAt: now },
    });
}

process.stdout.write(`Seeded FIAREP defaults for tenant ${tenantId}\n`);
process.exit(0);