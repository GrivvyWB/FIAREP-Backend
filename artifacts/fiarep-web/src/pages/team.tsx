import {
  StaffPosition,
  StaffInputRole,
  StaffRole,
  useCreateStaff,
  useApproveStaff,
  useDeleteStaff,
  useListStaff,
  useResetStaffCode,
  useRevokeStaff,
  useListStaffDevelopments,
  getListStaffQueryKey,
  getListStaffDevelopmentsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { UsersRound, Search, Copy, Plus, KeyRound, UserX, Trash2, ChevronDown, Upload, Download } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { groupTeamDirectoryStaff } from "@/lib/staff-assignment";
import { invalidateStaffQueries } from "@/lib/query-invalidation";

const positions = Object.values(StaffPosition);
const allRoles = Object.values(StaffRole).filter((r) => r !== "resident");
const roleLabels: Record<string, string> = {
  administrator: "Administrator", human_resources: "Human Resources", management: "Management", worker: "Worker",
  inspector: "Inspector", procurement: "Procurement", vendor: "Vendor",
  resident: "Resident", emergency: "Emergency",
};

function errorMessage(error: unknown) {
  const e = error as { data?: { error?: string }; message?: string } | undefined;
  return e?.data?.error || e?.message || "The request could not be completed.";
}

function namesFromFile(contents: string) {
  return [...new Set(contents
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => {
      const value = line.trim();
      if (value.startsWith('"')) {
        const end = value.indexOf('"', 1);
        return end > 0 ? value.slice(1, end).replace(/""/g, '"').trim() : value.replace(/^"|"$/g, "").trim();
      }
      return value.includes(",") ? value.split(",")[0]!.trim() : value;
    })
    .filter((value) => value && !["name", "employee name", "employee"].includes(value.toLowerCase())))];
}

function roleForPosition(position: string) {
  if (position === "CPM" || position === "Inspector") return "inspector";
  if (
    position.includes("Supervisor") ||
    ["Borough Director", "Regional Director", "Assistant Regional Director", "Property Manager", "Assistant Property Manager", "Superintendent", "Assistant Superintendent", "Housing Assistant", "Director"].includes(position)
  ) return "management";
  return "worker";
}

