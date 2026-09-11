import { useAuth } from "@/hooks/use-auth";
import { User, LogOut, Shield, Key } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Settings() {
  const { staff, logout } = useAuth();

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
