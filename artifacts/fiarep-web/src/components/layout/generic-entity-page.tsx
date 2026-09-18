import { 
  useListEntityRecords, 
  useCreateEntityRecord, 
  useUpdateEntityRecord, 
  useDeleteEntityRecord,
  usePerformEntityAction,
  getListEntityRecordsQueryKey,
  useGetDeletionPolicy,
  EntityRecord
} from "@workspace/api-client-react";
import { Search, Plus, Edit2, Trash2, LucideIcon, MapPin, AlignLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { FieldEvidenceDisplay } from "@/components/field-evidence-display";
import { invalidateOperationalQueries } from "@/lib/query-invalidation";
import { canApproveWork } from "@/lib/access-policy";
import { useAuth } from "@/hooks/use-auth";

const formSchema = z.object({
  title: z.string().min(1, "Title is required"),
  development: z.string().optional(),
  description: z.string().optional(),
  status: z.string().optional(),
  date: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export function GenericEntityPage({ 
  entity, 
  title, 
  description, 
  icon: Icon,
  workflow = false,
  headerAction,
}: { 
  entity: string;
  title: string;
  description: string;
  icon: LucideIcon;
  workflow?: boolean;
  headerAction?: ReactNode;
}) {
  const isProcurement = entity === "procurement";
  const { data, isLoading } = useListEntityRecords(entity, undefined, {
    query: {
      queryKey: getListEntityRecordsQueryKey(entity),
      staleTime: 15_000,
      refetchOnMount: "always",
      refetchInterval: isProcurement ? 15_000 : false,
    },
  });
  const { data: bidData } = useListEntityRecords(
    "procurement-bids",
    undefined,
    {
      query: {
        queryKey: getListEntityRecordsQueryKey("procurement-bids"),
        enabled: isProcurement,
        staleTime: 15_000,
        refetchOnMount: "always",
      },
    },
  );
  const createMutation = useCreateEntityRecord();
  const updateMutation = useUpdateEntityRecord();
  const deleteMutation = useDeleteEntityRecord();
  const actionMutation = usePerformEntityAction();
  
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { staff } = useAuth();
  const { data: deletionPolicy } = useGetDeletionPolicy();

  const [search, setSearch] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<EntityRecord | null>(null);
  
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null);
  const [selectedBid, setSelectedBid] = useState<Record<string, string>>({});

  // Protected entities manage their own workflow/status via other actions
  const protectedEntities = [
    'procurement',
    'resident-reports',
    'building-violations',
    'leave-requests',
    'elevator-jobs',
    'emergency-jobs',
  ];
  const isProtected = protectedEntities.includes(entity);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      development: "",
      description: "",
      status: "new",
      date: new Date().toISOString().split('T')[0],
    }
  });

  const handleOpenCreate = () => {
    setEditingRecord(null);
    form.reset({
      title: "",
      development: "",
      description: "",
      status: "new",
      date: new Date().toISOString().split('T')[0],
    });
    setIsFormOpen(true);
  };

  const handleOpenEdit = (record: EntityRecord) => {
    setEditingRecord(record);
    const state = record.state as any || {};
    form.reset({
      title: state.title || state.name || "",
      development: record.development || "",
      description: state.description || "",
      status: state.status || "new",
      date: state.date || new Date().toISOString().split('T')[0],
    });
    setIsFormOpen(true);
  };

  const onSubmit = async (values: FormValues) => {
    try {
      const statePayload = {
        title: values.title,
        description: values.description,
        date: values.date,
        ...(!isProtected ? { status: values.status } : {}),
      };

      if (editingRecord) {
        await updateMutation.mutateAsync({
          entity,
          id: editingRecord.id,
          data: {
            id: editingRecord.id,
            development: values.development,
            state: statePayload,
            version: editingRecord.version,
          }
        });
        toast({ title: "Updated successfully" });
      } else {
        await createMutation.mutateAsync({
          entity,
          data: {
            id: crypto.randomUUID(),
            development: values.development,
            state: statePayload,
            version: 1,
          }
        });
        toast({ title: "Created successfully" });
      }
      
      await invalidateOperationalQueries(queryClient, entity, editingRecord?.id, isProcurement ? ["procurement-bids"] : []);
      setIsFormOpen(false);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err?.message || "Failed to save." });
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingRecordId) return;
    const deletingRecord = data?.find((record) => record.id === deletingRecordId);
    if (!deletingRecord) return;
    try {
      await deleteMutation.mutateAsync({
        entity,
        id: deletingRecordId,
        data: { version: deletingRecord.version },
      });
      toast({ title: "Deleted successfully" });
      await invalidateOperationalQueries(queryClient, entity, deletingRecordId, isProcurement ? ["procurement-bids"] : []);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err?.message || "Failed to delete." });
    } finally {
      setIsDeleteDialogOpen(false);
      setDeletingRecordId(null);
    }
  };

  const performAction = async (record: EntityRecord, action: string, bid?: any) => {
    try {
      if (action === "award" && !bid) throw new Error("Select an existing vendor bid before awarding.");
      await actionMutation.mutateAsync({ entity, id: record.id, action, data: action === "award" ? { vendor: bid.vendorName, bidAmount: bid.amount, bidNote: bid.note, bidId: bid.id } : undefined });
      await invalidateOperationalQueries(queryClient, entity, record.id, isProcurement ? ["procurement-bids"] : []);
      toast({ title: `${action} completed` });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Workflow action failed", description: err?.message || "Action unavailable" });
    }
  };

  const filtered = data?.filter(i => {
    if (!search) return true;
    const itemTitle = (i.state as any)?.title?.toLowerCase() || i.id.toLowerCase();
    const q = search.toLowerCase();
    return itemTitle.includes(q);
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        {headerAction ?? (!isProcurement && <Button onClick={handleOpenCreate} className="font-semibold gap-2" data-testid={`button-create-${entity}`}>
          <Plus className="w-4 h-4" /> New {title.replace(/s$/, '')}
        </Button>)}
      </div>

      <div className="bg-card rounded-[14px] shadow-sm border border-border">
        <div className="p-4 border-b border-border flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder={`Search ${title.toLowerCase()}...`} 
              className="pl-9"
              value={search}
              onChange={e => setSearch(e.target.value)}
              data-testid={`input-search-${entity}`}
            />
          </div>
        </div>

        <div className="p-4">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading {title.toLowerCase()}...</div>
          ) : filtered?.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center">
              <Icon className="w-12 h-12 text-muted-foreground/30 mb-4" />
              <h3 className="text-lg font-bold">No {title.toLowerCase()} found</h3>
            </div>
          ) : (
            <div className="grid gap-3">
              {filtered?.map(item => {
                const state = item.state as any;
                 const walkthroughCheckIns = isProcurement && staff?.role === "procurement" && Array.isArray(state?.walkthroughCheckIns)
                   ? state.walkthroughCheckIns
                   : [];
                return (
                  <div key={item.id} data-testid={`row-${entity}-${item.id}`} className="flex items-center gap-4 p-4 rounded-xl border border-border hover:bg-muted/30 transition-colors">
                    <div className="w-12 h-12 rounded-[9px] bg-secondary text-secondary-foreground grid place-items-center shrink-0">
                      <Icon className="w-6 h-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-[15px] truncate" data-testid={`text-title-${item.id}`}>
                        {state?.title || state?.name || state?.address || `${title} ${item.id.slice(0,8)}`}
                      </h4>
                      {item.development && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1 truncate" data-testid={`text-dev-${item.id}`}>
                          <MapPin className="w-3 h-3" />
                          {item.development}
                        </div>
                      )}
                      {state?.description && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1 truncate max-w-sm" data-testid={`text-desc-${item.id}`}>
                          <AlignLeft className="w-3 h-3" />
                          {state.description}
                        </div>
                      )}
                       {walkthroughCheckIns.map((checkIn: any) => {
                         const latitude = Number(checkIn?.latitude);
                         const longitude = Number(checkIn?.longitude);
                         const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);
                         return (
                           <div key={String(checkIn?.id)} className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-950">
                             <div className="font-semibold">Walk-Through Check-In · {String(checkIn?.vendorName || "Vendor")}</div>
                             <div>{new Date(String(checkIn?.receivedAt)).toLocaleString()}</div>
                             {hasCoordinates && (
                               <a
                                 href={`https://www.google.com/maps?q=${latitude},${longitude}`}
                                 target="_blank"
                                 rel="noreferrer"
                                 className="underline"
                               >
                                 {latitude.toFixed(6)}, {longitude.toFixed(6)}
                                 {Number.isFinite(Number(checkIn?.accuracy)) ? ` · ±${Math.round(Number(checkIn.accuracy))} m` : ""}
                               </a>
                             )}
                           </div>
                         );
                             })}
                    </div>
                     <div className="text-right shrink-0">
                      {state?.status && (
                        <div className="text-[13px] font-bold text-primary capitalize px-2 py-0.5 rounded-full bg-primary/10 inline-block mb-1" data-testid={`text-status-${item.id}`}>
                          {state.status}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground block">
                        {new Date(item.createdAt).toLocaleDateString()}
                      </div>
                       {workflow && state?.status !== "closed" && (
                         <div className="flex flex-wrap justify-end gap-1 mt-2">
                             {((
                               isProcurement
                                 ? [["approved", "return"], ["approved", "broadcast"], ["bidding", "award"], ["awarded", "rate-close"]]
                                 : entity === "building-violations"
                                   ? [
                                       ...(canApproveWork(staff) ? [["submitted", "approve"], ["approved", "route"], ["done", "approve-work"]] : []),
                                       ...(!canApproveWork(staff) ? [["routed", "complete"]] : []),
                                     ]
                                   : []
                             ) as Array<[string, string]>).filter(([status]) => status === state?.status).map(([, action]) => {
                               if (action !== "award") return <Button key={action} size="sm" variant="outline" onClick={() => performAction(item, action)}>{action === "approve-work" ? "Approve Work" : action}</Button>;
                              const bids = (bidData || []).filter((b: any) => (b.state as any)?.requestId === item.id);
                              return <span key={action} className="flex gap-1 items-center">
                                <select className="h-9 rounded-md border px-2 text-sm" value={selectedBid[item.id] || ""} onChange={(e) => setSelectedBid((s) => ({ ...s, [item.id]: e.target.value }))}>
                                  <option value="">Select bid</option>
                                  {bids.map((b: any) => <option key={b.id} value={b.id}>{(b.state as any)?.vendorName} · ${Number((b.state as any)?.amount || 0).toLocaleString()} · {(b.state as any)?.note || "No note"}</option>)}
                                </select>
                                <Button size="sm" variant="outline" disabled={!selectedBid[item.id]} onClick={() => performAction(item, action, bids.find((b: any) => b.id === selectedBid[item.id])?.state && { id: selectedBid[item.id], ...(bids.find((b: any) => b.id === selectedBid[item.id])?.state as any) })}>award</Button>
                              </span>;
                            })}
                         </div>
                       )}
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      {(!workflow || (!isProcurement && state?.status !== "closed")) && (
                        <Button variant="ghost" size="icon" onClick={() => handleOpenEdit(item)} data-testid={`button-edit-${item.id}`}>
                          <Edit2 className="w-4 h-4" />
                        </Button>
                      )}
                      {deletionPolicy?.enabled && deletionPolicy.canDelete && (!isProcurement || state?.status !== "closed") && (
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => { setDeletingRecordId(item.id); setIsDeleteDialogOpen(true); }} data-testid={`button-delete-${item.id}`}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{editingRecord ? `Edit ${title.replace(/s$/, '')}` : `Create ${title.replace(/s$/, '')}`}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter title" {...field} data-testid="input-title" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="development"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Development</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter development" {...field} data-testid="input-development" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description / Details</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Enter details" className="resize-none" {...field} data-testid="input-description" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {!isProtected && (
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. pending, in-progress, completed" {...field} data-testid="input-status" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} data-testid="input-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter className="pt-4">
                <Button type="button" variant="ghost" onClick={() => setIsFormOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} data-testid="button-submit-form">
                  {(createMutation.isPending || updateMutation.isPending) ? "Saving..." : "Save"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
          {editingRecord && (
            <div className="mt-4 pt-4 border-t border-border">
              <FieldEvidenceDisplay state={editingRecord.state as any} />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete this record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="button-confirm-delete">
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
