import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetHrWorkspaceQueryKey,
  getListStaffDevelopmentsQueryKey,
  getListStaffQueryKey,
  useConfigureStaffDevelopments,
  useGetHrWorkspace,
  useListNychaDevelopments,
  useListStaffDevelopments,
  useUpdateStaffDevelopments,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function messageFor(error: unknown) {
  const value = error as { data?: { error?: string }; message?: string } | undefined;
  return value?.data?.error || value?.message || "The request could not be completed.";
}

function developmentNamesFromCsv(content: string) {
  const rows = content.split(/\r?\n/).filter((line) => line.trim()).map((line) => {
    const values: string[] = [];
    let value = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index]!;
      if (character === '"' && quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = !quoted;
      } else if (character === "," && !quoted) {
        values.push(value.trim());
        value = "";
      } else {
        value += character;
      }
    }
    values.push(value.trim());
    return values;
  });
  const header = rows[0]?.map((value) => value.toLowerCase()) || [];
  const headerIndex = header.findIndex((value) =>
    value === "name" || value.includes("development"));
  const nameIndex = headerIndex >= 0 ? headerIndex : 0;
  const names = rows
    .slice(headerIndex >= 0 ? 1 : 0)
    .map((row) => row[nameIndex]?.trim() || "")
    .filter(Boolean);
  return [...new Set(names)];
}

export function DevelopmentManagement() {
  const queryClient = useQueryClient();
  const { data: configured = [] } = useListStaffDevelopments();
  const { data: catalog = [] } = useListNychaDevelopments();
  const workspace = useGetHrWorkspace();
  const configure = useConfigureStaffDevelopments();
  const updateAssignment = useUpdateStaffDevelopments();
  const [search, setSearch] = useState("");
  const [assignmentSearch, setAssignmentSearch] = useState("");
  const [selectedCatalog, setSelectedCatalog] = useState<string[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [employeeDevelopments, setEmployeeDevelopments] = useState<string[]>([]);
  const [error, setError] = useState("");

  const configuredSet = useMemo(() => new Set(configured), [configured]);
  const filteredCatalog = useMemo(() => {
    const query = search.trim().toLowerCase();
    return catalog.filter((item) => !configuredSet.has(item.name) &&
      (!query || item.name.toLowerCase().includes(query) ||
        item.borough?.toLowerCase().includes(query))).slice(0, 100);
  }, [catalog, configuredSet, search]);
  const employees = useMemo(
    () => (workspace.data?.staff || []).filter((member) => member.canManage === true)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [workspace.data?.staff],
  );

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListStaffDevelopmentsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetHrWorkspaceQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListStaffQueryKey({ status: "approved" }) }),
    ]);
  }

  async function addDevelopments(names: string[]) {
    if (!names.length) return;
    setError("");
    try {
      await configure.mutateAsync({ data: { developments: names } });
      setSelectedCatalog([]);
      await refresh();
    } catch (reason) {
      setError(messageFor(reason));
    }
  }

  async function importCsv(file?: File) {
    if (!file) return;
    const names = developmentNamesFromCsv(await file.text());
    if (!names.length) {
      setError("The CSV does not contain development names.");
      return;
    }
    await addDevelopments(names);
  }

  async function saveAssignment() {
    if (!employeeId) return;
    setError("");
    try {
      await updateAssignment.mutateAsync({
        id: employeeId,
        data: { developments: employeeDevelopments },
      });
      await refresh();
    } catch (reason) {
      setError(messageFor(reason));
    }
  }

  return (
    <div className="space-y-6 p-5">
      {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <section className="space-y-3">
        <h3 className="font-semibold">Add developments</h3>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => void importCsv(event.target.files?.[0])}
            disabled={configure.isPending}
            data-testid="input-development-csv"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search developments"
            data-testid="input-development-catalog-search"
          />
        </div>
        <div className="max-h-72 overflow-y-auto rounded-lg border">
          {filteredCatalog.map((development) => (
            <label key={development.id} className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0">
              <input
                type="checkbox"
                checked={selectedCatalog.includes(development.name)}
                onChange={() => setSelectedCatalog((current) =>
                  current.includes(development.name)
                    ? current.filter((name) => name !== development.name)
                    : [...current, development.name])}
              />
              <span className="flex-1">{development.name}</span>
              <span className="text-xs text-muted-foreground">{development.borough}</span>
            </label>
          ))}
          {filteredCatalog.length === 0 && <div className="p-4 text-sm text-muted-foreground">No developments found.</div>}
        </div>
        <Button onClick={() => void addDevelopments(selectedCatalog)} disabled={!selectedCatalog.length || configure.isPending}>
          Add selected
        </Button>
      </section>

      <section className="space-y-3 border-t pt-5">
        <h3 className="font-semibold">Assign developments to employee</h3>
        <select
          className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          value={employeeId}
          onChange={(event) => {
            const id = event.target.value;
            setEmployeeId(id);
            setEmployeeDevelopments(employees.find((member) => member.id === id)?.developments || []);
          }}
          data-testid="select-development-employee"
        >
          <option value="">Select employee</option>
          {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
        </select>
        {employeeId && (
          <>
            <Input
              value={assignmentSearch}
              onChange={(event) => setAssignmentSearch(event.target.value)}
              placeholder="Search developments"
            />
            <div className="grid max-h-72 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
              {configured
                .filter((name) => !assignmentSearch.trim() || name.toLowerCase().includes(assignmentSearch.trim().toLowerCase()))
                .map((name) => (
                  <label key={name} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                    <input
                      type="checkbox"
                      checked={employeeDevelopments.includes(name)}
                      onChange={() => setEmployeeDevelopments((current) =>
                        current.includes(name) ? current.filter((value) => value !== name) : [...current, name])}
                    />
                    {name}
                  </label>
                ))}
            </div>
            <Button onClick={() => void saveAssignment()} disabled={updateAssignment.isPending}>
              Save assignment
            </Button>
          </>
        )}
      </section>
    </div>
  );
}