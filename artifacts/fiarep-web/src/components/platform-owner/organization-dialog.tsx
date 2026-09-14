import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Building2, ChevronDown, Copy, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { customFetch, LM_DEVELOPMENT_NAMES, NYCHA_DEVELOPMENT_NAMES, useCreateOrganization, useUpdateOrganization, OrganizationWithUsage, getListOrganizationsQueryKey, OrganizationInputStatus, useUpdatePlatformOrganizationTimeClock, useCreateOrganizationAdministrator, useListPlatformOrganizationProperties, getListPlatformOrganizationPropertiesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const orgSchema = z.object({
  name: z.string().min(2, "Name is required"),
  organizationType: z.string().optional(),
  status: z.enum(["active", "suspended", "expired"]).optional(),
  startsAt: z.string().optional().nullable(),
  endsAt: z.string().optional().nullable(),
  staffLimit: z.number().nullable().optional(),
  propertyLimit: z.number().nullable().optional(),
  unrestricted: z.boolean().default(false),
  directorName: z.string().optional(),
});

type FormValues = z.infer<typeof orgSchema>;

interface OrganizationResearchResult {
  organizationName: string;
  officialWebsite: string | null;
  organizationType: string | null;
  developments: string[];
  sources: string[];
}

function organizationCatalog(name: string): readonly string[] | null {
  const normalized = name.trim().toLowerCase();
  if (normalized.includes("nycha") || normalized.includes("new york city housing authority")) {
    return NYCHA_DEVELOPMENT_NAMES;
  }
  if (normalized === "l+m" || normalized.includes("l+m development partners")) {
    return LM_DEVELOPMENT_NAMES;
  }
  return null;
}

interface OrganizationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organization?: OrganizationWithUsage | null;
  preset?: "nycha" | null;
}

