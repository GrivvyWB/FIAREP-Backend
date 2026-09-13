import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Building2,
  Check,
  ChevronDown,
  ClipboardCheck,
  FileBarChart,
  FileText,
  Gavel,
  HardHat,
  Home,
  LayoutDashboard,
  Package,
  PanelLeft,
  Save,
  Settings,
  ShieldCheck,
  Users,
  Wrench,
} from "lucide-react";
import "./_group.css";

type Module = {
  id: string;
  name: string;
  description: string;
  icon: typeof Home;
};

const MODULES: Module[] = [
  { id: "properties", name: "Properties", description: "Properties, buildings, units, asset tracking", icon: Building2 },
  { id: "inspections", name: "Inspections", description: "Templates, reports, photos, field reviews", icon: ClipboardCheck },
  { id: "violations", name: "Violations", description: "Notices, corrective actions, resolution", icon: AlertTriangle },
  { id: "inspectors", name: "Inspectors", description: "Assignments, scheduling, certifications", icon: Users },
  { id: "contractors", name: "Contractors", description: "Database, assignments, contracts, performance", icon: HardHat },
  { id: "work-orders", name: "Work Orders", description: "Service requests, status, completion verification", icon: Wrench },
  { id: "inventory", name: "Inventory", description: "Items, supply tracking, equipment", icon: Package },
  { id: "bidding", name: "Bidding", description: "Bid requests, evaluation, vendor comparisons", icon: Gavel },
  { id: "reports", name: "Reports", description: "Executive, inspection, compliance, financial", icon: FileBarChart },
  { id: "compliance", name: "Compliance", description: "Requirements, controls, evidence", icon: ShieldCheck },
];

const initialEnabled = new Set(["properties", "inspections", "violations", "inspectors", "work-orders", "reports", "compliance"]);

