import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  Check,
  ClipboardCheck,
  FileBarChart,
  Gavel,
  HardHat,
  Home,
  Package,
  Save,
  Settings,
  ShieldCheck,
  Trash2,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  getListOrganizationsQueryKey,
  type OrganizationWithUsage,
  useListOrganizations,
  useUpdateOrganization,
  customFetch,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { OrganizationDialog } from "@/components/platform-owner/organization-dialog";

type ModuleDefinition = {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
};

const MODULES: ModuleDefinition[] = [
  { id: "properties", name: "Properties", description: "Properties, buildings, units, asset tracking", icon: Building2 },
  { id: "inspections", name: "Inspections", description: "Templates, reports, photos, field reviews", icon: ClipboardCheck },
  { id: "violations", name: "Violations", description: "Notices, corrective actions, resolution", icon: AlertTriangle },
  { id: "inspectors", name: "Inspectors", description: "Assignments, scheduling, certifications", icon: Users },
  { id: "contractors", name: "Contractors", description: "Database, assignments, contracts, performance", icon: HardHat },
  { id: "workOrders", name: "Work Orders", description: "Service requests, status, completion verification", icon: Wrench },
  { id: "inventory", name: "Inventory", description: "Items, supply tracking, equipment", icon: Package },
  { id: "bidding", name: "Bidding", description: "Bid requests, evaluation, vendor comparisons", icon: Gavel },
  { id: "reports", name: "Reports", description: "Executive, inspection, compliance, financial", icon: FileBarChart },
  { id: "compliance", name: "Compliance", description: "Requirements, controls, evidence", icon: ShieldCheck },
];

function configuredModules(organization: OrganizationWithUsage): Record<string, boolean> {
  const value = organization.features?.modules;
  const saved = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  return MODULES.reduce<Record<string, boolean>>((result, module) => {
    result[module.id] = typeof saved[module.id] === "boolean" ? saved[module.id] as boolean : true;
    return result;
  }, {});
}

