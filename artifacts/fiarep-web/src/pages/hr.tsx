import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { format } from "date-fns";
import {
  getGetHrWorkspaceQueryKey,
  getListStaffQueryKey,
  useListStaffDevelopments,
  useCreateEntityRecord,
  useGetHrWorkspace,
  usePerformEntityAction,
  useUpdateEntityRecord,
  StaffPosition,
  type EntityRecord,
} from "@workspace/api-client-react";
import { 
  BriefcaseBusiness, Check, Clock3, Pencil, Plus, ShieldCheck,
  History, Search, FileText, User, AlertCircle, Folder, Mail, KeyRound
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { useAuth } from "@/hooks/use-auth";
import { useQueryClient } from "@tanstack/react-query";

const categories = [
  ["hr-employee-records", "Employee records"],
  ["hr-recruiting", "Recruiting"],
  ["hr-onboarding", "Onboarding"],
  ["hr-payroll-benefits", "Payroll and benefits"],
  ["hr-attendance", "Attendance"],
  ["hr-relations", "Employee relations"],
  ["hr-performance", "Performance"],
  ["hr-discipline", "Discipline"],
  ["hr-investigations", "Investigations"],
  ["hr-training-compliance", "Training and compliance"],
  ["hr-exits", "Exits"],
  ["hr-approvals", "Company approvals"],
] as const;

const employeePositions = Object.values(StaffPosition).filter(
  (position) => position !== "Other" && position !== "Borough Director",
);

type Category = typeof categories[number][0];
type Draft = {
  category: Category;
  employeeStaffId: string;
  title: string;
  details: string;
  development: string;
  targetRecordId: string;
  exitType: "termination" | "layoff";
};

type SectionField = {
  key: string;
  label: string;
  type?: "text" | "email" | "tel" | "date" | "datetime-local" | "number";
};

const sectionFields: Partial<Record<Category, readonly SectionField[]>> = {
  "hr-employee-records": [
    { key: "firstName", label: "First name" },
    { key: "lastName", label: "Last name" },
    { key: "email", label: "Email", type: "email" },
    { key: "phone", label: "Phone", type: "tel" },
    { key: "role", label: "Role" },
    { key: "position", label: "Position" },
    { key: "department", label: "Department" },
    { key: "hireDate", label: "Hire date", type: "date" },
    { key: "employmentStatus", label: "Status" },
    { key: "managerId", label: "Manager ID" },
  ],
  "hr-recruiting": [
    { key: "recordType", label: "Record type" },
    { key: "jobTitle", label: "Job title" },
    { key: "department", label: "Department" },
    { key: "location", label: "Location" },
    { key: "recruitingStatus", label: "Status" },
    { key: "postedDate", label: "Posted date", type: "date" },
    { key: "closingDate", label: "Closing date", type: "date" },
    { key: "applicantName", label: "Applicant name" },
    { key: "applicantEmail", label: "Applicant email", type: "email" },
  ],
  "hr-onboarding": [
    { key: "taskName", label: "Task name" },
    { key: "completed", label: "Completed" },
    { key: "dueDate", label: "Due date", type: "date" },
  ],
  "hr-payroll-benefits": [
    { key: "recordType", label: "Record type" },
    { key: "payPeriod", label: "Pay period" },
    { key: "grossPay", label: "Gross pay", type: "number" },
    { key: "taxes", label: "Taxes", type: "number" },
    { key: "netPay", label: "Net pay", type: "number" },
    { key: "benefitPlan", label: "Benefit plan" },
    { key: "enrollmentStatus", label: "Enrollment status" },
  ],
  "hr-attendance": [
    { key: "clockIn", label: "Clock in", type: "datetime-local" },
    { key: "clockOut", label: "Clock out", type: "datetime-local" },
    { key: "hoursWorked", label: "Hours worked", type: "number" },
  ],
  "hr-relations": [
    { key: "caseNumber", label: "Case number" },
    { key: "complaint", label: "Complaint" },
    { key: "caseStatus", label: "Status" },
    { key: "resolution", label: "Resolution" },
  ],
  "hr-performance": [
    { key: "reviewDate", label: "Review date", type: "date" },
    { key: "rating", label: "Rating", type: "number" },
    { key: "comments", label: "Comments" },
    { key: "goals", label: "Goals" },
  ],
  "hr-discipline": [
    { key: "actionType", label: "Action type" },
    { key: "description", label: "Description" },
    { key: "actionDate", label: "Action date", type: "date" },
    { key: "disciplineStatus", label: "Status" },
  ],
  "hr-investigations": [
    { key: "caseNumber", label: "Case number" },
    { key: "complaint", label: "Complaint" },
    { key: "investigator", label: "Investigator" },
    { key: "investigationStatus", label: "Status" },
    { key: "resolution", label: "Resolution" },
  ],
  "hr-training-compliance": [
    { key: "courseName", label: "Course name" },
    { key: "completionDate", label: "Completion date", type: "date" },
    { key: "expirationDate", label: "Expiration date", type: "date" },
    { key: "trainingStatus", label: "Status" },
  ],
};

const labelFor = (category: string) =>
  categories.find(([value]) => value === category)?.[1] || category;

function purposeForRow(row: EntityRecord): "pay-change" | "discipline" | "termination" | "layoff" | null {
  if (row.entity === "hr-payroll-benefits") return "pay-change";
  if (row.entity === "hr-discipline") return "discipline";
  if (row.entity === "hr-exits") {
    const exitType = String(row.state?.exitType || "").toLowerCase();
    if (exitType === "layoff") return "layoff";
    if (exitType === "termination") return "termination";
  }
  return null;
}

function canCloseRow(row: EntityRecord, status: string, role: string | undefined) {
  if (!["human_resources", "administrator", "management"].includes(role || "")) return false;
  if (row.entity === "hr-approvals") return false;
  if (row.entity === "hr-payroll-benefits") return status === "approved";
  if (row.entity === "hr-discipline") return status === "disciplined";
  if (row.entity === "hr-exits") return ["terminated", "laid off"].includes(status);
  return ["in_progress", "approved", "disciplined", "terminated", "laid off"].includes(status);
}

function errorMessage(error: unknown) {
  const value = error as { data?: { error?: string }; message?: string } | undefined;
  return value?.data?.error || value?.message || "The request could not be completed.";
}

export default function HRWorkspace() {
  const { staff: actor } = useAuth();
  const queryClient = useQueryClient();
  const workspace = useGetHrWorkspace({
    query: { queryKey: getGetHrWorkspaceQueryKey(), refetchOnMount: "always" },
  });
  const { data: developmentOptions = [] } = useListStaffDevelopments();
  const create = useCreateEntityRecord();
  const update = useUpdateEntityRecord();
  const action = usePerformEntityAction();
  
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<{
    row: EntityRecord;
    action: string;
  } | null>(null);
  const [authorizationCode, setAuthorizationCode] = useState("");
  const [sectionValues, setSectionValues] = useState<Record<string, string>>({});
  const [assignedDevelopments, setAssignedDevelopments] = useState<string[]>([]);
  const [editingRecord, setEditingRecord] = useState<EntityRecord | null>(null);
  const [credentialBusy, setCredentialBusy] = useState("");
  
  const [view, setView] = useState<"records" | "audit">("records");
  const [filterProcess, setFilterProcess] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const form = useForm<Draft>({
    defaultValues: {
      category: actor?.role === "management" ? "hr-approvals" : "hr-employee-records",
      employeeStaffId: "",
      title: "",
      details: "",
      development: "",
      targetRecordId: "",
      exitType: "termination",
    },
  });
  const selectedCategory = form.watch("category");

  const rows = workspace.data?.records || [];
  const staff = workspace.data?.staff || [];
  const audit = workspace.data?.audit || [];
  const managementOnly = actor?.role === "management";
  const visibleCategories = useMemo(
    () => categories.filter(([category]) =>
      (managementOnly ? category === "hr-approvals" : category !== "hr-approvals" || actor?.role === "administrator")),
    [managementOnly, actor?.role],
  );
  const visibleRows = useMemo(
    () => managementOnly
      ? rows.filter((row) => row.entity === "hr-approvals" && String(row.state?.status || "").toLowerCase() === "pending")
      : rows,
    [managementOnly, rows],
  );
  
  const staffById = useMemo(() => new Map(staff.map((member) => [member.id, member])), [staff]);

  const counts = useMemo(() => visibleCategories.map(([category, label]) => ({
    category,
    label,
    count: visibleRows.filter((row) => row.entity === category).length,
  })), [visibleCategories, visibleRows]);

  const filteredRows = useMemo(() => {
    return visibleRows.filter((row) => {
      if (filterProcess !== "all" && row.entity !== filterProcess) return false;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const state = row.state || {};
        const employeeName = typeof state.employeeStaffId === "string" 
          ? staffById.get(state.employeeStaffId)?.name?.toLowerCase() 
          : "";
        const title = String(state.title || "").toLowerCase();
        const details = String(state.details || "").toLowerCase();
        const draftName = `${String(state.firstName || "")} ${String(state.lastName || "")}`.trim().toLowerCase();
        const employeeNumber = String(state.employeeNumber || "").toLowerCase();
        if (!employeeName?.includes(query) && !draftName.includes(query) && !employeeNumber.includes(query) && !title.includes(query) && !details.includes(query)) {
          return false;
        }
      }
      return true;
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [visibleRows, filterProcess, searchQuery, staffById]);

  const approvalTargets = useMemo(() => rows.filter((row) => {
    const status = String(row.state?.status || "").toLowerCase();
    return ["hr-payroll-benefits", "hr-discipline", "hr-exits"].includes(row.entity) &&
      ["draft", "in_progress"].includes(status) &&
      typeof row.state?.employeeStaffId === "string" &&
      Boolean(purposeForRow(row));
  }), [rows]);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetHrWorkspaceQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListStaffQueryKey({ status: "approved" }) }),
    ]);
  }

  async function submit(values: Draft) {
    setError("");
    try {
      const approvalTarget = values.category === "hr-approvals"
        ? rows.find((row) => row.id === values.targetRecordId)
        : undefined;
      const approvalPurpose = approvalTarget ? purposeForRow(approvalTarget) : null;
      if (values.category === "hr-approvals" && (!approvalTarget || !approvalPurpose)) {
        setError("Select a sensitive HR record for company approval.");
        return;
      }
      const sectionEntries = Object.entries(sectionValues)
        .map(([key, value]) => [key, value.trim()]);
      const sectionState = Object.fromEntries(
        editingRecord
          ? sectionEntries
          : sectionEntries.filter(([, value]) => value !== ""),
      );
      if (editingRecord) {
        const employeeDevelopments = values.category === "hr-employee-records"
          ? assignedDevelopments
          : undefined;
        await update.mutateAsync({
          entity: editingRecord.entity,
          id: editingRecord.id,
          data: {
            id: editingRecord.id,
            version: editingRecord.version,
            state: {
              title: values.title,
              details: values.details,
              development: employeeDevelopments?.length === 1
                ? employeeDevelopments[0]
                : values.development,
              ...sectionState,
              assignedDevelopments: employeeDevelopments,
            },
          },
        });
      } else {
        await create.mutateAsync({
          entity: values.category,
          data: {
            id: crypto.randomUUID(),
            version: 1,
            development: values.development || undefined,
            state: {
              employeeStaffId: approvalTarget
                ? approvalTarget.state.employeeStaffId
                : values.employeeStaffId || undefined,
              title: values.category === "hr-employee-records"
                ? `${sectionValues.firstName || ""} ${sectionValues.lastName || ""}`.trim()
                : values.title,
              details: values.details,
              ...sectionState,
              assignedDevelopments: values.category === "hr-employee-records"
                ? assignedDevelopments
                : undefined,
               emergencyTruckDriver: values.category === "hr-employee-records"
                 ? sectionValues.emergencyTruckDriver === "true"
                 : undefined,
              targetRecordId: approvalTarget?.id,
              approvalPurpose: approvalPurpose || undefined,
              exitType: values.category === "hr-exits" ? values.exitType : undefined,
            },
          },
        });
      }
      await refresh();
      form.reset({
        category: values.category,
        employeeStaffId: "",
        title: "",
        details: "",
        development: "",
        targetRecordId: "",
        exitType: "termination",
      });
      setSectionValues({});
      setAssignedDevelopments([]);
      setEditingRecord(null);
      setOpen(false);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function emailCode(staffId: string) {
    setCredentialBusy(staffId);
    setError("");
    try {
      const response = await fetch(`/api/v1/hr/staff/${encodeURIComponent(staffId)}/send-code`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("fiarep_access_token") || ""}` },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Unable to email the employee code.");
      }
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setCredentialBusy("");
    }
  }

  async function resetAndEmailCode(staffId: string) {
    setCredentialBusy(staffId);
    setError("");
    try {
      const response = await fetch(`/api/v1/staff/${encodeURIComponent(staffId)}/reset-code`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("fiarep_access_token") || ""}` },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Unable to replace the employee code.");
      }
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setCredentialBusy("");
    }
  }

  async function perform(row: EntityRecord, nextAction: string, code?: string) {
    setError("");
    try {
      await action.mutateAsync({
        entity: row.entity,
        id: row.id,
        action: nextAction,
        data: code ? { authorizationCode: code } : undefined,
      });
      await refresh();
      setConfirmation(null);
      setAuthorizationCode("");
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  function requestAction(row: EntityRecord, nextAction: string) {
    if (actor?.role === "human_resources" && [
      "approve-pay-change",
      "approve-discipline",
      "approve-termination",
      "approve-layoff",
    ].includes(nextAction)) {
      setAuthorizationCode("");
      setConfirmation({ row, action: nextAction });
      return;
    }
    void perform(row, nextAction);
  }

  function selectProcess(category: Category | "all") {
    setFilterProcess(category);
    setView("records");
    setSearchQuery("");
    if (category !== "all") form.setValue("category", category);
  }

  function openCreateRecord() {
    const fallback = visibleCategories[0]?.[0] ?? "hr-employee-records";
    const category = filterProcess !== "all" &&
      visibleCategories.some(([value]) => value === filterProcess)
      ? filterProcess as Category
      : fallback;
    setError("");
    setEditingRecord(null);
    setSectionValues({});
    setAssignedDevelopments([]);
    form.reset({
      category,
      employeeStaffId: "",
      title: "",
      details: "",
      development: "",
      targetRecordId: "",
      exitType: "termination",
    });
    setOpen(true);
  }

  function openEditRecord(row: EntityRecord) {
    const category = row.entity as Category;
    const state = row.state || {};
    setError("");
    setEditingRecord(row);
    const linkedStaffId = typeof state.employeeStaffId === "string" ? state.employeeStaffId : "";
    const savedDevelopments = Array.isArray(state.assignedDevelopments)
      ? state.assignedDevelopments.filter((value): value is string => typeof value === "string")
      : staffById.get(linkedStaffId)?.developments || (row.development ? [row.development] : []);
    setAssignedDevelopments(savedDevelopments);
    setSectionValues({
      ...Object.fromEntries(
      (sectionFields[category] || []).map((field) => [
        field.key,
        state[field.key] === undefined || state[field.key] === null
          ? ""
          : String(state[field.key]),
      ])),
      emergencyTruckDriver: state.emergencyTruckDriver === true ? "true" : "",
    });
    form.reset({
      category,
      employeeStaffId: typeof state.employeeStaffId === "string" ? state.employeeStaffId : "",
      title: typeof state.title === "string" ? state.title : "",
      details: typeof state.details === "string" ? state.details : "",
      development: row.development || "",
      targetRecordId: "",
      exitType: state.exitType === "layoff" ? "layoff" : "termination",
    });
    setOpen(true);
  }

  return (
    <div className="flex h-full flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">HR Workspace</h1>
          <p className="text-muted-foreground text-sm">Employee lifecycle administration and approvals.</p>
        </div>
        <Button data-testid="button-create-hr-record" onClick={openCreateRecord}>
          <Plus className="mr-2 h-4 w-4" />Create record
        </Button>
      </div>

      {workspace.isLoading && <div className="py-20 text-center text-muted-foreground" data-testid="status-hr-loading">Loading HR workspace...</div>}
      {workspace.isError && <div className="py-20 text-center text-destructive" data-testid="status-hr-error">{errorMessage(workspace.error)}</div>}
      {error && <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive" data-testid="status-hr-action-error">{error}</div>}

      {!workspace.isLoading && !workspace.isError && (
        <div className="flex flex-col md:flex-row gap-6 items-start">
          {/* Sidebar / Filters */}
          <div className="w-full md:w-64 shrink-0 flex flex-col gap-4">
            <div className="rounded-xl border border-border bg-card p-2 flex flex-col gap-1 shadow-sm">
              <button
                 onClick={() => selectProcess("all")}
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors ${filterProcess === "all" ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
                data-testid="filter-hr-process-all"
              >
                <span>All processes</span>
                <span className="bg-background rounded-full px-2 py-0.5 text-xs border">{rows.length}</span>
              </button>
              {counts.map((item) => (
                <button
                  key={item.category}
                  onClick={() => selectProcess(item.category)}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors ${filterProcess === item.category ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
                  data-testid={`filter-hr-process-${item.category}`}
                >
                  <span className="truncate mr-2">{item.label}</span>
                  {item.count > 0 && (
                    <span className="bg-background rounded-full px-2 py-0.5 text-xs border">{item.count}</span>
                  )}
                </button>
              ))}
            </div>
            
            <div className="rounded-xl border border-border bg-card p-4 space-y-4 shadow-sm">
              <h3 className="font-semibold text-sm">Quick Stats</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="space-y-1">
                  <div className="text-muted-foreground text-xs">Total Staff</div>
                  <div className="font-medium">{staff.length}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-muted-foreground text-xs">Open Records</div>
                <div className="font-medium">{visibleRows.filter(r => !["completed", "approved", "closed", "consumed"].includes(String(r.state?.status || "").toLowerCase())).length}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Main Content Area */}
          <div className="flex-1 min-w-0 flex flex-col gap-4 w-full">
            
            {/* Header controls */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center p-1 bg-muted rounded-lg shrink-0">
                <button
                  onClick={() => setView("records")}
                  className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-all ${view === "records" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  data-testid="tab-records"
                >
                  <FileText className="w-4 h-4" />
                  Records
                </button>
                <button
                  onClick={() => setView("audit")}
                  className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-all ${view === "audit" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  data-testid="tab-audit"
                >
                  <History className="w-4 h-4" />
                  Audit History
                </button>
              </div>

              {view === "records" && (
                <div className="relative w-full sm:w-64 shrink-0">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search records..."
                    className="pl-9 h-9 bg-card"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    data-testid="input-hr-search"
                  />
                </div>
              )}
            </div>

            {/* List / Table */}
            <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden min-h-[400px]">
              {view === "records" ? (
                <div className="flex flex-col">
                  {filteredRows.length === 0 ? (
                    <div className="py-16 text-center text-muted-foreground flex flex-col items-center gap-3">
                      <Folder className="w-10 h-10 opacity-20" />
                      <p data-testid="status-hr-empty">No HR records found.</p>
                    </div>
                  ) : (
                    filteredRows.map((row) => {
                      const state = row.state || {};
                      const employee = typeof state.employeeStaffId === "string"
                        ? staffById.get(state.employeeStaffId)?.name
                        : undefined;
                      const status = String(state.status || "draft").toLowerCase();
                      const sensitive = row.entity === "hr-payroll-benefits"
                        ? "approve-pay-change"
                        : row.entity === "hr-discipline"
                          ? "approve-discipline"
                          : row.entity === "hr-exits" && String(state.exitType || "").toLowerCase() === "layoff"
                            ? "approve-layoff"
                            : row.entity === "hr-exits" ? "approve-termination" : "";
                      
                      const statusColor = 
                        status === "completed" || status === "approved" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20" :
                        status === "rejected" || status === "failed" ? "bg-destructive/10 text-destructive border-destructive/20" :
                        "bg-primary/10 text-primary border-primary/20";

                      return (
                        <div key={row.id} className="group border-b border-border last:border-b-0 p-4 hover:bg-muted/30 transition-colors" data-testid={`card-hr-record-${row.id}`}>
                          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                            <div className="flex items-start gap-4 flex-1 min-w-0">
                              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-secondary border border-border/50 text-muted-foreground">
                                <BriefcaseBusiness className="h-5 w-5" />
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 mb-1.5">
                                  <h3 className="font-semibold text-sm truncate">{String(state.title || labelFor(row.entity))}</h3>
                                  <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium border ${statusColor}`} data-testid={`status-hr-record-${row.id}`}>
                                    {status.replaceAll("_", " ")}
                                  </span>
                                </div>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                  <span className="font-medium text-foreground/80">{labelFor(row.entity)}</span>
                                  {employee && (
                                    <span className="flex items-center gap-1">
                                      <span className="w-1 h-1 rounded-full bg-border"></span>
                                      <User className="w-3 h-3" />
                                      {employee}
                                    </span>
                                  )}
                                  {typeof state.development === "string" && state.development && (
                                    <span className="flex items-center gap-1">
                                      <span className="w-1 h-1 rounded-full bg-border"></span>
                                      {state.development}
                                    </span>
                                  )}
                                  <span className="flex items-center gap-1" title={format(new Date(row.createdAt), "PPp")}>
                                    <span className="w-1 h-1 rounded-full bg-border"></span>
                                    <Clock3 className="w-3 h-3" />
                                    {format(new Date(row.createdAt), "MMM d, yyyy")}
                                  </span>
                                </div>
                                {typeof state.details === "string" && state.details && (
                                  <p className="mt-2 text-sm text-foreground/80 line-clamp-2">{state.details}</p>
                                )}
                                 <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                   {(sectionFields[row.entity as Category] || []).map((sectionField) => {
                                     const value = state[sectionField.key];
                                     if (value === undefined || value === null || String(value).trim() === "") return null;
                                     return (
                                       <span key={sectionField.key}>
                                         <span className="font-medium text-foreground/80">{sectionField.label}:</span>{" "}
                                         {String(value)}
                                       </span>
                                     );
                                   })}
                                 </div>
                              </div>
                            </div>
                            
                              <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:self-start">
                               {row.entity === "hr-employee-records" && typeof state.employeeStaffId === "string" && (() => {
                                 const member = staffById.get(state.employeeStaffId) as (typeof staff[number] & {
                                   code?: string;
                                   codeVisibleUntil?: string;
                                 }) | undefined;
                                 if (!member) return null;
                                  const emailCoolingDown = Boolean(member.codeEmailedAt &&
                                    new Date(member.codeEmailedAt).getTime() + 24 * 60 * 60 * 1000 > Date.now());
                                  return member.code ? (
                                   <>
                                     <span className="rounded-md border px-2 py-1 font-mono text-sm font-bold">{member.code}</span>
                                      <Button size="sm" variant="outline" onClick={() => emailCode(member.id)} disabled={credentialBusy === member.id || emailCoolingDown} className={emailCoolingDown ? "text-muted-foreground" : undefined}>
                                       <Mail className="mr-1.5 h-3.5 w-3.5" />Email code
                                     </Button>
                                      {emailCoolingDown && <span className="text-xs text-muted-foreground">Next email in 24 hrs for code</span>}
                                   </>
                                 ) : (
                                    <>
                                      <Button size="sm" variant="outline" onClick={() => resetAndEmailCode(member.id)} disabled={credentialBusy === member.id || emailCoolingDown} className={emailCoolingDown ? "text-muted-foreground" : undefined}>
                                        <KeyRound className="mr-1.5 h-3.5 w-3.5" />New code
                                      </Button>
                                      {emailCoolingDown && <span className="text-xs text-muted-foreground">Next email in 24 hrs for code</span>}
                                    </>
                                 );
                               })()}
                                {actor?.role === "human_resources" && row.entity !== "hr-approvals" && (
                                 <Button size="sm" variant="outline" data-testid={`button-edit-hr-record-${row.id}`} onClick={() => openEditRecord(row)}>
                                   <Pencil className="mr-1.5 h-3.5 w-3.5" />
                                    Edit
                                 </Button>
                               )}
                               {status === "draft" && row.entity !== "hr-employee-records" && (
                                <Button size="sm" variant="outline" data-testid={`button-advance-hr-record-${row.id}`} onClick={() => requestAction(row, "advance")} disabled={action.isPending}>
                                  Advance
                                </Button>
                              )}
                              {sensitive && ["draft", "in_progress"].includes(status) && actor?.role === "human_resources" && (
                                <Button size="sm" data-testid={`button-approve-hr-record-${row.id}`} onClick={() => requestAction(row, sensitive)} disabled={action.isPending}>
                                  <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                                  Approve
                                </Button>
                              )}
                              {row.entity === "hr-approvals" && status === "pending" && actor?.role !== "human_resources" && (
                                <Button size="sm" data-testid={`button-company-approve-${row.id}`} onClick={() => requestAction(row, "approve")} disabled={action.isPending}>
                                  <Check className="mr-1.5 h-3.5 w-3.5" />
                                  Approve
                                </Button>
                              )}
                              {canCloseRow(row, status, actor?.role) && (
                                <Button size="sm" variant="outline" data-testid={`button-close-hr-record-${row.id}`} onClick={() => requestAction(row, "close")} disabled={action.isPending}>
                                  Close
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        <th className="px-4 py-3 font-medium text-muted-foreground w-40">Time</th>
                        <th className="px-4 py-3 font-medium text-muted-foreground w-48">Actor</th>
                        <th className="px-4 py-3 font-medium text-muted-foreground w-40">Action</th>
                        <th className="px-4 py-3 font-medium text-muted-foreground">Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audit.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-4 py-16 text-center text-muted-foreground">
                            <div className="flex flex-col items-center gap-3">
                              <History className="w-10 h-10 opacity-20" />
                              <p data-testid="status-hr-audit-empty">No audit history found.</p>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        audit.map((entry) => (
                          <tr key={entry.id} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors" data-testid={`row-hr-audit-${entry.id}`}>
                            <td className="px-4 py-3 whitespace-nowrap text-muted-foreground font-mono text-xs">
                              {format(new Date(entry.at), "MMM d, yyyy HH:mm")}
                            </td>
                            <td className="px-4 py-3">
                              <div className="font-medium text-foreground">{entry.actorName}</div>
                              <div className="text-[11px] text-muted-foreground capitalize">{entry.actorRole.replace(/_/g, ' ')}</div>
                            </td>
                            <td className="px-4 py-3 font-medium text-foreground/90">
                              <span className="bg-secondary/70 border border-border/50 px-2 py-0.5 rounded-md text-xs">{entry.action}</span>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground max-w-lg truncate" title={entry.detail}>
                              {entry.detail}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={(value) => {
        setOpen(value);
        if (!value) setEditingRecord(null);
      }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingRecord?.entity === "hr-employee-records" ? "Complete employee record" : editingRecord ? "Edit HR record" : "Create HR record"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
              <FormField control={form.control} name="category" render={({ field }) => (
                <FormItem>
                  <FormLabel>Process</FormLabel>
                  <FormControl>
                    <select {...field} disabled={Boolean(editingRecord)} onChange={(event) => {
                      field.onChange(event);
                      setSectionValues({});
                    }} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70" data-testid="select-hr-process">
                      {visibleCategories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              {(sectionFields[selectedCategory] || []).map((sectionField) => (
                <div key={sectionField.key} className="space-y-2">
                  <Label htmlFor={`hr-field-${sectionField.key}`}>{sectionField.label}</Label>
                  {sectionField.key === "role" ? (
                    <select
                      id="hr-field-role"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={sectionValues.role || ""}
                      disabled={selectedCategory === "hr-employee-records" &&
                        Boolean(editingRecord) &&
                        !editingRecord?.state.employeeStaffId}
                      onChange={(event) => setSectionValues((current) => ({
                        ...current,
                        role: event.target.value,
                      }))}
                      required
                    >
                      <option value="">Select role</option>
                      <option value="management">Management</option>
                      <option value="worker">Worker</option>
                      <option value="inspector">Inspector</option>
                      <option value="procurement">Procurement</option>
                      <option value="emergency">Emergency</option>
                    </select>
                  ) : sectionField.key === "position" ? (
                    <select
                      id="hr-field-position"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={sectionValues.position || ""}
                      disabled={selectedCategory === "hr-employee-records" &&
                        Boolean(editingRecord) &&
                        !editingRecord?.state.employeeStaffId}
                      onChange={(event) => setSectionValues((current) => ({
                        ...current,
                        position: event.target.value,
                      }))}
                      required
                      data-testid="select-hr-position"
                    >
                      <option value="">Select position</option>
                      {employeePositions.map((position) => (
                        <option key={position} value={position}>{position}</option>
                      ))}
                    </select>
                  ) : <Input
                    id={`hr-field-${sectionField.key}`}
                    type={sectionField.type || "text"}
                    step={sectionField.type === "number" ? "any" : undefined}
                    value={sectionValues[sectionField.key] || ""}
                    disabled={selectedCategory === "hr-employee-records" &&
                      Boolean(editingRecord) &&
                      !editingRecord?.state.employeeStaffId &&
                      sectionField.key !== "employeeNumber"}
                    onChange={(event) => setSectionValues((current) => ({
                      ...current,
                      [sectionField.key]: event.target.value,
                    }))}
                    data-testid={`input-hr-${sectionField.key}`}
                  />}
                </div>
              ))}
              {selectedCategory === "hr-employee-records" && sectionValues.position === "Maintenance Worker" && (
                <div className="space-y-2">
                  <Label htmlFor="hr-field-maintenance-assignment">Maintenance assignment</Label>
                  <select
                    id="hr-field-maintenance-assignment"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={sectionValues.emergencyTruckDriver || ""}
                    disabled={Boolean(editingRecord?.state.employeeStaffId)}
                    onChange={(event) => setSectionValues((current) => ({
                      ...current,
                      emergencyTruckDriver: event.target.value,
                      role: event.target.value === "true" ? "emergency" : "worker",
                    }))}
                    required
                    data-testid="select-hr-maintenance-assignment"
                  >
                    <option value="">Select assignment</option>
                    <option value="false">Regular maintenance</option>
                    <option value="true">Truck driver</option>
                  </select>
                </div>
              )}
              {selectedCategory !== "hr-approvals" && selectedCategory !== "hr-employee-records" ? <FormField control={form.control} name="employeeStaffId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Employee</FormLabel>
                  <FormControl>
                    <select {...field} disabled={Boolean(editingRecord)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70" data-testid="select-hr-employee">
                      <option value="">Select employee</option>
                      {staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                    </select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} /> : selectedCategory === "hr-approvals" ? (
                <>
                  <FormField control={form.control} name="targetRecordId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sensitive HR record</FormLabel>
                      <FormControl>
                        <select {...field} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="select-hr-approval-target">
                          <option value="">Select record</option>
                          {approvalTargets.map((row) => {
                            const purpose = purposeForRow(row);
                            const employeeName = typeof row.state.employeeStaffId === "string"
                              ? staffById.get(row.state.employeeStaffId)?.name
                              : undefined;
                            return <option key={row.id} value={row.id}>{String(row.state.title || labelFor(row.entity))} · {employeeName || "Employee"} · {purpose}</option>;
                          })}
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                    Employee: {(() => {
                      const target = approvalTargets.find((row) => row.id === form.watch("targetRecordId"));
                      return typeof target?.state.employeeStaffId === "string"
                        ? staffById.get(target.state.employeeStaffId)?.name || "—"
                        : "—";
                    })()}
                  </div>
                </>
              ) : null}
              {selectedCategory !== "hr-employee-records" && <FormField control={form.control} name="title" render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input {...field} required data-testid="input-hr-title" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />}
              {selectedCategory !== "hr-employee-records" && <FormField control={form.control} name="details" render={({ field }) => (
                <FormItem>
                  <FormLabel>Details</FormLabel>
                  <FormControl>
                    <Input {...field} data-testid="input-hr-details" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />}
              
              {selectedCategory === "hr-employee-records" ? (
                <div className="space-y-2">
                  <Label>Developments</Label>
                  <label className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={developmentOptions.length > 0 && assignedDevelopments.length === developmentOptions.length}
                      onChange={(event) => setAssignedDevelopments(event.target.checked ? [...developmentOptions] : [])}
                    />
                    All developments
                  </label>
                  <div className="grid max-h-48 gap-2 overflow-y-auto rounded-md border border-border p-3 sm:grid-cols-2">
                    {developmentOptions.map((development) => (
                      <label key={development} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={assignedDevelopments.includes(development)}
                          onChange={(event) => setAssignedDevelopments((current) =>
                            event.target.checked
                              ? [...new Set([...current, development])]
                              : current.filter((value) => value !== development)
                          )}
                        />
                        {development}
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="development" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Development</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-hr-development" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                  )} />
                  {selectedCategory !== "hr-approvals" && <div />}
                </div>
              )}
              
              {selectedCategory === "hr-exits" && (
                <FormField control={form.control} name="exitType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Exit type</FormLabel>
                    <FormControl>
                      <select {...field} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="select-hr-exit-type">
                        <option value="termination">Termination</option>
                        <option value="layoff">Layoff</option>
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              )}
              <DialogFooter className="pt-2">
                <Button type="button" variant="outline" data-testid="button-cancel-hr-record" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" data-testid="button-submit-hr-record" disabled={create.isPending || update.isPending}>
                  {editingRecord
                    ? (update.isPending ? "Saving..." : "Save record")
                    : (create.isPending ? "Creating..." : "Create record")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(confirmation)} onOpenChange={(value) => { if (!value) { setConfirmation(null); setAuthorizationCode(""); } }}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Enter HR access code</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-sm text-amber-600 dark:text-amber-400 flex items-start gap-2">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <p>This action requires authorization. Please enter your 4-digit HR access code to proceed.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="hr-authorization-code">Access code</Label>
              <Input 
                id="hr-authorization-code" 
                value={authorizationCode} 
                maxLength={4} 
                className="font-mono text-center tracking-widest text-lg h-12"
                onChange={(event) => setAuthorizationCode(event.target.value.toUpperCase())} 
                data-testid="input-hr-authorization-code" 
                autoFocus
              />
            </div>
            <Button 
              className="w-full h-11" 
              data-testid="button-confirm-hr-action" 
              disabled={action.isPending || authorizationCode.length !== 4 || !confirmation} 
              onClick={() => confirmation && void perform(confirmation.row, confirmation.action, authorizationCode)}
            >
              {action.isPending ? "Confirming..." : "Confirm Action"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