export function OrganizationDialog({ open, onOpenChange, organization, preset }: OrganizationDialogProps) {
  const isEditing = !!organization;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [generatedCode, setGeneratedCode] = useState("");
  const [generatedStaffCode, setGeneratedStaffCode] = useState("");
  const [issuedAdministratorName, setIssuedAdministratorName] = useState("");
  const [administratorName, setAdministratorName] = useState("");
  const [copySucceeded, setCopySucceeded] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [mobileClockEnabled, setMobileClockEnabled] = useState(false);
  const [integrationEnabled, setIntegrationEnabled] = useState(false);
  const [timeClockProvider, setTimeClockProvider] = useState<string | null>(null);
  const [configuredDevelopments, setConfiguredDevelopments] = useState<string[]>([]);
  const [developmentName, setDevelopmentName] = useState("");
  const [developmentsOpen, setDevelopmentsOpen] = useState(true);
  const [isResearching, setIsResearching] = useState(false);
  const [researchSources, setResearchSources] = useState<string[]>([]);
  const autoPopulatedCatalog = useRef<readonly string[] | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(orgSchema),
    defaultValues: {
      name: "",
      organizationType: "",
      status: "active",
      startsAt: "",
      endsAt: "",
      staffLimit: null,
      propertyLimit: null,
      unrestricted: false,
      directorName: "",
    },
  });
  const currentOrganizationName = form.watch("name");

  const createMutation = useCreateOrganization();
  const updateMutation = useUpdateOrganization();
  const updateTimeClockMutation = useUpdatePlatformOrganizationTimeClock();
  const issueAdministratorCodeMutation = useCreateOrganizationAdministrator();
  const { data: organizationProperties = [] } = useListPlatformOrganizationProperties(
    organization?.id ?? "",
    {
      query: {
        queryKey: getListPlatformOrganizationPropertiesQueryKey(organization?.id ?? ""),
        enabled: open && isEditing,
      },
    },
  );

  useEffect(() => {
    if (organization && open) {
      form.reset({
        name: organization.name,
        organizationType: typeof organization.features?.organizationType === "string"
          ? organization.features.organizationType
          : "",
        status: organization.status as any,
        startsAt: organization.startsAt ? new Date(organization.startsAt).toISOString().slice(0, 16) : "",
        endsAt: organization.endsAt ? new Date(organization.endsAt).toISOString().slice(0, 16) : "",
        staffLimit: organization.staffLimit,
        propertyLimit: organization.propertyLimit,
        unrestricted: organization.unrestricted,
        directorName: "",
      });
      const configured = organization.features?.timeClock;
      const timeClock = configured && typeof configured === "object" && !Array.isArray(configured)
        ? configured as Record<string, unknown>
        : {};
      setMobileClockEnabled(timeClock.mobileClockEnabled === true);
      setIntegrationEnabled(false);
      setTimeClockProvider(null);
      const configuredDevelopmentValues = organization.features?.configuredDevelopments;
      const matchedCatalog = organizationCatalog(organization.name);
      setConfiguredDevelopments(
        matchedCatalog
          ? [...matchedCatalog]
          : Array.isArray(configuredDevelopmentValues)
          ? configuredDevelopmentValues.filter((value): value is string => typeof value === "string")
          : organization.developments.filter((value) => value.active).map((value) => value.name),
      );
      setDevelopmentName("");
      setDevelopmentsOpen(true);
      setResearchSources([]);
    } else if (open) {
      form.reset({
        name: preset === "nycha" ? "NYCHA" : "",
        organizationType: preset === "nycha" ? "Public Housing Authority" : "",
        status: "active",
        startsAt: "",
        endsAt: "",
        staffLimit: null,
        propertyLimit: null,
        unrestricted: false,
        directorName: "",
      });
      setMobileClockEnabled(false);
      setIntegrationEnabled(false);
      setTimeClockProvider(null);
      setConfiguredDevelopments(preset === "nycha" ? [...NYCHA_DEVELOPMENT_NAMES] : []);
      setDevelopmentName("");
      setDevelopmentsOpen(true);
      setResearchSources([]);
    } else {
      setGeneratedCode("");
      setGeneratedStaffCode("");
      setIssuedAdministratorName("");
      setAdministratorName("");
      setCopySucceeded(false);
      setCopyError("");
      setAcknowledged(false);
      form.reset({
        name: "",
        organizationType: "",
        status: "active",
        startsAt: "",
        endsAt: "",
        staffLimit: null,
        propertyLimit: null,
        unrestricted: false,
        directorName: "",
      });
      setMobileClockEnabled(false);
      setIntegrationEnabled(false);
      setTimeClockProvider(null);
      setConfiguredDevelopments([]);
      setDevelopmentName("");
      setDevelopmentsOpen(true);
      setResearchSources([]);
    }
  }, [organization, open, form, preset]);

  useEffect(() => {
    if (!open) {
      autoPopulatedCatalog.current = null;
      return;
    }
    const catalog = organizationCatalog(currentOrganizationName);
    if (!catalog) {
      autoPopulatedCatalog.current = null;
      return;
    }
    if (autoPopulatedCatalog.current === catalog) return;
    autoPopulatedCatalog.current = catalog;
    setConfiguredDevelopments([...catalog].sort((a, b) => a.localeCompare(b)));
    setDevelopmentsOpen(true);
  }, [currentOrganizationName, open]);

  const onSubmit = async (values: FormValues) => {
    if (!isEditing && !values.directorName?.trim()) {
      form.setError("directorName", { message: "Director name is required" });
      return;
    }
    try {
      const payload = {
        name: values.name,
        status: values.status as OrganizationInputStatus,
        startsAt: values.startsAt ? new Date(values.startsAt).toISOString() : undefined,
        endsAt: values.endsAt ? new Date(values.endsAt).toISOString() : undefined,
        staffLimit: values.staffLimit || null,
        propertyLimit: values.propertyLimit || null,
        unrestricted: values.unrestricted,
        directorName: values.directorName || undefined,
        features: {
          ...(organization?.features ?? {}),
          organizationType: values.organizationType?.trim() || "",
          configuredDevelopments,
        },
      };

      if (isEditing) {
        const { directorName: _directorName, ...updates } = payload;
        await updateMutation.mutateAsync({
          id: organization!.id,
          data: organization!.id === "default" ? { features: updates.features } : updates,
        });
        await updateTimeClockMutation.mutateAsync({
          id: organization!.id,
          data: { integrationEnabled: false, mobileClockEnabled },
        });
        toast({ title: "Organization updated successfully." });
      } else {
        const result = await createMutation.mutateAsync({
          data: {
            ...payload,
            directorName: values.directorName!.trim(),
          },
        });
        setGeneratedCode(result.organization.id);
        setGeneratedStaffCode(result.director?.code || "");
        setIssuedAdministratorName(result.director?.name || values.directorName || "");
        setCopySucceeded(false);
        setCopyError("");
        setAcknowledged(false);
        toast({ title: "Organization created successfully." });
      }
      
      queryClient.invalidateQueries({ queryKey: getListOrganizationsQueryKey() });
      if (isEditing) onOpenChange(false);
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Operation Failed",
        description: err.message || "Failed to save organization.",
      });
    }
  };

  const addDevelopment = () => {
    const name = developmentName.trim();
    if (!name) return;
    setConfiguredDevelopments((current) =>
      [...new Set([...current, name])].sort((a, b) => a.localeCompare(b)),
    );
    setDevelopmentName("");
  };

  const addNychaDevelopments = () => {
    setConfiguredDevelopments([...NYCHA_DEVELOPMENT_NAMES].sort((a, b) => a.localeCompare(b)));
  };

  const addLmDevelopments = () => {
    setConfiguredDevelopments([...LM_DEVELOPMENT_NAMES].sort((a, b) => a.localeCompare(b)));
  };

  const isLoading = createMutation.isPending || updateMutation.isPending || updateTimeClockMutation.isPending;
  const matchedOrganizationCatalog = organizationCatalog(currentOrganizationName);
  const isNychaOrganization = matchedOrganizationCatalog === NYCHA_DEVELOPMENT_NAMES;
  const isLmOrganization = matchedOrganizationCatalog === LM_DEVELOPMENT_NAMES;
  const canCloseAfterCreation = !generatedCode || copySucceeded || acknowledged;
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !canCloseAfterCreation) return;
    if (!nextOpen) {
      setGeneratedCode("");
      setGeneratedStaffCode("");
      setIssuedAdministratorName("");
      setCopySucceeded(false);
      setCopyError("");
      setAcknowledged(false);
    }
    onOpenChange(nextOpen);
  };
  const copyOrganizationCode = async () => {
    try {
      await navigator.clipboard.writeText(
        generatedStaffCode
          ? `Organization Code: ${generatedCode}\nName: ${issuedAdministratorName}\n4-Digit Code: ${generatedStaffCode}`
          : generatedCode,
      );
      setCopySucceeded(true);
      setCopyError("");
    } catch {
      setCopyError("Copy failed. Use the acknowledgment below after saving the code manually.");
    }
  };

  const issueAdministratorCode = async () => {
    if (!organization || !administratorName.trim()) return;
    try {
      const result = await issueAdministratorCodeMutation.mutateAsync({
        id: organization.id,
        data: { name: administratorName.trim() },
      });
      setGeneratedCode(organization.id);
      setGeneratedStaffCode(result.code);
      setIssuedAdministratorName(result.name || administratorName.trim());
      setCopySucceeded(false);
      setAcknowledged(false);
      toast({ title: "Administrator code generated." });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Code generation failed",
        description: error?.message || "Administrator code could not be generated.",
      });
    }
  };

  const researchOrganizationName = async () => {
    const name = currentOrganizationName.trim();
    if (name.length < 2 || isResearching) return;
    const builtInCatalog = organizationCatalog(name);
    if (builtInCatalog) {
      setConfiguredDevelopments([...builtInCatalog].sort((a, b) => a.localeCompare(b)));
      setDevelopmentsOpen(true);
      return;
    }
    setIsResearching(true);
    try {
      const result = await customFetch<OrganizationResearchResult>("/api/v1/platform/organizations/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (result.organizationType) form.setValue("organizationType", result.organizationType, { shouldDirty: true });
      setResearchSources([...new Set([result.officialWebsite, ...result.sources].filter((source): source is string => Boolean(source)))]);
      if (result.developments.length > 0) {
        setConfiguredDevelopments(result.developments);
        setDevelopmentsOpen(true);
        toast({ title: `${result.developments.length} developments found.` });
      } else {
        toast({ title: "No published developments found." });
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Organization research failed",
        description: error?.message || "The organization could not be researched.",
      });
    } finally {
      setIsResearching(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto bg-white border-slate-200">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-slate-900">
            {isEditing ? "Edit Organization" : "Register Organization"}
          </DialogTitle>
          <DialogDescription className="text-slate-500">
            {isEditing 
              ? "Update platform licensing and limits for this organization." 
              : "Provision a new tenant environment and initial administrator."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              {isEditing && (
                <div className="space-y-2">
                  <label htmlFor="organization-code-edit" className="text-sm font-semibold text-slate-700">Organization Code</label>
                  <Input id="organization-code-edit" value={organization.id} readOnly className="font-mono bg-slate-50" />
                  <p className="text-sm text-slate-500">System-generated code used by organization staff at sign-in.</p>
                </div>
              )}
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-slate-700 font-semibold">Organization Name</FormLabel>
                    <FormControl>
                      <div className="flex gap-2">
                        <Input placeholder="NYC Housing Preservation & Development" {...field} />
                        <Button type="button" variant="outline" size="icon" onClick={researchOrganizationName} disabled={field.value.trim().length < 2 || isResearching} aria-label="Research organization">
                          {isResearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                        </Button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="organizationType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-slate-700 font-semibold">Organization Type</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            {generatedCode && (
              <div className="rounded-lg border border-teal-200 bg-teal-50 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="generated-organization-code" className="text-sm font-semibold text-teal-900">Organization Code</label>
                    <Input id="generated-organization-code" value={generatedCode} readOnly className="mt-2 font-mono bg-white" />
                  </div>
                  <div>
                    <label htmlFor="generated-staff-code" className="text-sm font-semibold text-teal-900">4-Digit Code</label>
                    <Input id="generated-staff-code" value={generatedStaffCode} readOnly className="mt-2 font-mono bg-white tracking-[0.3em]" />
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button type="button" variant="outline" onClick={copyOrganizationCode}>
                    <Copy className="mr-2 h-4 w-4" /> Copy Login
                  </Button>
                </div>
                <p className="mt-2 text-sm text-teal-800">{issuedAdministratorName}</p>
                {copySucceeded && <p role="status" className="mt-2 text-sm font-medium text-teal-800">Copied successfully.</p>}
                {copyError && <p role="alert" className="mt-2 text-sm font-medium text-rose-700">{copyError}</p>}
                <Button type="button" variant="link" className="mt-1 h-auto px-0 text-teal-800" onClick={() => setAcknowledged(true)}>
                  I saved this code
                </Button>
              </div>
            )}

            <div className="grid grid-cols-3 gap-4 p-4 bg-slate-50 rounded-lg border border-slate-100">
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-slate-700">Status</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="bg-white">
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="suspended">Suspended</SelectItem>
                        <SelectItem value="expired">Expired</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="startsAt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-slate-700">Start Date</FormLabel>
                    <FormControl>
                      <Input type="datetime-local" {...field} value={field.value || ""} className="bg-white" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endsAt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-slate-700">Expiration Date</FormLabel>
                    <FormControl>
                      <Input type="datetime-local" {...field} value={field.value || ""} className="bg-white" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="space-y-4">
              <h4 className="font-semibold text-slate-900 border-b border-slate-100 pb-2">Limits & Constraints</h4>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="staffLimit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-slate-700">Staff Limit</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          placeholder="Unlimited" 
                          {...field} 
                          value={field.value === null ? "" : field.value} 
                          onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : null)} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="propertyLimit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-slate-700">Development Limit</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          placeholder="Unlimited" 
                          {...field} 
                          value={field.value === null ? "" : field.value} 
                          onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : null)} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="unrestricted"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border border-slate-200 p-4 bg-white shadow-sm">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base font-semibold text-slate-900">Unrestricted Access</FormLabel>
                      <FormDescription className="text-slate-500">
                        Bypass all enforcement and limit checks for this tenant. Use with caution.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              {isEditing && (
                <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
                  <h4 className="font-semibold text-slate-900">Time Clock</h4>
                  <div className="text-sm text-slate-600">Provider: {timeClockProvider || "Unconfigured"}</div>
                  <div className="flex items-center justify-between">
                    <label htmlFor="external-time-clock" className="text-sm font-medium text-slate-700">External integration enabled</label>
                    <Switch id="external-time-clock" checked={false} disabled aria-label="External time-clock integration unavailable" />
                  </div>
                  <div className="flex items-center justify-between">
                    <label htmlFor="mobile-time-clock" className="text-sm font-medium text-slate-700">FIAREP mobile clock enabled</label>
                    <Switch id="mobile-time-clock" checked={mobileClockEnabled} onCheckedChange={setMobileClockEnabled} />
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div>
                    <div className="text-sm font-medium text-slate-600">Portfolio</div>
                    <div className="mt-1 text-xl font-semibold text-slate-900">{configuredDevelopments.length}</div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-slate-600">Developments</div>
                    <div className="mt-1 text-xl font-semibold text-slate-900">{configuredDevelopments.length}</div>
                  </div>
                </div>
                <Collapsible open={developmentsOpen} onOpenChange={setDevelopmentsOpen}>
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="ghost" className="h-auto w-full justify-between rounded-none border-b border-slate-100 px-0 pb-2 pt-0 hover:bg-transparent">
                      <span className="font-semibold text-slate-900">Developments</span>
                      <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                        {configuredDevelopments.length}
                        <ChevronDown className={`h-4 w-4 transition-transform ${developmentsOpen ? "rotate-180" : ""}`} />
                      </span>
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-3 pt-3">
                    {researchSources.length > 0 && (
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {researchSources.map((source) => (
                          <a key={source} href={source} target="_blank" rel="noreferrer" className="text-sm text-blue-700 underline">
                            {new URL(source).hostname.replace(/^www\./, "")}
                          </a>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    aria-label="Development name"
                    value={developmentName}
                    onChange={(event) => setDevelopmentName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addDevelopment();
                      }
                    }}
                  />
                  <Button type="button" variant="outline" onClick={addDevelopment} disabled={!developmentName.trim()}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add
                  </Button>
                   {isNychaOrganization && (
                     <Button type="button" variant="outline" onClick={addNychaDevelopments}>
                       NYCHA
                     </Button>
                   )}
                   {isLmOrganization && (
                     <Button type="button" variant="outline" onClick={addLmDevelopments}>
                       L+M
                     </Button>
                   )}
                    </div>
                    {configuredDevelopments.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 p-5 text-center text-sm text-slate-500">
                    No developments added.
                  </div>
                ) : (
                  <div className="max-h-64 space-y-2 overflow-y-auto">
                    {configuredDevelopments.map((name) => {
                      const development = organization?.developments.find((value) => value.name === name);
                      const properties = organizationProperties.filter(
                        (property) => property.development?.trim().toLowerCase() === name.trim().toLowerCase(),
                      );
                      return (
                      <div key={name} className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 rounded-md bg-slate-100 p-2">
                              <Building2 className="h-4 w-4 text-slate-600" />
                            </div>
                            <div>
                              <div className="font-semibold text-slate-900">{name}</div>
                              {development && <div className="mt-1 text-xs text-slate-500">
                                {development.staff} assigned staff · {development.projects} projects · {development.records} operational records
                              </div>}
                               <div className="mt-2 text-xs font-semibold text-slate-600">
                                 Properties {properties.length}
                               </div>
                               {properties.map((property) => (
                                 <div key={property.id} className="mt-1 text-sm text-slate-700">
                                   {property.displayAddress}
                                 </div>
                               ))}
                            </div>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setConfiguredDevelopments((current) => current.filter((value) => value !== name))}
                            aria-label={`Remove ${name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )})}
                  </div>
                )}
                  </CollapsibleContent>
                </Collapsible>
            </div>

            {!isEditing && (
              <div className="space-y-4 pt-2">
                <h4 className="font-semibold text-slate-900 border-b border-slate-100 pb-2">Initial Setup</h4>
                <div className="grid grid-cols-1 gap-4">
                  <FormField
                    control={form.control}
                    name="directorName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-700">Director Name</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Jane Doe" {...field} />
                        </FormControl>
                        <FormDescription>The four-digit code is generated automatically.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            )}

            {isEditing && (
              <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
                <h4 className="font-semibold text-slate-900">Administrator Login</h4>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="flex-1 space-y-2">
                    <label htmlFor="organization-administrator-name" className="text-sm font-medium text-slate-700">Administrator Name</label>
                    <Input
                      id="organization-administrator-name"
                      value={administratorName}
                      onChange={(event) => setAdministratorName(event.target.value)}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={issueAdministratorCode}
                    disabled={!administratorName.trim() || issueAdministratorCodeMutation.isPending}
                    className="sm:self-end"
                  >
                    {issueAdministratorCodeMutation.isPending ? "Generating..." : "Generate 4-Digit Code"}
                  </Button>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button type={generatedCode ? "button" : "submit"} onClick={generatedCode ? () => handleOpenChange(false) : undefined} disabled={isLoading} className="bg-slate-900 text-white hover:bg-slate-800">
                {isLoading ? "Saving..." : isEditing ? "Save Changes" : "Create Tenant"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
