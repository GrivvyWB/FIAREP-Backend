import { motion, type Variants } from 'framer-motion';
import { Link } from 'wouter';
import { PERSONA_KEY } from '@/lib/access-policy';
import { 
  ClipboardCheck, Wrench, 
  UserCog, ShoppingCart, Target, Briefcase, ArrowRight, Home,
  CheckCircle2, Blocks, HardHat,
  ShieldCheck, AlertTriangle, Zap
} from 'lucide-react';

const fadeIn: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } }
};

const stagger: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } }
};

const roles = [
  { name: "Management", icon: Target, desc: "Oversight, strategic decisions, and performance scores.", color: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/20" },
  { name: "Supervisors", icon: Briefcase, desc: "Task delegation, tracking, and operational flow.", color: "text-indigo-500", bg: "bg-indigo-500/10", border: "border-indigo-500/20" },
  { name: "Inspectors", icon: ClipboardCheck, desc: "HUD compliance, quality checks, and evidence.", color: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
  { name: "Trade Staff", icon: Wrench, desc: "Repairs, maintenance, and work order execution.", color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20" },
  { name: "Human Resources", icon: UserCog, desc: "Staffing requests, leave management, and personnel.", color: "text-purple-500", bg: "bg-purple-500/10", border: "border-purple-500/20" },
  { name: "Procurement", icon: ShoppingCart, desc: "Vendor management, materials, and purchasing.", color: "text-rose-500", bg: "bg-rose-500/10", border: "border-rose-500/20" },
  { name: "Residents", icon: Home, desc: "Complaints reporting and community transparency.", color: "text-teal-500", bg: "bg-teal-500/10", border: "border-teal-500/20" },
  { name: "Vendors", icon: HardHat, desc: "Project bids, external contracting, and supply.", color: "text-orange-500", bg: "bg-orange-500/10", border: "border-orange-500/20" }
];

export default function Platform() {
  const prepareStaffLogin = () => {
    try {
      localStorage.setItem(PERSONA_KEY, "staff");
    } catch {
      // The login page still handles browsers where storage is unavailable.
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground overflow-x-hidden font-sans" data-testid="page-platform">
      {/* Background Grid */}
      <div className="fixed inset-0 bg-[linear-gradient(to_right,hsl(var(--border))_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border))_1px,transparent_1px)] bg-[size:40px_40px] opacity-[0.3] pointer-events-none -z-10 [mask-image:linear-gradient(to_bottom,white,transparent)] dark:[mask-image:linear-gradient(to_bottom,black,transparent)]" />
      
      {/* Hero Section */}
      <section className="relative pt-24 pb-32 px-6 lg:px-8 max-w-7xl mx-auto flex flex-col items-center text-center">
        <motion.div 
          initial="hidden"
          animate="visible"
          variants={stagger}
          className="max-w-4xl"
        >
          <motion.div variants={fadeIn} className="flex justify-center mb-8">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-foreground font-semibold text-sm border border-primary/20 shadow-sm">
              <Blocks className="w-4 h-4 text-primary" />
              <span data-testid="text-hero-badge">FIAREP Operations Platform</span>
            </div>
          </motion.div>
          
          <motion.h1 variants={fadeIn} className="text-5xl md:text-7xl font-extrabold tracking-tight mb-8 leading-[1.1]" data-testid="text-hero-heading">
            The operating system for <br className="hidden md:block"/>
            <span className="text-primary relative inline-block mt-2 md:mt-0">
              housing developments.
              <svg className="absolute w-full h-3 -bottom-1 left-0 text-primary/30 hidden md:block" viewBox="0 0 100 10" preserveAspectRatio="none">
                <path d="M0 5 Q 50 10 100 5" stroke="currentColor" strokeWidth="4" fill="transparent" />
              </svg>
            </span>
          </motion.h1>
          
          <motion.p variants={fadeIn} className="text-xl md:text-2xl text-muted-foreground mb-12 leading-relaxed max-w-3xl mx-auto" data-testid="text-hero-subheading">
            Connect management, staff, residents, and vendors in one platform built around the daily work of housing developments.
          </motion.p>
          
          <motion.div variants={fadeIn} className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Link href="/" className="inline-flex items-center justify-center rounded-lg bg-primary px-8 py-4 text-base font-bold text-primary-foreground shadow-lg hover:bg-primary/90 transition-all hover:scale-105 hover:shadow-primary/25" data-testid="link-platform-access">
              Enter Platform <ArrowRight className="ml-2 h-5 w-5" />
            </Link>
            <Link href="/login" onClick={prepareStaffLogin} className="inline-flex items-center justify-center rounded-lg bg-card px-8 py-4 text-base font-semibold text-foreground shadow-sm hover:bg-accent/5 hover:text-accent border border-border transition-all hover:border-accent/30" data-testid="link-platform-login">
              Staff Login
            </Link>
          </motion.div>
        </motion.div>
      </section>

      {/* The Ecosystem */}
      <section className="py-24 bg-card/50 border-y border-border">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <motion.div 
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={stagger}
            className="text-center mb-16"
          >
            <motion.h2 variants={fadeIn} className="text-3xl md:text-4xl font-bold mb-4" data-testid="text-ecosystem-heading">One Platform. Every Role.</motion.h2>
            <motion.p variants={fadeIn} className="text-lg text-muted-foreground max-w-2xl mx-auto">
              FIAREP keeps each role connected while preserving the permissions and responsibilities of each team.
            </motion.p>
          </motion.div>

          <motion.div 
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-50px" }}
            variants={stagger}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6"
          >
            {roles.map((role, idx) => (
              <motion.div key={idx} variants={fadeIn} className={`p-6 rounded-2xl border bg-card hover:shadow-lg transition-shadow group ${role.border}`} data-testid={`card-role-${role.name.toLowerCase()}`}>
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110 ${role.bg} ${role.color}`}>
                  <role.icon className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold mb-2">{role.name}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{role.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Core Capabilities */}
      <section className="py-24 max-w-7xl mx-auto px-6 lg:px-8 space-y-32">
        {/* Feature 1 */}
        <motion.div 
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={stagger}
          className="grid md:grid-cols-2 gap-16 items-center"
        >
          <motion.div variants={fadeIn}>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold text-sm mb-6">
              <ShieldCheck className="w-4 h-4" />
              Compliance First
            </div>
            <h3 className="text-3xl md:text-4xl font-bold mb-6">Uncompromising Inspections</h3>
            <p className="text-lg text-muted-foreground mb-8">
              Support HUD inspections, document violations with photo evidence, and track work from inspection through resolution. FIAREP keeps the operational record connected for compliance review and resident safety.
            </p>
            <ul className="space-y-4">
              {['Inspection and HUD review workflows', 'Photo evidence capture and secure storage', 'Connected violations, repairs, and trade requests'].map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0" />
                  <span className="font-medium">{item}</span>
                </li>
              ))}
            </ul>
          </motion.div>
          <motion.div variants={fadeIn} className="relative">
            <div className="absolute inset-0 bg-emerald-500/20 blur-[100px] rounded-full" />
            <div className="rounded-2xl border border-border bg-card shadow-2xl overflow-hidden p-6 relative z-10 hover-elevate">
              <div className="flex justify-between items-center mb-6 border-b border-border pb-4">
                <div className="font-bold text-lg">Unit 4B Inspection</div>
                <div className="px-3 py-1 rounded-full bg-destructive/10 text-destructive text-xs font-bold uppercase tracking-wide">Failed</div>
              </div>
              <div className="space-y-4">
                <div className="flex gap-4 p-4 rounded-xl bg-muted/50">
                  <div className="w-16 h-16 rounded bg-muted flex items-center justify-center border border-border/50 shrink-0">
                     <AlertTriangle className="w-6 h-6 text-muted-foreground/50" />
                  </div>
                  <div className="flex-1 py-1">
                    <div className="h-4 bg-muted-foreground/20 rounded w-3/4 mb-3"></div>
                    <div className="h-3 bg-muted-foreground/10 rounded w-1/2"></div>
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-primary/5 border border-primary/20 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold text-primary mb-1">Work Order #8892 Created</div>
                    <div className="text-xs text-muted-foreground font-medium">Assigned to: Plumbing Staff</div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-primary" />
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>

        {/* Feature 2 */}
        <motion.div 
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={stagger}
          className="grid md:grid-cols-2 gap-16 items-center"
        >
          <motion.div variants={fadeIn} className="order-2 md:order-1 relative">
            <div className="absolute inset-0 bg-accent/20 blur-[100px] rounded-full" />
            <div className="rounded-2xl border border-border bg-card shadow-2xl overflow-hidden p-6 relative z-10 hover-elevate">
              <div className="space-y-4">
                {[
                  { title: "Emergency: Water Leak", time: "2 mins ago", active: true },
                  { title: "Appliance Repair", time: "1 hour ago", active: false },
                  { title: "HVAC Maintenance", time: "3 hours ago", active: false }
                ].map((item, i) => (
                  <div key={i} className={`p-4 rounded-xl border transition-colors ${item.active ? 'border-accent shadow-md bg-accent/5' : 'border-border bg-card'}`}>
                    <div className="flex justify-between items-center mb-3">
                      <div className="font-bold text-sm">{item.title}</div>
                      <div className="text-xs font-medium text-muted-foreground">{item.time}</div>
                    </div>
                    {item.active ? (
                      <div className="flex items-center gap-2 text-accent">
                        <div className="w-2 h-2 rounded-full bg-accent animate-pulse"></div>
                        <span className="text-xs font-bold uppercase tracking-wider">Dispatching On-Call Staff</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span className="text-xs font-medium">Assigned</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
          <motion.div variants={fadeIn} className="order-1 md:order-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 text-accent font-semibold text-sm mb-6">
              <Zap className="w-4 h-4" />
              Rapid Response
            </div>
            <h3 className="text-3xl md:text-4xl font-bold mb-6">Actionable Maintenance</h3>
            <p className="text-lg text-muted-foreground mb-8">
              Turn resident complaints and approved violations into trade requests. Triage emergencies, route work to the right supervisor, and follow assignments through completion.
            </p>
            <ul className="space-y-4">
              {['Emergency alerts and operational dispatch', 'Resident complaint access', 'Supervisor-to-supervisor trade routing'].map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <CheckCircle2 className="w-6 h-6 text-accent shrink-0" />
                  <span className="font-medium">{item}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.div>

        {/* Feature 3 */}
        <motion.div 
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={stagger}
          className="grid md:grid-cols-2 gap-16 items-center"
        >
          <motion.div variants={fadeIn}>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary-foreground dark:text-primary font-semibold text-sm mb-6 border border-primary/20">
              <Target className="w-4 h-4" />
              Total Visibility
            </div>
            <h3 className="text-3xl md:text-4xl font-bold mb-6">Unified Operational Insight</h3>
            <p className="text-lg text-muted-foreground mb-8">
              FIAREP gives authorized management teams connected views of performance scores, leave activity, staffing, projects, estimates, and development operations.
            </p>
            <ul className="space-y-4">
              {['Granular permission management', 'Staff performance and HR requests', 'Capital project and estimate tracking'].map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <CheckCircle2 className="w-6 h-6 text-primary shrink-0" />
                  <span className="font-medium">{item}</span>
                </li>
              ))}
            </ul>
          </motion.div>
          <motion.div variants={fadeIn} className="relative">
             <div className="absolute inset-0 bg-primary/20 blur-[100px] rounded-full" />
             <div className="rounded-2xl border border-border bg-card shadow-2xl overflow-hidden p-8 relative z-10 hover-elevate">
                 <div className="flex items-end gap-6 h-48 pb-4 border-b border-border">
                  <div className="flex-1 flex flex-col justify-end gap-3 h-full group">
                    <div className="w-full bg-primary/20 rounded-t-lg h-[75%] relative overflow-hidden transition-all group-hover:bg-primary/30">
                      <div className="absolute bottom-0 w-full bg-primary rounded-t-lg h-[60%]"></div>
                    </div>
                     <div className="text-sm font-bold text-center text-muted-foreground">Work</div>
                  </div>
                  <div className="flex-1 flex flex-col justify-end gap-3 h-full group">
                    <div className="w-full bg-accent/20 rounded-t-lg h-[100%] relative overflow-hidden transition-all group-hover:bg-accent/30">
                      <div className="absolute bottom-0 w-full bg-accent rounded-t-lg h-[80%]"></div>
                    </div>
                     <div className="text-sm font-bold text-center text-muted-foreground">Safety</div>
                  </div>
                  <div className="flex-1 flex flex-col justify-end gap-3 h-full group">
                    <div className="w-full bg-primary/20 rounded-t-lg h-[85%] relative overflow-hidden transition-all group-hover:bg-primary/30">
                      <div className="absolute bottom-0 w-full bg-primary rounded-t-lg h-[70%]"></div>
                    </div>
                     <div className="text-sm font-bold text-center text-muted-foreground">Projects</div>
                  </div>
                </div>
                <div className="pt-6 flex justify-between items-center">
                   <div>
                      <div className="text-2xl font-black">One View</div>
                      <div className="text-sm font-medium text-muted-foreground">Development Operations</div>
                   </div>
                   <div className="px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold text-sm">
                      Connected
                   </div>
                </div>
             </div>
          </motion.div>
        </motion.div>
      </section>

      {/* Footer CTA */}
      <section className="py-24 border-t border-border bg-card/30">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-5xl font-bold mb-6">Ready for operational clarity?</h2>
          <p className="text-xl text-muted-foreground mb-10">
             Bring complaints, violations, inspections, staff coordination, projects, and compliance work into one connected platform.
          </p>
          <Link href="/login" onClick={prepareStaffLogin} className="inline-flex items-center justify-center rounded-lg bg-primary px-10 py-5 text-lg font-bold text-primary-foreground shadow-xl hover:bg-primary/90 transition-all hover:scale-105" data-testid="link-footer-cta">
            Access Platform Workspace <ArrowRight className="ml-2 h-6 w-6" />
          </Link>
        </div>
      </section>
    </div>
  );
}
