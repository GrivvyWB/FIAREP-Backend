import { useAuth } from "@/hooks/use-auth";
import { useListEntityRecords } from "@workspace/api-client-react";
import { ClipboardCheck, FileText, Wrench, AlertTriangle, ArrowRight, ShieldCheck, FileSearch, Building2, Layers } from "lucide-react";
import { Link } from "wouter";

export default function Dashboard() {
  const { staff } = useAuth();
  
  const { data: inspections = [], isLoading: loadingInspections } = useListEntityRecords("inspections");
  const { data: estimates = [], isLoading: loadingEstimates } = useListEntityRecords("cost-estimates");
  const { data: repairs = [], isLoading: loadingRepairs } = useListEntityRecords("project-scopes");
  
  // Computed metrics
  const completedInspections = inspections.filter(i => (i.state as any)?.status === "completed").length;
  const pendingInspections = inspections.filter(i => (i.state as any)?.status === "pending").length;
  
  const firstName = staff?.name?.split(" ")[0] || "User";

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-[14px] p-[26px_30px] shadow-sm mb-[22px] bg-gradient-to-r from-white via-white/90 to-white/20">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-[#b9c6d6] to-[#8fa3b8]" />
        <h1 className="text-[26px] font-extrabold tracking-[-.3px] text-foreground">
          Welcome back, <span className="text-[#F5B301]">{firstName}!</span>
        </h1>
        <p className="text-muted-foreground mt-1.5 text-sm">
          Here's what's happening with your operations today.
        </p>
      </section>

      {/* Metrics */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-[18px] mb-[22px]">
        <MetricCard 
          label="Total Inspections" 
          value={inspections.length} 
          icon={ClipboardCheck} 
          isLoading={loadingInspections}
        />
        <MetricCard 
          label="Estimates Created" 
          value={estimates.length} 
          icon={FileText} 
          isLoading={loadingEstimates}
        />
        <MetricCard 
          label="Repairs Completed" 
          value={repairs.filter(r => (r.state as any)?.status === 'completed').length} 
          icon={Wrench} 
          isLoading={loadingRepairs}
        />
        <MetricCard 
          label="Pending Inspections" 
          value={pendingInspections} 
          icon={AlertTriangle} 
          isLoading={loadingInspections}
        />
      </section>

      {/* Two-column panels */}
      <section className="grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-[18px] mb-[22px]">
        
        {/* Recent Inspections */}
        <div className="bg-card rounded-[14px] shadow-sm border border-border">
          <div className="flex items-center justify-between p-[18px_22px] border-b border-border">
            <h3 className="text-base font-bold">Recent Inspections</h3>
            <Link href="/inspections" className="text-accent text-[13px] font-semibold hover:underline">View all</Link>
          </div>
          <div className="p-[8px_10px]">
            {loadingInspections ? (
              <div className="p-4 text-center text-sm text-muted-foreground">Loading...</div>
            ) : inspections.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
                <ClipboardCheck className="w-8 h-8 opacity-20" />
                No inspections found.
              </div>
            ) : (
              inspections.slice(0, 4).map(insp => (
                <div key={insp.id} className="flex items-center gap-3.5 p-[12px] rounded-[10px] hover:bg-muted/50 transition-colors">
                  <div className="w-12 h-12 rounded-[9px] shrink-0 bg-gradient-to-br from-[#cdd8e4] to-[#9fb2c6] grid place-items-center text-[#5a6b7d]">
                    <Building2 className="w-[22px] h-[22px]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <b className="text-sm font-semibold truncate block">{(insp.state as any)?.title || "Inspection"}</b>
                    <span className="text-[12.5px] text-muted-foreground truncate block">{insp.development || "No location"}</span>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[12.5px] font-bold text-[#F5B301] capitalize">{(insp.state as any)?.status || "New"}</div>
                    <div className="text-xs text-muted-foreground">{new Date(insp.createdAt).toLocaleDateString()}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-card rounded-[14px] shadow-sm border border-border">
          <div className="flex items-center justify-between p-[18px_22px] border-b border-border">
            <h3 className="text-base font-bold">Recent Estimates</h3>
            <Link href="/estimates" className="text-accent text-[13px] font-semibold hover:underline">View all</Link>
          </div>
          <div className="p-[12px_20px_18px] space-y-2">
            {loadingEstimates ? (
              <div className="p-4 text-center text-sm text-muted-foreground">Loading...</div>
            ) : estimates.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
                <FileText className="w-8 h-8 opacity-20" />
                No estimates found.
              </div>
            ) : (
              estimates.slice(0, 4).map(est => (
                <div key={est.id} className="flex gap-3.5 p-3 border-b border-border last:border-0">
                  <div className="w-[34px] h-[34px] rounded-[9px] shrink-0 bg-[#fff5d6] text-[#F5B301] grid place-items-center">
                    <FileText className="w-[17px] h-[17px]" />
                  </div>
                  <div>
                    <b className="text-[13.5px] font-semibold">Estimate: {(est.state as any)?.title || est.id.slice(0,8)}</b>
                    <span className="text-xs text-muted-foreground block mt-0.5">Value: ${(est.state as any)?.amount || 0}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Feature strip */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-[18px]">
        <FeatureCard icon={ShieldCheck} title="Accurate Inspections" desc="Detailed field assessments" />
        <FeatureCard icon={FileSearch} title="Precise Estimations" desc="Accurate repair costing" />
        <FeatureCard icon={Wrench} title="Efficient Repairs" desc="Track and manage repairs" />
        <FeatureCard icon={Layers} title="Complete Reports" desc="Professional documentation" />
      </section>
    </div>
  );
}

function MetricCard({ label, value, icon: Icon, isLoading }: { label: string, value: number, icon: any, isLoading: boolean }) {
  return (
    <div className="bg-card rounded-[14px] shadow-sm border border-border p-5 flex justify-between items-start">
      <div>
        <div className="text-[13px] text-muted-foreground font-medium">{label}</div>
        <div className="text-[30px] font-extrabold my-2 tracking-[-.5px] leading-none">
          {isLoading ? "-" : value}
        </div>
      </div>
      <div className="w-[46px] h-[46px] rounded-xl bg-primary text-sidebar grid place-items-center shrink-0">
        <Icon className="w-[22px] h-[22px]" />
      </div>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, desc }: { icon: any, title: string, desc: string }) {
  return (
    <div className="bg-card rounded-[14px] shadow-sm border border-border p-5 flex items-center gap-3.5">
      <div className="w-[42px] h-[42px] rounded-[11px] shrink-0 bg-primary text-sidebar grid place-items-center">
        <Icon className="w-[21px] h-[21px]" />
      </div>
      <div>
        <b className="text-sm font-bold block">{title}</b>
        <span className="text-[12.5px] text-muted-foreground">{desc}</span>
      </div>
    </div>
  );
}
