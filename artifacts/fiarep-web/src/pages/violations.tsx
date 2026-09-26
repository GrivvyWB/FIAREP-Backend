import { isInspectionSupervisorTitle } from "@/lib/titles";
import { useState } from "react";
import { GenericEntityPage } from "@/components/layout/generic-entity-page";
import { AlertTriangle, Search, Building2, FileWarning, AlertCircle, Send } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { canApproveWork } from "@/lib/access-policy";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getLookupNycPropertyQueryKey, useLookupNycProperty, getListEntityRecordsQueryKey, useListEntityRecords, useCreateEntityRecord, useListStaff, getListStaffQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

export default function Violations() {
  const { staff } = useAuth();
  const { toast } = useToast();
  const [searchInput, setSearchInput] = useState("");
  const [addressToSearch, setAddressToSearch] = useState("");
  const [assignmentDraft, setAssignmentDraft] = useState({ development: "", address: "", instructions: "", assignedStaffId: "" });
  const [selectedAssignment, setSelectedAssignment] = useState<any>(null);
  const [linkedViolation, setLinkedViolation] = useState({ number: "", notes: "" });
  const assignmentFilter = staff?.role === "inspector" && staff.position === "Inspector"
    ? { assignedStaffId: staff.id } as any
    : undefined;
  const assignmentsQuery = useListEntityRecords("route-assignments", assignmentFilter, {
    query: {
      queryKey: getListEntityRecordsQueryKey("route-assignments", assignmentFilter),
      enabled: (staff?.role === "management" && isInspectionSupervisorTitle(staff?.position)) ||
        (staff?.role === "inspector" && staff.position === "Inspector"),
      refetchInterval: 15_000,
      refetchOnMount: "always",
    },
  });
  const { data: approvedInspectors = [] } = useListStaff({ status: "approved" }, {
    query: { queryKey: getListStaffQueryKey({ status: "approved" }), enabled: staff?.role === "management" && isInspectionSupervisorTitle(staff?.position) },
  });
  const createAssignment = useCreateEntityRecord();
  const canAssignInspectors = staff?.role === "management" && isInspectionSupervisorTitle(staff?.position);
  const inspectorsFor = (development?: string | null) => approvedInspectors.filter((member) =>
    member.role === "inspector" && member.position === "Inspector" && Boolean(development) &&
    member.developments.includes(development || ""),
  );
  async function assignInspector() {
    const inspectorId = assignmentDraft.assignedStaffId;
    if (!inspectorId || !assignmentDraft.development.trim() || !assignmentDraft.address.trim() || !assignmentDraft.instructions.trim()) {
      toast({
        variant: "destructive",
        title: "Instructions required",
        description: "Add assignment instructions before assigning an Inspector.",
      });
      return;
    }
    const clientRequestId = [assignmentDraft.development, assignmentDraft.address, inspectorId, assignmentDraft.instructions]
      .map((value) => value.trim().toLowerCase().replace(/\s+/g, "-")).join(":");
    const duplicate = (assignmentsQuery.data || []).some((assignment) =>
      (assignment.state as any)?.clientRequestId === clientRequestId,
    );
    if (duplicate) {
      toast({ variant: "destructive", title: "Inspector already assigned", description: "This violation already has that durable assignment." });
      return;
    }
    try {
      await createAssignment.mutateAsync({
        entity: "route-assignments",
        data: {
          id: `route-assignment:${clientRequestId}`,
          version: 1,
          development: assignmentDraft.development.trim(),
          state: {
            assignmentKind: "violation-inspection",
            clientRequestId,
            address: assignmentDraft.address.trim(),
            location: assignmentDraft.address.trim(),
            instructions: assignmentDraft.instructions.trim(),
            assignedStaffId: inspectorId,
            development: assignmentDraft.development.trim(),
            status: "pending",
          },
        },
      });
      await assignmentsQuery.refetch();
      setAssignmentDraft({ development: "", address: "", instructions: "", assignedStaffId: "" });
      toast({ title: "Violation assigned to Inspector" });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Unable to assign Inspector", description: error?.message || "The server rejected this assignment." });
    }
  }
  const inspectorAssignments = (assignmentsQuery.data || []).filter((assignment) => {
    const state = assignment.state as any;
    return staff?.role === "inspector" && staff.position === "Inspector" &&
      state?.assignedStaffId === staff.id && ["pending", "assigned"].includes(String(state?.status || "pending"));
  });
  const createViolation = useCreateEntityRecord();
  async function createLinkedViolation() {
    if (!selectedAssignment || !linkedViolation.notes.trim()) return;
    const state = selectedAssignment.state as any;
    try {
      await createViolation.mutateAsync({
        entity: "building-violations",
        data: {
          id: crypto.randomUUID(),
          version: 1,
          development: selectedAssignment.development,
          state: {
            status: "submitted",
            title: linkedViolation.number || "Inspector violation",
            violationNumber: linkedViolation.number,
            address: state.address || state.location,
            notes: linkedViolation.notes,
            instructions: state.instructions,
            routeAssignmentId: selectedAssignment.id,
          },
        },
      });
      await assignmentsQuery.refetch();
      setSelectedAssignment(null);
      setLinkedViolation({ number: "", notes: "" });
      toast({ title: "Linked violation submitted to Supervisor Inspector" });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Unable to create linked violation", description: error?.message || "The server rejected this violation." });
    }
  }

  const { data, isLoading, isError } = useLookupNycProperty(
    { address: addressToSearch, limit: 100 },
    {
      query: {
        enabled: !!addressToSearch,
        retry: false,
        queryKey: getLookupNycPropertyQueryKey({ address: addressToSearch, limit: 100 }),
      },
    },
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
      setAddressToSearch(searchInput.trim());
    }
  };

  return (
    <div className="space-y-12 pb-10">
      {/* NYC Property Lookup Section */}
      <section className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">NYC Property Lookup</h1>
            <p className="text-muted-foreground text-sm">Query official NYC property records and live violations.</p>
          </div>
          {canApproveWork(staff) && <Button asChild variant="outline"><Link href="/trade-requests"><Send className="mr-2 h-4 w-4" />Trade Request</Link></Button>}
        </div>

        <Card className="border-border shadow-sm">
          <CardContent className="p-4 sm:p-6">
            <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  placeholder="Search by NYC address (e.g. 150 E 42nd St)..."
                  className="pl-10 h-12 text-base"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  data-testid="input-nyc-address-search"
                />
              </div>
              <Button type="submit" disabled={isLoading || !searchInput.trim()} className="h-12 px-8 text-base font-semibold" data-testid="button-nyc-address-search">
                {isLoading ? "Searching..." : "Search"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {isError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Lookup Failed</AlertTitle>
            <AlertDescription>
              Could not retrieve property information. Please verify the address format and try again.
            </AlertDescription>
          </Alert>
        )}

        {data && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {data.warnings && data.warnings.length > 0 && (
              <Alert className="bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 border-amber-200 dark:border-amber-800">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <AlertTitle>Partial Information Warning</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-5 mt-2 text-sm space-y-1">
                    {data.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card className="md:col-span-2 lg:col-span-1 shadow-sm border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-primary" />
                    Property Identity
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-lg font-bold leading-tight mb-3">
                    {data.property.formattedAddress}
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 text-sm">
                    <span className="text-muted-foreground">BIN</span>
                    <span className="font-mono font-medium">{data.property.bin || "-"}</span>
                    <span className="text-muted-foreground">BBL</span>
                    <span className="font-mono font-medium">{data.property.bbl || "-"}</span>
                    <span className="text-muted-foreground">Block/Lot</span>
                    <span className="font-mono font-medium">{data.property.block || "-"}/{data.property.lot || "-"}</span>
                    <span className="text-muted-foreground">Borough</span>
                    <span className="font-medium capitalize">{data.property.borough.toLowerCase()}</span>
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-sm border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                    <FileWarning className="w-4 h-4 text-destructive" />
                    HPD Violations
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-black text-destructive tracking-tight">
                    {data.summary.openHpdViolations}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1 font-medium">
                    Open (of {data.summary.hpdViolations} total)
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-sm border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                    <FileWarning className="w-4 h-4 text-destructive" />
                    DOB Violations
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-black text-destructive tracking-tight">
                    {data.summary.openDobViolations}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1 font-medium">
                    Open (of {data.summary.dobViolations} total)
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-sm border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-500" />
                    HPD Complaints
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-black text-amber-600 dark:text-amber-500 tracking-tight">
                    {data.summary.hpdComplaints}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1 font-medium">
                    Recorded complaints
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="border-border shadow-sm overflow-hidden">
              <Tabs defaultValue="hpd-violations" className="w-full">
                <div className="px-4 pt-4 pb-0 border-b border-border overflow-x-auto bg-muted/10">
                  <TabsList className="bg-transparent h-auto p-0 border-b-0 space-x-6 w-max">
                    <TabsTrigger
                      value="hpd-violations"
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-1 pb-3 pt-1 font-semibold text-muted-foreground data-[state=active]:text-foreground group"
                    >
                      HPD Violations
                      <Badge variant="secondary" className="ml-2 bg-muted/50 group-data-[state=active]:bg-primary/10 group-data-[state=active]:text-primary">
                        {data.hpdViolations.length}
                      </Badge>
                    </TabsTrigger>
                    <TabsTrigger
                      value="dob-violations"
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-1 pb-3 pt-1 font-semibold text-muted-foreground data-[state=active]:text-foreground group"
                    >
                      DOB Violations
                      <Badge variant="secondary" className="ml-2 bg-muted/50 group-data-[state=active]:bg-primary/10 group-data-[state=active]:text-primary">
                        {data.dobViolations.length}
                      </Badge>
                    </TabsTrigger>
                    <TabsTrigger
                      value="hpd-complaints"
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-1 pb-3 pt-1 font-semibold text-muted-foreground data-[state=active]:text-foreground group"
                    >
                      HPD Complaints
                      <Badge variant="secondary" className="ml-2 bg-muted/50 group-data-[state=active]:bg-primary/10 group-data-[state=active]:text-primary">
                        {data.hpdComplaints.length}
                      </Badge>
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="hpd-violations" className="p-0 m-0 border-none outline-none">
                  {data.hpdViolations.length === 0 ? (
                    <div className="p-12 text-center text-muted-foreground flex flex-col items-center gap-3">
                      <FileWarning className="w-10 h-10 opacity-20" />
                      No HPD violations found for this property.
                    </div>
                  ) : (
                    <ScrollArea className="h-[400px]">
                      <Table>
                        <TableHeader className="bg-muted/30 sticky top-0 backdrop-blur z-10">
                          <TableRow>
                            <TableHead className="w-[120px]">ID</TableHead>
                            <TableHead className="w-[100px]">Class</TableHead>
                            <TableHead className="w-[120px]">Status</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead className="text-right w-[140px]">Inspection Date</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.hpdViolations.map((v) => (
                            <TableRow key={v.id}>
                              <TableCell className="font-mono text-xs">{v.id}</TableCell>
                              <TableCell>
                                {v.class ? (
                                  <Badge variant="outline" className="font-mono font-bold bg-background">{v.class}</Badge>
                                ) : '-'}
                              </TableCell>
                              <TableCell>
                                <Badge variant={v.status.toLowerCase() === 'open' ? 'destructive' : 'secondary'} className={v.status.toLowerCase() === 'open' ? '' : 'bg-muted/50 text-muted-foreground hover:bg-muted/50'}>
                                  {v.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="max-w-xl">
                                <p className="text-sm leading-relaxed" title={v.description}>{v.description}</p>
                                {v.apartment && <div className="text-xs text-muted-foreground mt-1 font-medium">Apt: {v.apartment}</div>}
                              </TableCell>
                              <TableCell className="text-right text-muted-foreground text-xs whitespace-nowrap">
                                {v.inspectionDate ? new Date(v.inspectionDate).toLocaleDateString() : '-'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  )}
                </TabsContent>

                <TabsContent value="dob-violations" className="p-0 m-0 border-none outline-none">
                  {data.dobViolations.length === 0 ? (
                    <div className="p-12 text-center text-muted-foreground flex flex-col items-center gap-3">
                      <FileWarning className="w-10 h-10 opacity-20" />
                      No DOB violations found for this property.
                    </div>
                  ) : (
                    <ScrollArea className="h-[400px]">
                      <Table>
                        <TableHeader className="bg-muted/30 sticky top-0 backdrop-blur z-10">
                          <TableRow>
                            <TableHead className="w-[140px]">ID / Number</TableHead>
                            <TableHead className="w-[120px]">Status</TableHead>
                            <TableHead className="w-[180px]">Type / Category</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead className="text-right w-[120px]">Issue Date</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.dobViolations.map((v) => (
                            <TableRow key={v.id}>
                              <TableCell className="font-mono text-xs">
                                <div>{v.id}</div>
                                {v.number && <div className="text-muted-foreground mt-1">{v.number}</div>}
                              </TableCell>
                              <TableCell>
                                <Badge variant={v.status.toLowerCase().includes('open') || v.status.toLowerCase().includes('active') ? 'destructive' : 'secondary'} className={v.status.toLowerCase().includes('open') || v.status.toLowerCase().includes('active') ? '' : 'bg-muted/50 text-muted-foreground hover:bg-muted/50'}>
                                  {v.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-sm">
                                <div className="font-medium">{v.type || '-'}</div>
                                {v.category && <div className="text-xs text-muted-foreground mt-0.5">{v.category}</div>}
                              </TableCell>
                              <TableCell className="max-w-xl">
                                <p className="text-sm leading-relaxed" title={v.description}>{v.description}</p>
                              </TableCell>
                              <TableCell className="text-right text-muted-foreground text-xs whitespace-nowrap">
                                {v.issueDate ? new Date(v.issueDate).toLocaleDateString() : '-'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  )}
                </TabsContent>

                <TabsContent value="hpd-complaints" className="p-0 m-0 border-none outline-none">
                  {data.hpdComplaints.length === 0 ? (
                    <div className="p-12 text-center text-muted-foreground flex flex-col items-center gap-3">
                      <AlertCircle className="w-10 h-10 opacity-20" />
                      No HPD complaints found for this property.
                    </div>
                  ) : (
                    <ScrollArea className="h-[400px]">
                      <Table>
                        <TableHeader className="bg-muted/30 sticky top-0 backdrop-blur z-10">
                          <TableRow>
                            <TableHead className="w-[120px]">ID</TableHead>
                            <TableHead className="w-[140px]">Status</TableHead>
                            <TableHead className="w-[180px]">Category</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead className="text-right w-[120px]">Received</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.hpdComplaints.map((c) => (
                            <TableRow key={c.id}>
                              <TableCell className="font-mono text-xs">{c.id}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className={c.status.toLowerCase().includes('open') ? 'border-amber-500 text-amber-600 dark:text-amber-500 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30' : 'bg-muted/30 text-muted-foreground border-border'}>
                                  {c.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-sm">
                                <div className="font-medium">{c.majorCategory || '-'}</div>
                                {c.minorCategory && <div className="text-xs text-muted-foreground mt-0.5">{c.minorCategory}</div>}
                              </TableCell>
                              <TableCell className="max-w-xl">
                                <p className="text-sm leading-relaxed" title={c.description}>{c.description}</p>
                                {c.apartment && <div className="text-xs text-muted-foreground mt-1 font-medium">Apt: {c.apartment}</div>}
                              </TableCell>
                              <TableCell className="text-right text-muted-foreground text-xs whitespace-nowrap">
                                {c.receivedDate ? new Date(c.receivedDate).toLocaleDateString() : '-'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  )}
                </TabsContent>
              </Tabs>
              <CardFooter className="py-3 px-4 border-t border-border bg-muted/20 text-[11px] text-muted-foreground flex flex-col sm:flex-row justify-between items-center gap-2">
                <span>Data retrieved securely from official NYC open data sources.</span>
                <span>Last updated: {new Date(data.retrievedAt).toLocaleString()}</span>
              </CardFooter>
            </Card>
          </div>
        )}
      </section>

      <hr className="border-border" />

      {/* Internal Violations Management Section */}
      <section>
        {staff?.role === "inspector" && staff.position === "Inspector" && inspectorAssignments.length > 0 && <Card className="mb-6 border-primary/30">
          <CardHeader><CardTitle>Pending Inspector assignments</CardTitle></CardHeader>
          <CardContent className="space-y-3">{inspectorAssignments.map((assignment) => {
            const state = assignment.state as any;
            return <div key={assignment.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
              <div className="min-w-0 flex-1"><p className="font-medium">{state.address || state.location}</p><p className="text-sm text-muted-foreground">{assignment.development} · {state.instructions || "No instructions"}</p></div>
              <Button size="sm" onClick={() => setSelectedAssignment(assignment)}>Create linked violation</Button>
            </div>;
          })}</CardContent>
        </Card>}
        {canAssignInspectors && <Card className="mb-6 border-primary/30">
          <CardHeader><CardTitle>Inspector assignments</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Input placeholder="Development" value={assignmentDraft.development} onChange={(event) => setAssignmentDraft({ ...assignmentDraft, development: event.target.value, assignedStaffId: "" })} />
              <Input placeholder="Address / location" value={assignmentDraft.address} onChange={(event) => setAssignmentDraft({ ...assignmentDraft, address: event.target.value })} />
              <Textarea placeholder="Instructions" value={assignmentDraft.instructions} onChange={(event) => setAssignmentDraft({ ...assignmentDraft, instructions: event.target.value })} />
              <select className="h-10 rounded-md border px-2 text-sm" value={assignmentDraft.assignedStaffId} onChange={(event) => setAssignmentDraft({ ...assignmentDraft, assignedStaffId: event.target.value })}>
                <option value="">Select approved Inspector</option>
                {inspectorsFor(assignmentDraft.development).map((member) => <option key={member.id} value={member.id}>{member.name} · {member.position}</option>)}
              </select>
            </div>
            <Button onClick={assignInspector} disabled={!assignmentDraft.development.trim() || !assignmentDraft.address.trim() || !assignmentDraft.instructions.trim() || !assignmentDraft.assignedStaffId || createAssignment.isPending}>Assign Inspector</Button>
          </CardContent>
        </Card>}
        <GenericEntityPage
          entity="building-violations"
          title="Internal Violations"
          description="Manage recorded building violations within the FIAREP system."
          icon={AlertTriangle}
           workflow
        />
      </section>
      <Dialog open={Boolean(selectedAssignment)} onOpenChange={(open) => !open && setSelectedAssignment(null)}>
        <DialogContent><DialogHeader><DialogTitle>Create linked violation</DialogTitle></DialogHeader>
          <div className="space-y-3"><Input placeholder="Violation number (optional)" value={linkedViolation.number} onChange={(event) => setLinkedViolation({ ...linkedViolation, number: event.target.value })} /><Textarea placeholder="Violation notes" value={linkedViolation.notes} onChange={(event) => setLinkedViolation({ ...linkedViolation, notes: event.target.value })} /></div>
          <DialogFooter><Button variant="outline" onClick={() => setSelectedAssignment(null)}>Cancel</Button><Button onClick={createLinkedViolation} disabled={!linkedViolation.notes.trim() || createViolation.isPending}>Create violation</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