export function Concept() {
  const [enabled, setEnabled] = useState<Set<string>>(initialEnabled);
  const [saved, setSaved] = useState(true);
  const [activeNav, setActiveNav] = useState("Company Settings");

  const enabledModules = useMemo(() => MODULES.filter((module) => enabled.has(module.id)), [enabled]);

  const toggleModule = (id: string) => {
    setEnabled((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    setSaved(false);
  };

  const saveChanges = () => {
    setSaved(true);
  };

  return (
    <div className="fiarep-mockup">
      <div className="fiarep-shell">
        <aside className="fiarep-sidebar">
          <div className="fiarep-brand"><span className="fiarep-brand-mark" />FIAREP</div>
          <div className="fiarep-sidebar-label">PLATFORM CONTROL</div>
          <nav className="fiarep-nav" aria-label="Platform navigation">
            {[
              [LayoutDashboard, "Dashboard"],
              [Building2, "Organizations"],
              [PanelLeft, "Module Management"],
              [Users, "Users & Access"],
              [FileText, "Audit Log"],
            ].map(([Icon, label]) => (
              <button
                key={label as string}
                type="button"
                className={activeNav === label ? "active" : ""}
                onClick={() => setActiveNav(label as string)}
                data-testid={`nav-${(label as string).toLowerCase().replaceAll(" ", "-")}`}
              >
                <Icon size={16} /><span>{label as string}</span>
              </button>
            ))}
          </nav>
          <div className="fiarep-sidebar-label">SYSTEM</div>
          <nav className="fiarep-nav">
            <button type="button" onClick={() => setActiveNav("Settings")} className={activeNav === "Settings" ? "active" : ""} data-testid="nav-settings"><Settings size={16} /><span>Settings</span></button>
          </nav>
          <div className="fiarep-account">
            <div className="fiarep-avatar">AM</div>
            <div><strong>Alex Morgan</strong><span>Platform Administrator</span></div>
            <ChevronDown size={14} style={{ marginLeft: "auto", color: "#7890a5" }} />
          </div>
        </aside>

        <main className="fiarep-main">
          <header className="fiarep-topbar">
            <div className="fiarep-crumb"><span>Platform</span><span>/</span><b>Module Management</b></div>
            <div className="fiarep-top-actions">
              <button type="button" aria-label="Notifications" data-testid="button-notifications"><Bell size={17} /></button>
              <button type="button" aria-label="Help" data-testid="button-help"><span style={{ fontWeight: 700 }}>?</span></button>
              <button type="button" className="fiarep-org-select" data-testid="button-organization-selector">
                <Building2 size={15} color="#0e5bad" />
                <div><span>ORGANIZATION</span><strong>Harborview Housing Authority</strong></div>
                <ChevronDown size={14} color="#8393a1" style={{ marginLeft: "auto" }} />
              </button>
            </div>
          </header>

          <section className="fiarep-content">
            <div className="fiarep-page-head">
              <div>
                <div className="fiarep-eyebrow">Company configuration</div>
                <h1>Module Management</h1>
                <p>Control operational access for Harborview Housing Authority.</p>
              </div>
              <button type="button" className={`fiarep-save ${saved ? "saved" : ""}`} onClick={saveChanges} data-testid="button-save-changes">
                {saved ? <Check size={15} /> : <Save size={15} />}
                {saved ? "Changes saved" : "Save changes"}
              </button>
            </div>

            <div className="fiarep-stats">
              <div className="fiarep-stat"><small>Active modules</small><strong>{enabledModules.length}<em>of 10</em></strong></div>
              <div className="fiarep-stat"><small>Navigation items</small><strong>{enabledModules.length + 2}</strong></div>
              <div className="fiarep-stat"><small>Company status</small><strong style={{ fontSize: 15, marginTop: 8 }}>Active</strong></div>
              <div className="fiarep-stat"><small>Last updated</small><strong style={{ fontSize: 15, marginTop: 8 }}>Today, 09:42</strong></div>
            </div>

            <div className="fiarep-layout">
              <section className="fiarep-panel">
                <div className="fiarep-panel-head">
                  <div><div><h2>Enabled modules</h2><p>Toggle access for this organization.</p></div></div>
                  <span className="fiarep-count">{enabledModules.length} ENABLED</span>
                </div>
                <div>
                  {MODULES.map((module) => {
                    const isEnabled = enabled.has(module.id);
                    const Icon = module.icon;
                    return (
                      <div className={`fiarep-module-row ${isEnabled ? "" : "off"}`} key={module.id}>
                        <div className="fiarep-module-icon"><Icon size={17} /></div>
                        <div className="fiarep-module-copy"><strong>{module.name}</strong><span>{module.description}</span></div>
                        <div className={`fiarep-status ${isEnabled ? "" : "off"}`}>{isEnabled ? "Enabled" : "Disabled"}</div>
                        <button type="button" className={`fiarep-switch ${isEnabled ? "on" : ""}`} onClick={() => toggleModule(module.id)} aria-label={`${isEnabled ? "Disable" : "Enable"} ${module.name}`} data-testid={`toggle-${module.id}`}><span /></button>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="fiarep-panel fiarep-preview">
                <div className="fiarep-panel-head">
                  <div><div><h2>Organization navigation</h2><p>Live view for Harborview users.</p></div></div>
                  <span className="fiarep-live"><i /> LIVE</span>
                </div>
                <div className="fiarep-preview-body">
                  <div className="fiarep-preview-shell">
                    <div className="fiarep-preview-bar"><mark>▰</mark> FIAREP</div>
                    <div className="fiarep-preview-nav">
                      <div className="fiarep-preview-link home"><Home size={14} /> Home</div>
                      {enabledModules.map((module) => {
                        const Icon = module.icon;
                        return <div className="fiarep-preview-link" key={module.id}><Icon size={14} /> {module.name}</div>;
                      })}
                      <div className="fiarep-preview-link settings"><Settings size={14} /> Settings</div>
                    </div>
                    <div className="fiarep-preview-foot"><span>Harborview Housing Authority</span><span>v 4.18.2</span></div>
                  </div>
                </div>
              </section>
            </div>

            <section className="fiarep-panel fiarep-audit">
              <div className="fiarep-panel-head"><div><div><h2>Configuration record</h2><p>Module access changes are retained with company history.</p></div></div><BarChart3 size={17} color="#7990a3" /></div>
              <div className="fiarep-audit-grid">
                <div><small>Organization ID</small><strong style={{ fontFamily: "'Space Mono', monospace", fontSize: 11 }}>HHA-00482</strong></div>
                <div><small>Configured by</small><strong>Alex Morgan</strong></div>
                <div><small>Last change</small><strong>Today, 09:42 EST</strong></div>
                <div><small>Historical data</small><strong style={{ color: "#39846b" }}>Preserved</strong></div>
              </div>
            </section>
          </section>
        </main>
      </div>
    </div>
  );
}

export default Concept;