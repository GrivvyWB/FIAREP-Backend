import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  getListEntityRecordsQueryKey,
  useCreateEntityRecord,
  useListEntityRecords,
  useUpdateEntityRecord,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { User, LogOut, Shield, Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const DEFAULT_RATES = {
  waste: 1.12,
  sheetCost: 16,
  laborPerSqFt: 2.1,
  paintPerSqFt: 0.85,
  floorPerSqFt: 5.5,
};

export default function Settings() {
  const { staff, logout } = useAuth();
  const { data: rateRecords } = useListEntityRecords("global-settings");
  const createRates = useCreateEntityRecord();
  const updateRates = useUpdateEntityRecord();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const rateRecord = rateRecords?.find((record) => record.id === "default-rates");
  const [rates, setRates] = useState(DEFAULT_RATES);
  const canEditRates = staff?.position === "Borough Director";

  useEffect(() => {
    if (rateRecord?.state) setRates({ ...DEFAULT_RATES, ...(rateRecord.state as Partial<typeof DEFAULT_RATES>) });
  }, [rateRecord]);

  const saveRates = async () => {
    try {
      if (rateRecord) {
        await updateRates.mutateAsync({
          entity: "global-settings",
          id: rateRecord.id,
          data: { id: rateRecord.id, state: rates, version: rateRecord.version },
        });
      } else {
        await createRates.mutateAsync({
          entity: "global-settings",
          data: { id: "default-rates", state: rates, version: 1 },
        });
      }
      await queryClient.invalidateQueries({ queryKey: getListEntityRecordsQueryKey("global-settings") });
      toast({ title: "Default rates saved", description: "Mobile devices will receive these rates during synchronization." });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Unable to save rates", description: error?.message || "Please try again." });
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">Manage your session and profile.</p>
      </div>

      <div className="bg-card rounded-[14px] shadow-sm border border-border overflow-hidden">
        <div className="p-6 border-b border-border">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#3d6fa8] to-[#185FA5] text-white grid place-items-center font-bold text-2xl shrink-0">
              {staff?.name?.split(' ').map(n => n[0]).join('').substring(0,2).toUpperCase()}
            </div>
            <div>
              <h2 className="text-xl font-bold">{staff?.name}</h2>
              <p className="text-muted-foreground">{staff?.position || "Staff Member"}</p>
            </div>
          </div>
        </div>
        
        <div className="p-6 space-y-8">
          <div className="space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <User className="w-4 h-4" /> Profile Details
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-secondary/50 p-4 rounded-xl border border-border">
                <div className="text-xs text-muted-foreground font-medium mb-1">Role</div>
                <div className="font-semibold">{staff?.role || "-"}</div>
              </div>
              <div className="bg-secondary/50 p-4 rounded-xl border border-border">
                <div className="text-xs text-muted-foreground font-medium mb-1">Status</div>
                <div className="font-semibold capitalize">{staff?.status || "Active"}</div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Calculator className="w-4 h-4" /> Shared Default Rates
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                ["waste", "Waste multiplier"],
                ["sheetCost", "Drywall sheet cost"],
                ["laborPerSqFt", "Labor per sq. ft."],
                ["paintPerSqFt", "Paint per sq. ft."],
                ["floorPerSqFt", "Flooring per sq. ft."],
              ].map(([key, label]) => (
                <label key={key} className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">{label}</span>
                  <Input
                    type="number"
                    step="0.01"
                    disabled={!canEditRates}
                    value={rates[key as keyof typeof rates]}
                    onChange={(event) => setRates((current) => ({
                      ...current,
                      [key]: Number(event.target.value),
                    }))}
                  />
                </label>
              ))}
            </div>
            {canEditRates ? (
              <Button
                onClick={saveRates}
                disabled={createRates.isPending || updateRates.isPending}
              >
                Save shared rates
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">Only the Borough Director can change shared default rates.</p>
            )}
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Shield className="w-4 h-4" /> Access & Security
            </h3>
            <div className="bg-secondary/50 p-4 rounded-xl border border-border">
              <div className="text-xs text-muted-foreground font-medium mb-1">Assigned Developments</div>
              <div className="font-semibold">
                {staff?.developments?.length 
                  ? staff.developments.join(', ') 
                  : "All Access (System Wide)"}
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 bg-muted/30 border-t border-border flex justify-between items-center">
          <div>
            <h4 className="font-semibold text-sm">Session Management</h4>
            <p className="text-xs text-muted-foreground mt-0.5">Sign out of this device to clear your session.</p>
          </div>
          <Button variant="destructive" onClick={() => logout()} className="gap-2">
            <LogOut className="w-4 h-4" /> Sign Out
          </Button>
        </div>
      </div>
    </div>
  );
}