export default function OwnerModules() {
  const { data: organizations = [], isLoading, error } = useListOrganizations();
  const updateOrganization = useUpdateOrganization();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [organizationId, setOrganizationId] = useState("");
  const [modules, setModules] = useState<Record<string, boolean>>({});
  const [deletionEnabled, setDeletionEnabled] = useState(false);
  const [deletionSaving, setDeletionSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const selectableOrganizations = useMemo(
    () => organizations,
    [organizations],
  );
  const organization = selectableOrganizations.find((item) => item.id === organizationId) ?? null;
  const enabledModules = MODULES.filter((module) => modules[module.id]);

  useEffect(() => {
    if (!organizationId && selectableOrganizations[0]) {
      setOrganizationId(selectableOrganizations[0].id);
    }
  }, [organizationId, selectableOrganizations]);

  useEffect(() => {
    if (!organization) return;
    setModules(configuredModules(organization));
    setDeletionEnabled(organization.features?.deletionEnabled === true);
    setDirty(false);
  }, [organization]);

  const selectOrganization = (nextId: string) => {
    setOrganizationId(nextId);
  };

  const toggleModule = (moduleId: string, enabled: boolean) => {
    setModules((current) => ({ ...current, [moduleId]: enabled }));
    setDirty(true);
  };

  const toggleDeletion = async (enabled: boolean) => {
    if (!organization || deletionSaving) return;
    const previous = deletionEnabled;
    setDeletionSaving(true);
    setDeletionEnabled(enabled);
    try {
      await customFetch<{ enabled: boolean }>(
        `/api/v1/platform/organizations/${organization.id}/deletion-policy`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        },
      );
      queryClient.setQueryData(
        getListOrganizationsQueryKey(),
        (current: typeof organizations | undefined) => current?.map((item) => (
          item.id === organization.id
            ? { ...item, features: { ...item.features, deletionEnabled: enabled } }
            : item
        )),
      );
      await queryClient.invalidateQueries({
        queryKey: getListOrganizationsQueryKey(),
      });
      toast({ title: enabled ? "Deletion enabled." : "Deletion disabled." });
    } catch (saveError: any) {
      setDeletionEnabled(previous);
      toast({
        variant: "destructive",
        title: "Save failed",
        description: saveError?.data?.error || saveError?.message || "Deletion setting could not be saved.",
      });
    } finally {
      setDeletionSaving(false);
    }
  };

  const save = async () => {
    if (!organization) return;
    try {
      await updateOrganization.mutateAsync({
        id: organization.id,
        data: {
          features: {
            ...organization.features,
            modules,
            deletionEnabled,
          },
        },
      });
      await queryClient.invalidateQueries({ queryKey: getListOrganizationsQueryKey() });
      setDirty(false);
      toast({ title: "Module settings saved." });
    } catch (saveError: any) {
      toast({
        variant: "destructive",
        title: "Save failed",
        description: saveError?.data?.error || saveError?.message || "Module settings could not be saved.",
      });
    }
  };

  if (isLoading) {
    return <div className="h-96 animate-pulse rounded-xl border border-slate-200 bg-white" />;
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-8 text-center text-rose-800">
        Module settings could not be loaded.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-[#185FA5]">Company configuration</p>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">Module Management</h1>
        </div>
        <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto">
          <Select value={organizationId} onValueChange={selectOrganization}>
            <SelectTrigger className="h-11 w-full bg-white sm:w-[320px]" aria-label="Organization">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {selectableOrganizations.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.id === "default" ? "FIAREP" : item.name}
                  </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            onClick={save}
            disabled={!organization || !dirty || updateOrganization.isPending}
            className="h-11 bg-[#185FA5] px-5 text-white hover:bg-[#124d87]"
          >
            {dirty ? <Save className="mr-2 h-4 w-4" /> : <Check className="mr-2 h-4 w-4" />}
            {updateOrganization.isPending ? "Saving" : dirty ? "Save Changes" : "Saved"}
          </Button>
        </div>
      </div>

      {!organization ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-500">
          No organization is available.
        </div>
      ) : (
        <>
          <div className="grid overflow-hidden rounded-xl border border-slate-200 bg-white sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Active modules" value={`${enabledModules.length} of ${MODULES.length}`} />
            <Metric label="Navigation items" value={String(enabledModules.length + 2)} />
            <Metric label="Company status" value={organization.status} />
            <Metric label="Organization code" value={organization.id} mono />
          </div>

          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(330px,0.75fr)]">
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <h2 className="font-semibold text-slate-950">Enabled Modules</h2>
                <span className="rounded bg-blue-50 px-2 py-1 text-[10px] font-bold tracking-wider text-[#185FA5]">
                  {enabledModules.length} ENABLED
                </span>
              </div>
              <div>
                {MODULES.map((module) => {
                  const Icon = module.icon;
                  const enabled = modules[module.id] === true;
                  return (
                    <div
                      key={module.id}
                      className={`flex min-h-18 items-center gap-3 border-b border-slate-100 px-5 py-3 last:border-b-0 transition-colors hover:bg-slate-50 ${
                        enabled ? "" : "opacity-60"
                      }`}
                    >
                      <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${
                        enabled ? "bg-blue-50 text-[#185FA5]" : "bg-slate-100 text-slate-500"
                      }`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-900">{module.name}</p>
                        <p className="truncate text-xs text-slate-500">{module.description}</p>
                      </div>
                      <span className={`hidden w-16 text-[10px] font-bold uppercase tracking-wide sm:block ${
                        enabled ? "text-emerald-700" : "text-slate-400"
                      }`}>
                        {enabled ? "Enabled" : "Disabled"}
                      </span>
                      <Switch
                        checked={enabled}
                        onCheckedChange={(checked) => toggleModule(module.id, checked)}
                        aria-label={`${enabled ? "Disable" : "Enable"} ${module.name}`}
                      />
                    </div>
                  );
                })}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => void toggleDeletion(!deletionEnabled)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void toggleDeletion(!deletionEnabled);
                    }
                  }}
                  className={`flex min-h-18 cursor-pointer items-center gap-3 border-t border-slate-200 px-5 py-3 transition-colors hover:bg-slate-50 ${
                  deletionEnabled ? "" : "opacity-60"
                }`}
                >
                  <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${
                    deletionEnabled ? "bg-blue-50 text-[#185FA5]" : "bg-slate-100 text-slate-500"
                  }`}>
                    <Trash2 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">Delete enabled</p>
                    <p className="truncate text-xs text-slate-500">Allow authorized staff to delete records</p>
                  </div>
                  <span className={`hidden w-16 text-[10px] font-bold uppercase tracking-wide sm:block ${
                    deletionEnabled ? "text-emerald-700" : "text-slate-400"
                  }`}>
                    {deletionEnabled ? "Enabled" : "Disabled"}
                  </span>
                  <Switch
                    checked={deletionEnabled}
                    onCheckedChange={toggleDeletion}
                     onClick={(event) => event.stopPropagation()}
                     disabled={deletionSaving}
                    aria-label={`${deletionEnabled ? "Disable" : "Enable"} deletion`}
                  />
                </div>
              </div>
            </section>

            <section className="sticky top-32 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <h2 className="font-semibold text-slate-950">Organization Navigation</h2>
                <span className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-emerald-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  LIVE
                </span>
              </div>
              <div className="bg-slate-100 p-4">
                <div className="overflow-hidden rounded-lg border border-slate-300 bg-[#101d2c] shadow-lg">
                  <div className="border-b border-white/10 px-4 py-4 text-lg font-bold tracking-tight text-white">
                    FIA<span className="text-[#F5B301]">REP</span>
                  </div>
                  <div className="space-y-1 p-3">
                    <PreviewLink icon={Home} label="Home" active />
                    {enabledModules.map((module) => (
                      <PreviewLink key={module.id} icon={module.icon} label={module.name} />
                    ))}
                    <div className="mt-3 border-t border-white/10 pt-3">
                      <PreviewLink icon={Settings} label="Settings" onClick={() => setSettingsOpen(true)} />
                    </div>
                  </div>
                  <div className="border-t border-white/10 px-4 py-3 text-[10px] text-slate-400">
                    {organization.id === "default" ? "FIAREP" : organization.name}
                  </div>
                </div>
              </div>
            </section>
          </div>
          <OrganizationDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            organization={organization}
          />
        </>
      )}
    </div>
  );
}

function Metric({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="border-b border-slate-200 p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 truncate text-lg font-bold capitalize text-slate-950 ${mono ? "font-mono text-sm" : ""}`}>{value}</p>
    </div>
  );
}

function PreviewLink({ icon: Icon, label, active = false, onClick }: { icon: LucideIcon; label: string; active?: boolean; onClick?: () => void }) {
  const className = `flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium ${
    active ? "bg-[#185FA5] text-white" : "text-slate-300"
  } ${onClick ? "hover:bg-white/10 hover:text-white" : ""}`;
  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        <Icon className="h-4 w-4" />
        {label}
      </button>
    );
  }
  return (
    <div className={className}>
      <Icon className="h-4 w-4" />
      {label}
    </div>
  );
}