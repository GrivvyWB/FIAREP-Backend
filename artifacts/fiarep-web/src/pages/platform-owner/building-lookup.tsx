import { DofLookupPanel } from "@/components/dof-lookup";

/** Platform Control → Building lookup: the same Department of Finance / OATH /
 * HPD / DOB lookup clients use on the join page, for FIAREP's own use. No
 * submit form — this is FIAREP looking, not a client asking. */
export default function OwnerBuildingLookup() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-950">Building lookup</h1>
        <p className="text-sm text-slate-500">What a building owes the City and what is open on it — OATH / ECB summonses, HPD emergency-repair charges, property tax, and HPD / DOB violations by type.</p>
      </div>
      <div className="rounded-2xl bg-slate-950 p-4 text-slate-100">
        <DofLookupPanel onResult={() => undefined} canSubmit={false} persistKey="fiarep_owner_building_lookup" />
      </div>
    </div>
  );
}
