import { useState, useMemo } from "react";
import { 
  useListOrganizations, 
  useUpdateOrganization, 
  OrganizationWithUsage, 
  getListOrganizationsQueryKey 
  ,useListPlatformLicenseAudit
  ,useListPlatformOrganizationProperties, useCreatePlatformOrganizationProperty, useUpdatePlatformOrganizationProperty, useDeletePlatformOrganizationProperty, getListPlatformOrganizationPropertiesQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Building2, Search, Plus, MoreHorizontal, AlertCircle, Edit2, Play, Pause, XCircle, RotateCcw, Users } from "lucide-react";
import { OrganizationDialog } from "@/components/platform-owner/organization-dialog";
import { format, isValid } from "date-fns";

export default function OwnerDashboard() {
  const { data: organizations, isLoading, error } = useListOrganizations();
  const { data: auditHistory = [] } = useListPlatformLicenseAudit({ limit: 25 });
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOrg, setSelectedOrg] = useState<OrganizationWithUsage | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateMutation = useUpdateOrganization();
  const [propertyOrg, setPropertyOrg] = useState<string | null>(null);
  const [propertyAddress, setPropertyAddress] = useState("");
  const { data: properties = [] } = useListPlatformOrganizationProperties(propertyOrg || "", { query: { enabled: !!propertyOrg, queryKey: getListPlatformOrganizationPropertiesQueryKey(propertyOrg || "") } });
  const createProperty = useCreatePlatformOrganizationProperty();
  const updateProperty = useUpdatePlatformOrganizationProperty();
  const deleteProperty = useDeletePlatformOrganizationProperty();

  const filteredOrgs = useMemo(() => {
    if (!organizations) return [];
    if (!searchQuery) return organizations;
    const lowerQuery = searchQuery.toLowerCase();
    return organizations.filter(
      (org) => 
        org.name.toLowerCase().includes(lowerQuery) || 
        org.id.toLowerCase().includes(lowerQuery)
    );
  }, [organizations, searchQuery]);

  const handleCreate = () => {
    setSelectedOrg(null);
    setIsDialogOpen(true);
  };

  const handleEdit = (org: OrganizationWithUsage) => {
    setSelectedOrg(org);
    setIsDialogOpen(true);
  };
  const saveProperty = async () => {
    if (!propertyOrg || !propertyAddress.trim()) return;
    await createProperty.mutateAsync({ organizationId: propertyOrg, data: { displayAddress: propertyAddress.trim(), active: true } });
    setPropertyAddress("");
    queryClient.invalidateQueries({ queryKey: getListPlatformOrganizationPropertiesQueryKey(propertyOrg) });
  };

  const handleStatusChange = async (org: OrganizationWithUsage, newStatus: "active" | "suspended" | "expired") => {
    try {
      await updateMutation.mutateAsync({
        id: org.id,
        data: {
          name: org.name,
          status: newStatus,
        }
      });
      toast({
        title: "Status Updated",
        description: `Organization ${org.name} is now ${newStatus}.`,
      });
      queryClient.invalidateQueries({ queryKey: getListOrganizationsQueryKey() });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Update Failed",
        description: err.message || "Could not update status.",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-12 bg-slate-200 rounded w-1/4"></div>
        <div className="h-96 bg-slate-100 rounded-xl border border-slate-200"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 bg-rose-50 rounded-xl border border-rose-200 flex flex-col items-center justify-center text-rose-800">
        <AlertCircle className="w-10 h-10 mb-4 text-rose-500" />
        <h3 className="text-lg font-bold mb-2">Data Retrieval Failed</h3>
        <p className="text-sm">Unable to fetch organization registry. Verify your platform clearance.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 font-sans">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Organizations Registry</h1>
          <p className="text-slate-500 mt-1">Manage tenant licenses, constraints, and platform limits.</p>
        </div>
        
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input 
              placeholder="Search ID or Name..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-white border-slate-200"
            />
          </div>
          <Button onClick={handleCreate} className="bg-slate-900 text-white hover:bg-slate-800 whitespace-nowrap">
            <Plus className="w-4 h-4 mr-2" />
            Provision Tenant
          </Button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {filteredOrgs.length === 0 ? (
          <div className="p-12 text-center text-slate-500 flex flex-col items-center">
            <Building2 className="w-12 h-12 mb-4 text-slate-300" />
            <p className="text-lg font-medium text-slate-700">No organizations found</p>
            <p className="text-sm mt-1">Adjust your search or provision a new tenant.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50 border-b border-slate-200">
                <TableRow>
                  <TableHead className="w-[150px] font-semibold text-slate-900">Tenant ID</TableHead>
                  <TableHead className="font-semibold text-slate-900">Organization Name</TableHead>
                  <TableHead className="font-semibold text-slate-900">Status</TableHead>
                  <TableHead className="font-semibold text-slate-900">License Dates</TableHead>
                  <TableHead className="font-semibold text-slate-900 text-right">Usage (Staff / Props)</TableHead>
                  <TableHead className="text-right w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrgs.map((org) => {
                  const isActive = org.status === "active";
                  const isSuspended = org.status === "suspended";
                  const isExpired = org.status === "expired";

                  return (
                    <TableRow key={org.id} className="hover:bg-slate-50/50">
                      <TableCell className="font-mono text-sm text-slate-600">{org.id}</TableCell>
                      <TableCell>
                        <div className="font-semibold text-slate-900">{org.name}</div>
                        {org.unrestricted && (
                          <span className="text-[10px] uppercase font-bold tracking-wider text-rose-600 bg-rose-50 px-2 py-0.5 rounded-sm border border-rose-200 mt-1 inline-block">
                            Unrestricted
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant="outline" 
                          className={`
                            ${isActive ? 'bg-teal-50 text-teal-700 border-teal-200' : ''}
                            ${isSuspended ? 'bg-amber-50 text-amber-700 border-amber-200' : ''}
                            ${isExpired ? 'bg-slate-100 text-slate-500 border-slate-200' : ''}
                          `}
                        >
                          {org.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        <div className="flex flex-col gap-1">
                          <div>
                            <span className="text-slate-400 inline-block w-10">Start:</span> 
                            {org.startsAt && isValid(new Date(org.startsAt)) ? format(new Date(org.startsAt), "MMM d, yyyy") : "N/A"}
                          </div>
                          <div>
                            <span className="text-slate-400 inline-block w-10">End:</span> 
                            {org.endsAt && isValid(new Date(org.endsAt)) ? format(new Date(org.endsAt), "MMM d, yyyy") : "N/A"}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-col items-end gap-1 text-sm">
                          <div className="flex items-center gap-2">
                            <Users className="w-3 h-3 text-slate-400" />
                            <span className="font-medium text-slate-700">{org.usage?.staff || 0}</span>
                            <span className="text-slate-400 text-xs">/ {org.staffLimit || '∞'}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Building2 className="w-3 h-3 text-slate-400" />
                            <span className="font-medium text-slate-700">{org.usage?.properties || 0}</span>
                            <span className="text-slate-400 text-xs">/ {org.propertyLimit || '∞'}</span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-slate-900">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48 bg-white">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuItem onClick={() => handleEdit(org)}>
                              <Edit2 className="w-4 h-4 mr-2 text-slate-400" /> Edit Constraints
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setPropertyOrg(org.id); setPropertyAddress(""); }}>
                              <Building2 className="w-4 h-4 mr-2 text-slate-400" /> Manage addresses
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            
                            {!isActive && (
                              <DropdownMenuItem onClick={() => handleStatusChange(org, "active")}>
                                <Play className="w-4 h-4 mr-2 text-teal-500" /> Restore / Activate
                              </DropdownMenuItem>
                            )}
                            
                            {!isSuspended && (
                              <DropdownMenuItem onClick={() => handleStatusChange(org, "suspended")}>
                                <Pause className="w-4 h-4 mr-2 text-amber-500" /> Suspend License
                              </DropdownMenuItem>
                            )}
                            
                            {!isExpired && (
                              <DropdownMenuItem onClick={() => handleStatusChange(org, "expired")} className="text-rose-600 focus:text-rose-600">
                                <XCircle className="w-4 h-4 mr-2 text-rose-500" /> Terminate (Expire)
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <OrganizationDialog 
        open={isDialogOpen} 
        onOpenChange={setIsDialogOpen} 
        organization={selectedOrg} 
      />
      {propertyOrg && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Licensed addresses · {propertyOrg}</h2>
            <Button variant="ghost" onClick={() => setPropertyOrg(null)}>Close</Button>
          </div>
          <div className="flex gap-2 mt-3">
            <Input value={propertyAddress} onChange={(e) => setPropertyAddress(e.target.value)} placeholder="123 Main Street" />
            <Button onClick={saveProperty} disabled={createProperty.isPending}>Add</Button>
          </div>
          <div className="mt-3 space-y-2">
            {properties.map((property) => (
              <div key={property.id} className="flex items-center gap-2 border-b pb-2">
                <span className="flex-1">{property.displayAddress}</span>
                <Button variant="outline" size="sm" onClick={async () => {
                  const next = window.prompt("Update address", property.displayAddress);
                  if (next?.trim()) {
                    await updateProperty.mutateAsync({ organizationId: propertyOrg, propertyId: property.id, data: { displayAddress: next.trim(), active: property.active } });
                    queryClient.invalidateQueries({ queryKey: getListPlatformOrganizationPropertiesQueryKey(propertyOrg) });
                  }
                }}>Edit</Button>
                <Button variant="destructive" size="sm" onClick={async () => {
                  await deleteProperty.mutateAsync({ organizationId: propertyOrg, propertyId: property.id });
                  queryClient.invalidateQueries({ queryKey: getListPlatformOrganizationPropertiesQueryKey(propertyOrg) });
                }}>Delete</Button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="font-semibold text-slate-900">Recent license activity</h2>
        <div className="mt-3 space-y-2 text-sm">
          {auditHistory.slice(0, 8).map((entry) => (
            <div key={entry.id} className="flex justify-between gap-4 border-b border-slate-100 pb-2">
              <span><strong>{entry.action}</strong> · {entry.organizationId}</span>
              <span className="text-slate-500">{entry.ownerName} · {new Date(entry.at).toLocaleString()}</span>
            </div>
          ))}
          {!auditHistory.length && <p className="text-slate-500">No license activity recorded yet.</p>}
        </div>
      </div>
    </div>
  );
}
