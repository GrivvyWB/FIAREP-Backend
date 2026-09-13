import { useEffect, useState } from "react";
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
import { Building2, Copy } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateOrganization, useUpdateOrganization, OrganizationWithUsage, getListOrganizationsQueryKey, OrganizationInputStatus, useUpdatePlatformOrganizationTimeClock, useIssueOrganizationDirectorCode } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const orgSchema = z.object({
  name: z.string().min(2, "Name is required"),
  status: z.enum(["active", "suspended", "expired"]).optional(),
  startsAt: z.string().optional().nullable(),
  endsAt: z.string().optional().nullable(),
  staffLimit: z.number().nullable().optional(),
  propertyLimit: z.number().nullable().optional(),
  unrestricted: z.boolean().default(false),
  directorName: z.string().optional(),
});

type FormValues = z.infer<typeof orgSchema>;

interface OrganizationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organization?: OrganizationWithUsage | null;
}

export function OrganizationDialog({ open, onOpenChange, organization }: OrganizationDialogProps) {
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

  const form = useForm<FormValues>({
    resolver: zodResolver(orgSchema),
    defaultValues: {
      name: "",
      status: "active",
      startsAt: "",
      endsAt: "",
      staffLimit: null,
      propertyLimit: null,
      unrestricted: false,
      directorName: "",
    },
  });

  const createMutation = useCreateOrganization();
  const updateMutation = useUpdateOrganization();
  const updateTimeClockMutation = useUpdatePlatformOrganizationTimeClock();
  const issueAdministratorCodeMutation = useIssueOrganizationDirectorCode();

  useEffect(() => {
    if (organization && open) {
      form.reset({
        name: organization.name,
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
    } else if (!open) {
      setGeneratedCode("");
      setGeneratedStaffCode("");
      setIssuedAdministratorName("");
      setAdministratorName("");
      setCopySucceeded(false);
      setCopyError("");
      setAcknowledged(false);
      form.reset({
        name: "",
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
    }
  }, [organization, open, form]);

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
      };

      if (isEditing) {
        const { directorName: _directorName, ...updates } = payload;
        await updateMutation.mutateAsync({ id: organization!.id, data: updates });
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

  const isLoading = createMutation.isPending || updateMutation.isPending || updateTimeClockMutation.isPending;
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
                      <Input placeholder="NYC Housing Preservation & Development" {...field} />
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
                    <FormLabel className="text-slate-700">External integration enabled</FormLabel>
                    <Switch checked={false} disabled aria-label="External time-clock integration unavailable" />
                  </div>
                  <div className="flex items-center justify-between">
                    <FormLabel className="text-slate-700">FIAREP mobile clock enabled</FormLabel>
                    <Switch checked={mobileClockEnabled} onCheckedChange={setMobileClockEnabled} />
                  </div>
                </div>
              )}
            </div>

            {isEditing && (
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <div>
                    <h4 className="font-semibold text-slate-900">Connected Developments</h4>
                    <p className="text-sm text-slate-500">Developments found in staff assignments and organization records.</p>
                  </div>
                  <span className="text-sm font-semibold text-slate-700">
                    {organization.developments.length} / {organization.propertyLimit ?? "∞"}
                  </span>
                </div>
                {organization.developments.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 p-5 text-center text-sm text-slate-500">
                    No developments are connected to this organization yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {organization.developments.map((development) => (
                      <div key={development.name} className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 rounded-md bg-slate-100 p-2">
                              <Building2 className="h-4 w-4 text-slate-600" />
                            </div>
                            <div>
                              <div className="font-semibold text-slate-900">{development.name}</div>
                              <div className="mt-1 text-xs text-slate-500">
                                {development.staff} assigned staff · {development.projects} projects · {development.records} operational records
                              </div>
                              <div className="mt-1 text-xs text-slate-400">
                                Connected {new Date(development.connectedAt).toLocaleDateString()}
                              </div>
                            </div>
                          </div>
                          <span className={`rounded-full px-2 py-1 text-xs font-medium ${development.active ? "bg-teal-50 text-teal-700" : "bg-slate-100 text-slate-500"}`}>
                            {development.active ? "Active" : "Inactive"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

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
