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
import { Copy } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateOrganization, useUpdateOrganization, OrganizationWithUsage, getListOrganizationsQueryKey, OrganizationInputStatus } from "@workspace/api-client-react";
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
  directorCode: z.string().length(4, "Must be exactly 4 chars").regex(/^[a-zA-Z0-9]+$/, "Letters and numbers only").optional().or(z.literal("")),
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
  const [copySucceeded, setCopySucceeded] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

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
      directorCode: "",
    },
  });

  const createMutation = useCreateOrganization();
  const updateMutation = useUpdateOrganization();

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
        directorCode: "",
      });
    } else if (!open) {
      setGeneratedCode("");
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
        directorCode: "",
      });
    }
  }, [organization, open, form]);

  const onSubmit = async (values: FormValues) => {
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
        directorCode: values.directorCode || undefined,
        features: {},
      };

      if (isEditing) {
        const { directorName: _directorName, directorCode: _directorCode, ...updates } = payload;
        await updateMutation.mutateAsync({ id: organization!.id, data: updates });
        toast({ title: "Organization updated successfully." });
      } else {
        const result = await createMutation.mutateAsync({ data: payload });
        setGeneratedCode(result.organization.id);
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

  const isLoading = createMutation.isPending || updateMutation.isPending;
  const canCloseAfterCreation = !generatedCode || copySucceeded || acknowledged;
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !canCloseAfterCreation) return;
    if (!nextOpen) {
      setGeneratedCode("");
      setCopySucceeded(false);
      setCopyError("");
      setAcknowledged(false);
    }
    onOpenChange(nextOpen);
  };
  const copyOrganizationCode = async () => {
    try {
      await navigator.clipboard.writeText(generatedCode);
      setCopySucceeded(true);
      setCopyError("");
    } catch {
      setCopyError("Copy failed. Use the acknowledgment below after saving the code manually.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl bg-white border-slate-200">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-slate-900">
            {isEditing ? "Edit Organization" : "Register Organization"}
          </DialogTitle>
          <DialogDescription className="text-slate-500">
            {isEditing 
              ? "Update platform licensing and limits for this organization." 
              : "Provision a new tenant environment and optional initial administrator."}
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
                <label htmlFor="generated-organization-code" className="text-sm font-semibold text-teal-900">Organization Code</label>
                <div className="mt-2 flex gap-2">
                  <Input id="generated-organization-code" value={generatedCode} readOnly className="font-mono bg-white" />
                  <Button type="button" variant="outline" onClick={copyOrganizationCode}>
                    <Copy className="mr-2 h-4 w-4" /> Copy
                  </Button>
                </div>
                <p className="mt-2 text-sm text-teal-800">Save this code. Organization staff use it when signing in.</p>
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
                      <FormLabel className="text-slate-700">Property Limit</FormLabel>
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
            </div>

            {!isEditing && (
              <div className="space-y-4 pt-2">
                <h4 className="font-semibold text-slate-900 border-b border-slate-100 pb-2">Initial Setup</h4>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="directorName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-700">Director Name</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Jane Doe" {...field} />
                        </FormControl>
                        <FormDescription>Creates the first administrative user.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="directorCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-700">Director Code</FormLabel>
                        <FormControl>
                          <Input placeholder="4-char code" {...field} maxLength={4} className="uppercase font-mono" />
                        </FormControl>
                        <FormDescription>Access code for the director to login.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
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
