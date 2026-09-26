import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  NYCHA_DEVELOPMENT_NAMES,
  useCreateEntityRecord,
  useSearchNychaAddresses,
  type Staff,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { invalidateOperationalQueries } from "@/lib/query-invalidation";
import { sameTitle } from "@/lib/titles";

// Website versions of the app's management "Create Report" and "Send as
// Violation" (supervisors/managers act on the website; the app is view-only).

const LOCATIONS = ["Apartment/Unit", "Building", "Hallways", "Cellar", "Compactor Room", "Elevator", "Roof", "Other"];
const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** "Create report" button + dialog: a manager files a complaint (e.g. a building issue). */
export function CreateReportButton() {
  const { staff: actor } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const create = useCreateEntityRecord();
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useState("Building");
  const [otherLocation, setOtherLocation] = useState("");
  const [unit, setUnit] = useState("");
  const [development, setDevelopment] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const developments = useMemo(() => {
    const own = (actor?.developments || []).filter(Boolean);
    return own.length ? own : [...NYCHA_DEVELOPMENT_NAMES];
  }, [actor?.developments]);
  const addresses = useSearchNychaAddresses(
    { development: development || undefined, limit: 50 },
    { query: { enabled: !!development } as never },
  );

  function reset() {
    setLocation("Building"); setOtherLocation(""); setUnit(""); setDevelopment(""); setAddress(""); setDescription("");
  }

  async function submit() {
    const effectiveLocation = location === "Other" ? otherLocation.trim() || "Other" : location;
    if (!development || !address.trim() || !description.trim()) {
      toast({ variant: "destructive", title: "Missing details", description: "Development, address and description are required." });
      return;
    }
    if (location === "Apartment/Unit" && !unit.trim()) {
      toast({ variant: "destructive", title: "Unit required", description: "Enter the apartment or unit." });
      return;
    }
    const id = newId();
    const now = new Date().toISOString();
    try {
      await create.mutateAsync({
        entity: "resident-reports",
        data: {
          id,
          version: 1,
          development,
          state: {
            id,
            createdBy: "management",
            location: effectiveLocation,
            unit: unit.trim(),
            address: address.trim(),
            development,
            description: description.trim(),
            photos: [],
            status: "submitted",
            updates: [{ status: "submitted", by: actor?.name || "management", at: now }],
            createdAt: now,
          },
        } as never,
      });
      await invalidateOperationalQueries(queryClient, "resident-reports", id);
      toast({ title: "Report created", description: `${effectiveLocation} · ${address.trim()}` });
      reset();
      setOpen(false);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Could not create report", description: error?.message || "Please try again." });
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="button-create-report">Create report</Button>
      <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) reset(); }}>
        <DialogContent className="sm:max-w-[540px]">
          <DialogHeader>
            <DialogTitle>Create report</DialogTitle>
            <DialogDescription>File a complaint for a building or unit. It appears in Reports ready to assign.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-sm font-medium">Location</p>
              <select className={selectClass} value={location} onChange={(event) => setLocation(event.target.value)}>
                {LOCATIONS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              {location === "Other" && <Input className="mt-2" value={otherLocation} onChange={(event) => setOtherLocation(event.target.value)} placeholder="Describe the location" />}
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">Development</p>
              <select className={selectClass} value={development} onChange={(event) => { setDevelopment(event.target.value); setAddress(""); }}>
                <option value="">Select development</option>
                {developments.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">Building address</p>
              <select className={selectClass} value={address} onChange={(event) => setAddress(event.target.value)} disabled={!development}>
                <option value="">{development ? (addresses.isLoading ? "Loading addresses…" : "Select address") : "Select a development first"}</option>
                {(addresses.data || []).map((item) => <option key={item.id} value={item.address}>{item.address}</option>)}
              </select>
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">{location === "Apartment/Unit" ? "Unit / Apartment" : "Unit / Apartment (optional)"}</p>
              <Input value={unit} onChange={(event) => setUnit(event.target.value.toUpperCase())} placeholder="e.g. 4B" />
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">Description</p>
              <Textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What needs repair?" />
            </div>
            <Button className="w-full" onClick={submit} disabled={create.isPending}>{create.isPending ? "Creating…" : "Create report"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** "Send as violation": route a complaint to an Inspector covering its development. */
export function SendAsViolationPanel({ report, staff }: {
  report: { id: string; development?: string | null; state?: Record<string, unknown> };
  staff: Staff[];
}) {
  const { staff: actor } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const create = useCreateEntityRecord();
  const state = report.state || {};
  const development = String(report.development || state.development || "");
  const [inspectorId, setInspectorId] = useState("");
  const [violationNumber, setViolationNumber] = useState("");
  const [note, setNote] = useState(String(state.description || ""));
  const [sentTo, setSentTo] = useState("");
  const inspectors = staff.filter((member) =>
    member.role === "inspector" &&
    sameTitle(member.position, "Inspector") &&
    member.id !== actor?.id &&
    !!development &&
    member.developments.some((value) => sameTitle(value, development)),
  ).sort((a, b) => a.name.localeCompare(b.name));
  const address = [String(state.address || ""), state.unit ? `Unit ${String(state.unit)}` : ""].filter(Boolean).join(" ");
  const complaintNo = String(state.complaintNo || "");

  async function send() {
    const inspector = inspectors.find((member) => member.id === inspectorId);
    if (!inspector || !address) return;
    const id = newId();
    const clientRequestId = newId();
    const instructions = [
      violationNumber.trim() ? `Violation #: ${violationNumber.trim()}` : "",
      complaintNo ? `Complaint #: ${complaintNo}` : "",
      note.trim() ? `Note: ${note.trim()}` : "",
    ].filter(Boolean).join("\n") || `Inspect ${address}`;
    try {
      await create.mutateAsync({
        entity: "route-assignments",
        data: {
          id,
          version: 1,
          development,
          state: {
            id,
            clientRequestId,
            inspector: "",
            assignmentKind: "violation-inspection",
            assignedStaffId: inspector.id,
            development,
            location: address,
            instructions,
            sourceInspectionRef: violationNumber.trim() || complaintNo || undefined,
            assignedBy: actor?.name || "",
            assignedAt: new Date().toISOString(),
            fileName: "",
            stops: [{ id: newId(), address, status: "pending" }],
          },
        } as never,
      });
      await invalidateOperationalQueries(queryClient, "route-assignments", id);
      setSentTo(inspector.name);
      setInspectorId("");
      toast({ title: "Sent as violation", description: `${inspector.name} · ${address}` });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Could not send", description: error?.message || "Please try again." });
    }
  }

  return (
    <div className="border-t border-border pt-4 space-y-2">
      <p className="text-sm font-semibold">Send as violation to an Inspector</p>
      <select className={selectClass} value={inspectorId} onChange={(event) => setInspectorId(event.target.value)}>
        <option value="">{inspectors.length ? "Select inspector" : `No approved Inspector covers ${development || "this development"}`}</option>
        {inspectors.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
      </select>
      <Input value={violationNumber} onChange={(event) => setViolationNumber(event.target.value)} placeholder="Violation # (optional)" />
      <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="What to check on site" />
      <Button variant="outline" onClick={send} disabled={!inspectorId || create.isPending}>{create.isPending ? "Sending…" : "Send as violation"}</Button>
      {!!sentTo && <p className="text-xs text-muted-foreground">Sent to {sentTo}. You can send it to another inspector too.</p>}
    </div>
  );
}