export default function Team() {
  const { staff: actor } = useAuth();
  const queryClient = useQueryClient();
  const { data: staff, isLoading, error } = useListStaff(undefined, {
    query: {
      queryKey: getListStaffQueryKey(),
      staleTime: 15_000,
      refetchOnMount: "always",
    },
  });
  const {
    data: availableDevelopments,
    isLoading: developmentsLoading,
    error: developmentsError,
    refetch: refetchDevelopments,
  } = useListStaffDevelopments({
    query: {
      queryKey: getListStaffDevelopmentsQueryKey(),
      staleTime: 15_000,
      refetchOnMount: "always",
    },
  });
  const create = useCreateStaff();
  const approve = useApproveStaff();
  const reset = useResetStaffCode();
  const revoke = useRevokeStaff();
  const deleteStaff = useDeleteStaff();
  const [search, setSearch] = useState("");
  const [directoryDevelopment, setDirectoryDevelopment] = useState("");
  const [directoryStaffId, setDirectoryStaffId] = useState("");
  const [hrNotes, setHrNotes] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [createMode, setCreateMode] = useState<"single" | "bulk">("single");
  const [name, setName] = useState("");
  const [role, setRole] = useState<string>("worker");
  const [position, setPosition] = useState<string>("Staff Worker");
  const [developments, setDevelopments] = useState<string[]>([]);
  const [developmentsOpen, setDevelopmentsOpen] = useState(false);
  const [waitingForDocuments, setWaitingForDocuments] = useState(false);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [issuedRole, setIssuedRole] = useState<string>("");
  const [issuedEmployee, setIssuedEmployee] = useState<string>("");
  const [bulkNames, setBulkNames] = useState<string[]>([]);
  const [bulkFileName, setBulkFileName] = useState("");
  const [bulkResults, setBulkResults] = useState<Array<{ name: string; code?: string; error?: string }>>([]);
  const [bulkCreating, setBulkCreating] = useState(false);
  const [actionError, setActionError] = useState("");
  const [resetTarget, setResetTarget] = useState<{ id: string; name: string; role: string } | null>(null);

  const roleOptions = useMemo(() => {
    if (!actor) return [];
    if (actor.position === "Borough Director") return allRoles;
    if (actor.role === "human_resources") {
      return ["management", "worker", "inspector", "procurement", "emergency"];
    }
    if (actor.role === "administrator") {
      return allRoles.filter((r) => !["administrator", "resident"].includes(r));
    }
    if (actor.role === "management" && actor.position === "Regional Director") {
      return ["management", "worker", "inspector", "emergency"];
    }
    if (actor.role === "management") return ["worker", "inspector", "emergency"];
    return [];
  }, [actor]);
  const canIssue = roleOptions.length > 0;

  const developmentStaff = staff?.filter((member) =>
    member.role !== "human_resources" &&
    (!directoryDevelopment || member.developments.includes(directoryDevelopment))
  ).sort((a, b) => a.name.localeCompare(b.name));
  const filtered = staff?.filter((member) => {
    if (actor?.role === "human_resources") {
      if (member.role === "human_resources") return false;
      if (!directoryStaffId || member.id !== directoryStaffId) return false;
      if (directoryDevelopment && !member.developments.includes(directoryDevelopment)) return false;
    }
    const q = search.toLowerCase();
    return !q || [member.name, member.role, member.position].some((v) => v.toLowerCase().includes(q));
  }).sort((a, b) => a.name.localeCompare(b.name));

  useEffect(() => {
    if (actor?.role !== "human_resources" || !staff?.length) return;
    const staffId = new URLSearchParams(window.location.search).get("staffId");
    if (!staffId) return;
    const member = staff.find((candidate) => candidate.id === staffId && candidate.role !== "human_resources");
    if (!member) return;
    setDirectoryStaffId(member.id);
    setDirectoryDevelopment(member.developments[0] || "");
  }, [actor?.role, staff]);

  useEffect(() => {
    const member = staff?.find((candidate) => candidate.id === directoryStaffId) as
      | (NonNullable<typeof staff>[number] & { hrNotes?: string | null })
      | undefined;
    setHrNotes(member?.hrNotes || "");
  }, [directoryStaffId, staff]);

  async function refresh() {
    await invalidateStaffQueries(queryClient);
  }
  function openAddEmployee() {
    void refetchDevelopments();
    setCreateMode("single");
    setRole(roleOptions.includes("worker") ? "worker" : (roleOptions[0] ?? "worker"));
    setPosition("Staff Worker");
    setName("");
    setDevelopments([]);
    setWaitingForDocuments(false);
    setDevelopmentsOpen(false);
    setIssuedCode(null);
    setIssuedRole("");
    setIssuedEmployee("");
    setBulkNames([]);
    setBulkFileName("");
    setBulkResults([]);
    setBulkCreating(false);
    setActionError("");
    setOpen(true);
  }
  function closeForm() {
    setOpen(false); setName(""); setRole(roleOptions.includes("worker") ? "worker" : (roleOptions[0] ?? "worker")); setPosition("Staff Worker");
    setDevelopments([]); setDevelopmentsOpen(false);
    setWaitingForDocuments(false);
    setIssuedCode(null); setIssuedRole(""); setIssuedEmployee(""); setActionError("");
    setCreateMode("single"); setBulkNames([]); setBulkFileName(""); setBulkResults([]); setBulkCreating(false);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setActionError("");
    if (["Regional Director", "Assistant Regional Director", "Property Manager", "Superintendent", "Assistant Superintendent"].includes(position) && developments.length === 0) {
      setActionError("Select at least one assigned development.");
      return;
    }
    try {
      const result = await create.mutateAsync({
        data: {
          name: name.trim(), role: role as typeof StaffInputRole[keyof typeof StaffInputRole],
          position: position as typeof StaffPosition[keyof typeof StaffPosition],
          developments,
          status: waitingForDocuments ? "pending" : "approved",
        },
      });
      if (waitingForDocuments) {
        await refresh();
        closeForm();
      } else {
        setIssuedCode(result.code); setIssuedRole(role); setIssuedEmployee(name.trim()); await refresh();
      }
    } catch (e) { setActionError(errorMessage(e)); }
  }
  async function uploadEmployeeList(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const parsed = namesFromFile(await file.text());
    setBulkFileName(file.name);
    setBulkNames(parsed);
    setBulkResults([]);
    setActionError(parsed.length ? "" : "The employee list does not contain any names.");
  }
  async function submitBulk(event: React.FormEvent) {
    event.preventDefault();
    setActionError("");
    if (!bulkNames.length) {
      setActionError("Upload an employee list.");
      return;
    }
    if (["Regional Director", "Assistant Regional Director", "Property Manager", "Superintendent", "Assistant Superintendent"].includes(position) && developments.length === 0) {
      setActionError("Select at least one assigned development.");
      return;
    }
    setBulkCreating(true);
    const results: Array<{ name: string; code?: string; error?: string }> = [];
    for (const employeeName of bulkNames) {
      try {
        const result = await create.mutateAsync({
          data: {
            name: employeeName,
            role: role as typeof StaffInputRole[keyof typeof StaffInputRole],
            position: position as typeof StaffPosition[keyof typeof StaffPosition],
            developments,
              status: waitingForDocuments ? "pending" : "approved",
            clientRequestId: crypto.randomUUID(),
          },
        });
        results.push({ name: employeeName, code: result.code });
      } catch (error) {
        results.push({ name: employeeName, error: errorMessage(error) });
      }
      setBulkResults([...results]);
    }
    setBulkCreating(false);
    await refresh();
  }
  function downloadBulkResults() {
    const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const rows = [
      ["Name", "Role", "Position", "Access Code", "Result"],
      ...bulkResults.map((result) => [
        result.name,
        roleLabels[role] || role,
        position,
        result.code || "",
        result.error || "Created",
      ]),
    ];
    const blob = new Blob([rows.map((row) => row.map(escapeCsv).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `${position.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-employee-codes.csv`;
    link.click();
    URL.revokeObjectURL(href);
  }
  function selectPosition(nextPosition: string) {
    setPosition(nextPosition);
    const nextRole = roleForPosition(nextPosition);
    if (roleOptions.includes(nextRole)) setRole(nextRole);
  }
  async function resetCode() {
    if (!resetTarget) return;
    setActionError("");
    try {
      const result = await reset.mutateAsync({
        id: resetTarget.id,
      });
      setResetTarget(null);
      setIssuedCode(result.code);
      setIssuedRole(resetTarget.role);
      setIssuedEmployee(resetTarget.name);
      setOpen(true);
      await refresh();
    } catch (e) { setActionError(errorMessage(e)); }
  }
  async function approveEmployee(id: string, memberName: string, memberRole: string) {
    setActionError("");
    try {
      const result = await approve.mutateAsync({ id });
      setIssuedCode(result.code);
      setIssuedRole(memberRole);
      setIssuedEmployee(memberName);
      setOpen(true);
      await refresh();
    } catch (e) { setActionError(errorMessage(e)); }
  }
  async function revokeAccount(id: string, memberName: string) {
    if (!window.confirm(`Revoke ${memberName}'s account? They will be signed out and cannot log in.`)) return;
    setActionError("");
    try { await revoke.mutateAsync({ id }); await refresh(); }
    catch (e) { setActionError(errorMessage(e)); }
  }
  async function deleteAccount(id: string, memberName: string) {
    if (!window.confirm(`Permanently delete ${memberName}? This removes the account and signs it out on every device. This cannot be undone.`)) return false;
    setActionError("");
    try {
      await deleteStaff.mutateAsync({ id });
      await refresh();
      return true;
    } catch (e) {
      setActionError(errorMessage(e));
      return false;
    }
  }
  async function copyCode() {
    if (issuedCode) await navigator.clipboard?.writeText(issuedCode);
  }

  const authorityOrder = (member: NonNullable<typeof staff>[number]) =>
    member.position === "Borough Director" ? 0 : member.role === "administrator" ? 1 :
    member.role === "management" ? 2 : member.role === "procurement" ? 3 : 4;
  const sorted = filtered?.sort((a, b) => authorityOrder(a) - authorityOrder(b) || a.name.localeCompare(b.name));
  const exactSearchMatches = actor?.role === "human_resources"
    ? (staff || []).filter((member) => member.id === directoryStaffId)
    : (staff || []).filter(
        (member) => member.name.trim().toLowerCase() === search.trim().toLowerCase(),
      );
  async function deleteSearchedEmployee() {
    const target = exactSearchMatches.length === 1 ? exactSearchMatches[0] : undefined;
    if (!target) return;
    if (await deleteAccount(target.id, target.name)) setSearch("");
  }
  async function saveHrNotes() {
    if (!directoryStaffId) return;
    setNotesSaving(true);
    setActionError("");
    try {
      const response = await fetch(`/api/v1/staff/${encodeURIComponent(directoryStaffId)}/hr-notes`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("fiarep_access_token") || ""}`,
        },
        body: JSON.stringify({ notes: hrNotes }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Unable to save notes.");
      }
      await refresh();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setNotesSaving(false);
    }
  }
  const teamGroups = groupTeamDirectoryStaff(sorted || []);
  const memberCard = (member: NonNullable<typeof staff>[number]) => (
    <div key={member.id} className="flex items-center gap-4 p-4 rounded-xl border border-border">
      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#3d6fa8] to-[#185FA5] text-white grid place-items-center font-bold text-sm shrink-0">{member.name.split(" ").map((n) => n[0]).join("").substring(0, 2).toUpperCase()}</div>
      <div className="flex-1 min-w-0">
        <h4 className="font-bold truncate">{member.name}</h4>
        <div className="text-sm text-muted-foreground">{member.position}</div>
        {member.developments.length > 3 ? (
          <Collapsible>
            <CollapsibleTrigger className="mt-2 flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left text-xs font-medium text-muted-foreground">
              <span>{member.developments.length} assigned developments</span>
              <ChevronDown className="h-4 w-4 shrink-0" />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 rounded-md border border-border p-3 text-xs leading-relaxed text-muted-foreground">
              {member.developments.join(", ")}
            </CollapsibleContent>
          </Collapsible>
        ) : (
          <div className="text-xs text-muted-foreground">{member.developments.join(", ") || "All assigned developments"}</div>
        )}
      </div>
      <div className="text-right shrink-0"><div className="text-[13px] font-semibold bg-secondary px-2.5 py-1 rounded-full inline-block">{roleLabels[member.role] || member.role}</div><div className="text-xs text-muted-foreground capitalize">{member.status}</div>
        {(member.canResetCode || member.canRevoke || (member.canDelete && actor?.role !== "human_resources")) && <div className="flex flex-wrap gap-2 mt-2 justify-end">
          {member.canApprove && <Button size="sm" onClick={() => approveEmployee(member.id, member.name, member.role)} disabled={approve.isPending}>Approve employee</Button>}
          {member.canResetCode && member.status !== "revoked" && <Button size="sm" variant="outline" onClick={() => setResetTarget({ id: member.id, name: member.name, role: member.role })}><KeyRound className="mr-1 h-3 w-3" />Reset code</Button>}
          {member.canRevoke && member.status !== "revoked" && <Button size="sm" variant="destructive" onClick={() => revokeAccount(member.id, member.name)}><UserX className="mr-1 h-3 w-3" />Revoke</Button>}
          {member.canDelete && actor?.role !== "human_resources" && <Button size="sm" variant="destructive" onClick={() => deleteAccount(member.id, member.name)} disabled={deleteStaff.isPending}><Trash2 className="mr-1 h-3 w-3" />Delete</Button>}
        </div>}
      </div>
    </div>
  );
  const developmentSelector = (
    <div className="space-y-2">
      <Label id="employee-developments-label">Assigned developments</Label>
      <Collapsible open={developmentsOpen} onOpenChange={setDevelopmentsOpen}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="outline" className="w-full justify-between" aria-labelledby="employee-developments-label">
            Select assigned developments ({developments.length} selected)
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="rounded-md border p-3 mt-2 space-y-3">
          {developmentsLoading ? <p className="text-sm text-muted-foreground">Loading developments...</p> :
            developmentsError ? <p className="text-sm text-destructive">{errorMessage(developmentsError)}</p> :
            !availableDevelopments?.length ? <p className="text-sm text-muted-foreground">No active developments available.</p> :
            <>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => setDevelopments(availableDevelopments)}>Select all</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setDevelopments([])}>Clear</Button>
              </div>
              <div className="max-h-40 overflow-y-auto space-y-2" role="group" aria-label="Available developments">
                {availableDevelopments.map((development) => <label key={development} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={developments.includes(development)} onCheckedChange={(checked) => setDevelopments((current) => checked ? [...new Set([...current, development])] : current.filter((item) => item !== development))} />
                  <span>{development}</span>
                </label>)}
              </div>
            </>}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div><h1 className="text-2xl font-bold tracking-tight">Team Directory</h1>
          <p className="text-muted-foreground text-sm">View staff directory and authority.</p></div>
         {canIssue && <Button onClick={openAddEmployee}><Plus className="mr-2 h-4 w-4" />Create</Button>}
      </div>
      <div className="bg-card rounded-[14px] shadow-sm border border-border">
        <div className="p-4 border-b border-border space-y-3">
          {actor?.role === "human_resources" && <select aria-label="Select development" className="w-full max-w-xl rounded-md border border-input bg-background px-3 py-2 text-sm" value={directoryDevelopment} onChange={(event) => { setDirectoryDevelopment(event.target.value); setDirectoryStaffId(""); setSearch(""); }}>
            <option value="">Select development</option>
            {(availableDevelopments || []).map((development) => <option key={development} value={development}>{development}</option>)}
          </select>}
          <div className="flex max-w-xl gap-2">
            {actor?.role === "human_resources" ? <select aria-label="Select staff member" className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm" value={directoryStaffId} onChange={(event) => {
              const staffId = event.target.value;
              setDirectoryStaffId(staffId);
              if (!directoryDevelopment) {
                const selectedMember = (staff || []).find((member) => member.id === staffId);
                if (selectedMember?.developments[0]) setDirectoryDevelopment(selectedMember.developments[0]);
              }
            }}>
              <option value="">Select staff member</option>
              {(developmentStaff || []).map((member) => <option key={member.id} value={member.id}>{member.name} — {member.position}</option>)}
            </select> : <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input aria-label="Search team members" placeholder="Search team members..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>}
            {actor?.role === "human_resources" && <Button type="button" variant="destructive" onClick={deleteSearchedEmployee} disabled={exactSearchMatches.length !== 1 || deleteStaff.isPending}><Trash2 className="mr-2 h-4 w-4" />Delete</Button>}
          </div>
        </div>
        <div className="p-4">
          {isLoading ? <div className="p-8 text-center text-muted-foreground">Loading team...</div> :
            error ? <div className="p-8 text-center text-destructive">{errorMessage(error)}</div> :
            actor?.role === "human_resources" && !directoryDevelopment && !directoryStaffId ? <div className="p-12 text-center flex flex-col items-center"><UsersRound className="w-12 h-12 text-muted-foreground/30 mb-4" /><h3 className="text-lg font-bold">Select a development</h3></div> :
            actor?.role === "human_resources" && !directoryStaffId ? <div className="p-12 text-center flex flex-col items-center"><UsersRound className="w-12 h-12 text-muted-foreground/30 mb-4" /><h3 className="text-lg font-bold">Select a staff member</h3></div> :
            sorted?.length === 0 ? <div className="p-12 text-center flex flex-col items-center"><UsersRound className="w-12 h-12 text-muted-foreground/30 mb-4" /><h3 className="text-lg font-bold">No team members found</h3></div> :
            actor?.role === "human_resources" ?
              <div className="space-y-3">
                <Collapsible key={`${directoryDevelopment}:${search ? "search" : "browse"}`} defaultOpen>
                  <CollapsibleTrigger className="flex w-full items-center justify-between rounded-xl border border-border bg-secondary/30 px-4 py-3 text-left">
                    <div><h3 className="font-bold">{directoryDevelopment}</h3><p className="text-xs text-muted-foreground">{sorted?.length || 0} staff member{sorted?.length === 1 ? "" : "s"}</p></div>
                    <ChevronDown className="h-5 w-5 shrink-0" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="grid gap-3 pt-3">
                    {(sorted || []).map(memberCard)}
                    <div className="space-y-2 rounded-xl border border-border p-4">
                      <Label htmlFor="hr-notes">HR notes</Label>
                      <textarea id="hr-notes" className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={hrNotes} onChange={(event) => setHrNotes(event.target.value)} />
                      <Button type="button" onClick={saveHrNotes} disabled={notesSaving}>{notesSaving ? "Saving..." : "Save notes"}</Button>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div> :
              <div className="space-y-6">{teamGroups.map((group) => <section key={group.label} className="space-y-3"><div className="border-b border-border pb-2"><h3 className="font-bold">{group.label}</h3><p className="text-xs text-muted-foreground">{group.people.length} team member{group.people.length === 1 ? "" : "s"}</p></div><div className="grid gap-3">{group.people.map(memberCard)}</div></section>)}</div>}
        </div>
      </div>
      <Dialog open={open} onOpenChange={(v) => !v && closeForm()}>
        <DialogContent><DialogHeader><DialogTitle>{issuedCode ? "One-time access code" : "Add Employee"}</DialogTitle><DialogDescription>{issuedCode ? `Replacement credentials for ${issuedEmployee}.` : "Issue a staff account. The access code is shown only once."}</DialogDescription></DialogHeader>
          {issuedCode ? <div className="space-y-4"><div className="rounded-md bg-muted p-4 text-center"><p className="text-sm font-medium">{issuedRole && issuedRole !== "reset" ? `${roleLabels[issuedRole] || issuedRole} credentials` : "Replacement credentials"}</p><p className="text-3xl font-bold tracking-[0.4em] my-2">{issuedCode}</p><Button variant="outline" onClick={copyCode}><Copy className="mr-2 h-4 w-4" />Copy code</Button></div><p className="text-sm text-destructive">Give this code securely to {issuedEmployee || "the employee"}. It will not be displayed again. {issuedRole === "procurement" && "Procurement employees sign in at /procurement/login."}</p><DialogFooter><Button onClick={closeForm}>Done</Button></DialogFooter></div> :
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant={createMode === "single" ? "default" : "outline"} onClick={() => setCreateMode("single")}>One employee</Button>
                <Button type="button" variant={createMode === "bulk" ? "default" : "outline"} onClick={() => setCreateMode("bulk")}>Employee list</Button>
              </div>
              {createMode === "single" ? (
                <form onSubmit={submit} className="space-y-4">
                  <div><Label htmlFor="employee-name">Name</Label><Input id="employee-name" required value={name} onChange={(e) => setName(e.target.value)} /></div>
                  <div><Label htmlFor="employee-role">Role</Label><select id="employee-role" className="w-full border rounded-md p-2 bg-background" value={role} onChange={(e) => setRole(e.target.value)}>{roleOptions.map((r) => <option key={r} value={r}>{roleLabels[r] || r}</option>)}</select></div>
                  <div><Label htmlFor="employee-position">Position</Label><select id="employee-position" className="w-full border rounded-md p-2 bg-background" value={position} onChange={(e) => selectPosition(e.target.value)}>{positions.filter((p) => p !== "Borough Director" || actor?.position === "Borough Director").map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
                  {developmentSelector}
                   {actor?.role === "human_resources" && <label className="flex items-center gap-2 text-sm"><Checkbox checked={waitingForDocuments} onCheckedChange={(checked) => setWaitingForDocuments(checked === true)} /><span>Waiting for documents</span></label>}
                  {actionError && <p className="text-sm text-destructive">{actionError}</p>}
                  <DialogFooter><Button type="button" variant="outline" onClick={closeForm}>Cancel</Button><Button type="submit" disabled={create.isPending}>{create.isPending ? "Creating..." : "Create employee"}</Button></DialogFooter>
                </form>
              ) : bulkResults.length > 0 && !bulkCreating ? (
                <div className="space-y-4">
                  <div className="max-h-72 overflow-y-auto rounded-md border">
                    {bulkResults.map((result) => <div key={result.name} className="flex items-center justify-between gap-4 border-b p-3 last:border-b-0">
                      <span className="font-medium">{result.name}</span>
                      <span className={result.error ? "text-sm text-destructive" : "font-mono font-bold"}>{result.error || result.code}</span>
                    </div>)}
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={downloadBulkResults}><Download className="mr-2 h-4 w-4" />Download results</Button>
                    <Button type="button" onClick={closeForm}>Done</Button>
                  </DialogFooter>
                </div>
              ) : (
                <form onSubmit={submitBulk} className="space-y-4">
                  <div><Label htmlFor="employee-list-role">Role</Label><select id="employee-list-role" className="w-full border rounded-md p-2 bg-background" value={role} onChange={(e) => setRole(e.target.value)}>{roleOptions.map((r) => <option key={r} value={r}>{roleLabels[r] || r}</option>)}</select></div>
                  <div><Label htmlFor="employee-list-position">Position</Label><select id="employee-list-position" className="w-full border rounded-md p-2 bg-background" value={position} onChange={(e) => selectPosition(e.target.value)}>{positions.filter((p) => p !== "Borough Director" || actor?.position === "Borough Director").map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
                  {developmentSelector}
                   {actor?.role === "human_resources" && <label className="flex items-center gap-2 text-sm"><Checkbox checked={waitingForDocuments} onCheckedChange={(checked) => setWaitingForDocuments(checked === true)} /><span>Waiting for documents</span></label>}
                  <div className="space-y-2">
                    <Label htmlFor="employee-list">Employee list</Label>
                    <Input id="employee-list" type="file" accept=".csv,.txt,text/csv,text/plain" onChange={uploadEmployeeList} disabled={bulkCreating} />
                    {bulkFileName && <p className="text-sm text-muted-foreground">{bulkFileName} · {bulkNames.length} employees</p>}
                  </div>
                  {bulkCreating && <p className="text-sm">Creating {bulkResults.length + 1} of {bulkNames.length}...</p>}
                  {actionError && <p className="text-sm text-destructive">{actionError}</p>}
                  <DialogFooter><Button type="button" variant="outline" onClick={closeForm} disabled={bulkCreating}>Cancel</Button><Button type="submit" disabled={bulkCreating || !bulkNames.length}><Upload className="mr-2 h-4 w-4" />{bulkCreating ? "Creating..." : "Create employees"}</Button></DialogFooter>
                </form>
              )}
            </div>}
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(resetTarget)} onOpenChange={(value) => { if (!value) setResetTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset access code</DialogTitle>
            <DialogDescription>
              Generate a new four-digit code for {resetTarget?.name}. Their old code will stop working.
            </DialogDescription>
          </DialogHeader>
          {actionError && <p className="text-sm text-destructive">{actionError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setResetTarget(null)}>Cancel</Button>
            <Button type="button" onClick={resetCode} disabled={reset.isPending}>
              {reset.isPending ? "Saving..." : "Generate code"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {actionError && !open && <p className="text-sm text-destructive">{actionError}</p>}
    </div>
  );
}