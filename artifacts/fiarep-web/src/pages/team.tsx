import {
  StaffPosition,
  StaffInputRole,
  StaffRole,
  useCreateStaff,
  useDeleteStaff,
  useListStaff,
  useResetStaffCode,
  useRevokeStaff,
  useListStaffDevelopments,
  getListStaffQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { UsersRound, Search, Copy, Plus, KeyRound, UserX, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";

const positions = Object.values(StaffPosition);
const allRoles = Object.values(StaffRole).filter((r) => r !== "resident");
const roleLabels: Record<string, string> = {
  administrator: "Administrator", management: "Management", worker: "Worker",
  inspector: "Inspector", procurement: "Procurement", vendor: "Vendor",
  resident: "Resident", emergency: "Emergency",
};

function errorMessage(error: unknown) {
  const e = error as { data?: { error?: string }; message?: string } | undefined;
  return e?.data?.error || e?.message || "The request could not be completed.";
}

export default function Team() {
  const { staff: actor } = useAuth();
  const queryClient = useQueryClient();
  const { data: staff, isLoading, error } = useListStaff();
  const {
    data: availableDevelopments,
    isLoading: developmentsLoading,
    error: developmentsError,
    refetch: refetchDevelopments,
  } = useListStaffDevelopments();
  const create = useCreateStaff();
  const reset = useResetStaffCode();
  const revoke = useRevokeStaff();
  const deleteStaff = useDeleteStaff();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState<string>("worker");
  const [position, setPosition] = useState<string>("Staff Worker");
  const [developments, setDevelopments] = useState<string[]>([]);
  const [developmentsOpen, setDevelopmentsOpen] = useState(false);
  const [customCode, setCustomCode] = useState("");
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [issuedRole, setIssuedRole] = useState<string>("");
  const [issuedEmployee, setIssuedEmployee] = useState<string>("");
  const [actionError, setActionError] = useState("");
  const [resetTarget, setResetTarget] = useState<{ id: string; name: string; role: string } | null>(null);
  const [replacementCode, setReplacementCode] = useState("");

  const roleOptions = useMemo(() => {
    if (!actor) return [];
    if (actor.position === "Borough Director") return allRoles;
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

  const filtered = staff?.filter((member) => {
    const q = search.toLowerCase();
    return !q || [member.name, member.role, member.position].some((v) => v.toLowerCase().includes(q));
  }).sort((a, b) => a.name.localeCompare(b.name));

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: getListStaffQueryKey() });
  }
  function openAddEmployee() {
    void refetchDevelopments();
    setRole(roleOptions[0] ?? "worker");
    setPosition("Staff Worker");
    setName("");
    setDevelopments([]);
    setDevelopmentsOpen(false);
    setCustomCode("");
    setIssuedCode(null);
    setIssuedRole("");
    setIssuedEmployee("");
    setActionError("");
    setOpen(true);
  }
  function closeForm() {
    setOpen(false); setName(""); setRole(roleOptions[0] ?? "worker"); setPosition("Staff Worker");
    setCustomCode(""); setDevelopments([]); setDevelopmentsOpen(false);
    setIssuedCode(null); setIssuedRole(""); setIssuedEmployee(""); setActionError("");
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setActionError("");
    if (actor?.position !== "Borough Director" && developments.length === 0) {
      setActionError("Select at least one assigned development.");
      return;
    }
    try {
      const result = await create.mutateAsync({
        data: {
          name: name.trim(), role: role as typeof StaffInputRole[keyof typeof StaffInputRole],
          position: position as typeof StaffPosition[keyof typeof StaffPosition],
          developments,
          ...(customCode.trim() ? { code: customCode.trim().toUpperCase() } : {}),
        },
      });
      setIssuedCode(result.code); setIssuedRole(role); setIssuedEmployee(name.trim()); await refresh();
    } catch (e) { setActionError(errorMessage(e)); }
  }
  async function resetCode() {
    if (!resetTarget) return;
    setActionError("");
    try {
      const result = await reset.mutateAsync({
        id: resetTarget.id,
        ...(replacementCode.trim() ? { data: { code: replacementCode.trim().toUpperCase() } } : {}),
      });
      setResetTarget(null);
      setReplacementCode("");
      setIssuedCode(result.code);
      setIssuedRole(resetTarget.role);
      setIssuedEmployee(resetTarget.name);
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
    if (!window.confirm(`Permanently delete ${memberName}? This removes the account and signs it out on every device. This cannot be undone.`)) return;
    setActionError("");
    try {
      await deleteStaff.mutateAsync({ id });
      await refresh();
    } catch (e) { setActionError(errorMessage(e)); }
  }
  async function copyCode() {
    if (issuedCode) await navigator.clipboard?.writeText(issuedCode);
  }

  const authorityOrder = (member: NonNullable<typeof staff>[number]) =>
    member.position === "Borough Director" ? 0 : member.role === "administrator" ? 1 :
    member.role === "management" ? 2 : member.role === "procurement" ? 3 : 4;
  const sorted = filtered?.sort((a, b) => authorityOrder(a) - authorityOrder(b) || a.name.localeCompare(b.name));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div><h1 className="text-2xl font-bold tracking-tight">Team Directory</h1>
          <p className="text-muted-foreground text-sm">View staff directory and authority.</p></div>
        {canIssue && <Button onClick={openAddEmployee}><Plus className="mr-2 h-4 w-4" />Add Employee</Button>}
      </div>
      <div className="bg-card rounded-[14px] shadow-sm border border-border">
        <div className="p-4 border-b border-border"><div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input aria-label="Search team members" placeholder="Search team members..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div></div>
        <div className="p-4">
          {isLoading ? <div className="p-8 text-center text-muted-foreground">Loading team...</div> :
            error ? <div className="p-8 text-center text-destructive">{errorMessage(error)}</div> :
            sorted?.length === 0 ? <div className="p-12 text-center flex flex-col items-center"><UsersRound className="w-12 h-12 text-muted-foreground/30 mb-4" /><h3 className="text-lg font-bold">No team members found</h3></div> :
            <div className="grid gap-3">{sorted?.map((member) => <div key={member.id} className="flex items-center gap-4 p-4 rounded-xl border border-border">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#3d6fa8] to-[#185FA5] text-white grid place-items-center font-bold text-sm shrink-0">{member.name.split(" ").map((n) => n[0]).join("").substring(0, 2).toUpperCase()}</div>
              <div className="flex-1 min-w-0"><h4 className="font-bold truncate">{member.name}</h4><div className="text-sm text-muted-foreground">{member.position}</div><div className="text-xs text-muted-foreground">{member.developments.join(", ") || "All assigned developments"}</div></div>
              <div className="text-right shrink-0"><div className="text-[13px] font-semibold bg-secondary px-2.5 py-1 rounded-full inline-block">{roleLabels[member.role] || member.role}</div><div className="text-xs text-muted-foreground capitalize">{member.status}</div>
                {(member.canResetCode || member.canRevoke || member.canDelete) && <div className="flex flex-wrap gap-2 mt-2 justify-end">
                  {member.canResetCode && member.status !== "revoked" && <Button size="sm" variant="outline" onClick={() => { setResetTarget({ id: member.id, name: member.name, role: member.role }); setReplacementCode(""); }}><KeyRound className="mr-1 h-3 w-3" />Reset code</Button>}
                  {member.canRevoke && member.status !== "revoked" && <Button size="sm" variant="destructive" onClick={() => revokeAccount(member.id, member.name)}><UserX className="mr-1 h-3 w-3" />Revoke</Button>}
                  {member.canDelete && <Button size="sm" variant="destructive" onClick={() => deleteAccount(member.id, member.name)} disabled={deleteStaff.isPending}><Trash2 className="mr-1 h-3 w-3" />Delete</Button>}
                </div>}
              </div>
            </div>)}</div>}
        </div>
      </div>
      <Dialog open={open} onOpenChange={(v) => !v && closeForm()}>
        <DialogContent><DialogHeader><DialogTitle>{issuedCode ? "One-time access code" : "Add Employee"}</DialogTitle><DialogDescription>{issuedCode ? `Replacement credentials for ${issuedEmployee}.` : "Issue a staff account. The access code is shown only once."}</DialogDescription></DialogHeader>
          {issuedCode ? <div className="space-y-4"><div className="rounded-md bg-muted p-4 text-center"><p className="text-sm font-medium">{issuedRole && issuedRole !== "reset" ? `${roleLabels[issuedRole] || issuedRole} credentials` : "Replacement credentials"}</p><p className="text-3xl font-bold tracking-[0.4em] my-2">{issuedCode}</p><Button variant="outline" onClick={copyCode}><Copy className="mr-2 h-4 w-4" />Copy code</Button></div><p className="text-sm text-destructive">Give this code securely to {issuedEmployee || "the employee"}. It will not be displayed again. {issuedRole === "procurement" && "Procurement employees sign in at /procurement/login."}</p><DialogFooter><Button onClick={closeForm}>Done</Button></DialogFooter></div> :
            <form onSubmit={submit} className="space-y-4"><div><Label htmlFor="employee-name">Name</Label><Input id="employee-name" required value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div><Label htmlFor="employee-role">Role</Label><select id="employee-role" className="w-full border rounded-md p-2 bg-background" value={role} onChange={(e) => setRole(e.target.value)}>{roleOptions.map((r) => <option key={r} value={r}>{roleLabels[r] || r}</option>)}</select></div>
              <div><Label htmlFor="employee-position">Position</Label><select id="employee-position" className="w-full border rounded-md p-2 bg-background" value={position} onChange={(e) => setPosition(e.target.value)}>{positions.filter((p) => p !== "Borough Director" || actor?.position === "Borough Director").map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
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
              <div><Label htmlFor="employee-code">Custom code (optional)</Label><Input id="employee-code" maxLength={4} pattern="[A-Za-z0-9]{4}" value={customCode} onChange={(e) => setCustomCode(e.target.value.toUpperCase())} placeholder="Server generates one" /></div>
              {actionError && <p className="text-sm text-destructive">{actionError}</p>}<DialogFooter><Button type="button" variant="outline" onClick={closeForm}>Cancel</Button><Button type="submit" disabled={create.isPending}>{create.isPending ? "Creating..." : "Create employee"}</Button></DialogFooter>
            </form>}
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(resetTarget)} onOpenChange={(value) => { if (!value) { setResetTarget(null); setReplacementCode(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset access code</DialogTitle>
            <DialogDescription>
              Enter a custom four-character code for {resetTarget?.name}, or leave it blank and the server will generate one. Their old code will stop working.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="replacement-employee-code">Custom code (optional)</Label>
            <Input
              id="replacement-employee-code"
              maxLength={4}
              pattern="[A-Za-z0-9]{4}"
              value={replacementCode}
              onChange={(event) => setReplacementCode(event.target.value.toUpperCase())}
              placeholder="Generate automatically"
            />
            <p className="text-xs text-muted-foreground">Use exactly four letters or numbers when entering a custom code.</p>
          </div>
          {actionError && <p className="text-sm text-destructive">{actionError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setResetTarget(null); setReplacementCode(""); }}>Cancel</Button>
            <Button type="button" onClick={resetCode} disabled={reset.isPending || (replacementCode.length > 0 && replacementCode.length !== 4)}>
              {reset.isPending ? "Saving..." : replacementCode ? "Set custom code" : "Generate code"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {actionError && !open && <p className="text-sm text-destructive">{actionError}</p>}
    </div>
  );
}