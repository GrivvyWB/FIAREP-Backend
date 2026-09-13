import { type ReactNode, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import { OwnerAuthProvider, useOwnerAuth } from '@/hooks/use-owner-auth';
import { Shell } from '@/components/layout/shell';
import { OwnerShell } from '@/components/layout/owner-shell';

// Pages
import NotFound from '@/pages/not-found';
import Login from '@/pages/login';
import Dashboard from '@/pages/dashboard';
import Inspections from '@/pages/inspections';
import NewInspection from '@/pages/inspections/new';
import Estimates from '@/pages/estimates';
import Repairs from '@/pages/repairs';
import Projects from '@/pages/projects';
import Reports from '@/pages/reports';
import UploadReport from '@/pages/reports/upload';
import Calendar from '@/pages/calendar';
import Clients from '@/pages/clients';
import Team from '@/pages/team';
import Violations from '@/pages/violations';
import Procurement from '@/pages/procurement';
import Emergency from '@/pages/emergency';
import ChangeOrders from '@/pages/change-orders';
import Elevators from '@/pages/elevators';
import Leave from '@/pages/leave';
import Notifications from '@/pages/notifications';
import Settings from '@/pages/settings';
import SharedData from '@/pages/shared-data';
import ProcurementLogin from '@/pages/procurement-login';
import ScopeReview from '@/pages/scope-review';
import Scores from '@/pages/scores';

// Owner Pages
import Access from '@/pages/access';
import PublicResident from '@/pages/public-resident';
import PublicVendor from '@/pages/public-vendor';
import OwnerLogin from '@/pages/platform-owner/login';
import OwnerDashboard from '@/pages/platform-owner/index';
import OwnerModules from '@/pages/platform-owner/modules';
import { getStoredPersona, setStoredPersona, evaluateAccess, Persona } from '@/lib/access-policy';
import { useState } from 'react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Staff can update records from the mobile app or another browser.
      // Focus refetch is the inexpensive cross-device freshness path; the
      // operational pages add short targeted intervals where appropriate.
      refetchOnWindowFocus: true,
      retry: false,
    },
  },
});

function AppRouter() {
  const [location, setLocation] = useLocation();
  const { isAuthenticated, isLoading, staff, logout } = useAuth();
  const [isClearingAuth, setIsClearingAuth] = useState(false);

  useEffect(() => {
    if (isLoading) return;

    let currentPersona = getStoredPersona();
    const evaluation = evaluateAccess(currentPersona, location, isAuthenticated);

    if (evaluation.setPersona) {
      setStoredPersona(evaluation.setPersona);
      currentPersona = evaluation.setPersona;

      const newEvaluation = evaluateAccess(currentPersona, location, isAuthenticated);
      Object.assign(evaluation, newEvaluation);
    }

    if (evaluation.clearAuth && isAuthenticated) {
      setIsClearingAuth(true);
      logout();
      setTimeout(() => setIsClearingAuth(false), 100);
      return;
    }

    if (evaluation.redirect) {
      setLocation(evaluation.redirect);
      return;
    }

    if (currentPersona === 'staff') {
      if (!isAuthenticated && location !== '/login' && location !== '/procurement/login') {
        sessionStorage.setItem('fiarep_return_to', location);
        setLocation('/login');
      } else if (isAuthenticated && staff?.role === "procurement" &&
        location !== "/procurement" && !location.startsWith("/procurement/")) {
        setLocation("/procurement");
      }
    }
  }, [isAuthenticated, isLoading, location, setLocation, staff?.role, logout]);

  if (isLoading || isClearingAuth) {
    return (
      <div className="min-h-screen bg-background grid place-items-center">
        <p className="text-sm text-muted-foreground">Loading FIAREP...</p>
      </div>
    );
  }

  const persona = getStoredPersona();

  if (persona === 'resident') {
    return (
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/resident" component={PublicResident} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    );
  }

  if (persona === 'vendor') {
    return (
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/vendor" component={PublicVendor} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    );
  }

  if (!persona) {
    return (
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={Access} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    );
  }

  // Staff routes below
  if (location === '/login') {
    return (
      <RoutedErrorBoundary>
        <Login />
      </RoutedErrorBoundary>
    );
  }

  if (location === '/procurement/login') {
    return <RoutedErrorBoundary><ProcurementLogin /></RoutedErrorBoundary>;
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background grid place-items-center">
        <p className="text-sm text-muted-foreground">Loading FIAREP...</p>
      </div>
    );
  }

  if (location === "/procurement" || location.startsWith("/procurement/")) {
    if (staff?.role !== "procurement") {
      setLocation("/login");
      return null;
    }
    return (
      <div className="min-h-screen bg-background">
        <RoutedErrorBoundary><Switch><Route path="/procurement" component={Procurement} /><Route component={NotFound} /></Switch></RoutedErrorBoundary>
      </div>
    );
  }

  return (
    <Shell>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/inspections" component={Inspections} />
          <Route path="/inspections/new" component={NewInspection} />
          <Route path="/estimates" component={Estimates} />
          <Route path="/repairs" component={Repairs} />
          <Route path="/projects" component={Projects} />
          <Route path="/reports" component={Reports} />
          <Route path="/reports/upload" component={UploadReport} />
          <Route path="/calendar" component={Calendar} />
          <Route path="/clients" component={Clients} />
          <Route path="/team" component={Team} />
          <Route path="/violations" component={Violations} />
          <Route path="/scope-review" component={ScopeReview} />
          <Route path="/procurement" component={Procurement} />
          <Route path="/emergency" component={ManagementRouteEmergency} />
          <Route path="/change-orders" component={ManagementRouteChangeOrders} />
          <Route path="/scores" component={ManagementRouteScores} />
          <Route path="/elevators" component={Elevators} />
          <Route path="/leave" component={Leave} />
          <Route path="/notifications" component={Notifications} />
          <Route path="/settings" component={Settings} />
          <Route path="/shared-data" component={SharedData} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </Shell>
  );
}

function ManagementRoute({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const { staff } = useAuth();
  const allowed = staff?.role === "management" || staff?.role === "administrator";

  useEffect(() => {
    if (!allowed) setLocation(staff?.role === "procurement" ? "/procurement" : "/dashboard");
  }, [allowed, setLocation, staff?.role]);

  return allowed ? <>{children}</> : null;
}

function ManagementRouteEmergency() {
  return <ManagementRoute><Emergency /></ManagementRoute>;
}

function ManagementRouteChangeOrders() {
  return <ManagementRoute><ChangeOrders /></ManagementRoute>;
}

function ManagementRouteScores() {
  return <ManagementRoute><Scores /></ManagementRoute>;
}

function OwnerAppRouter() {
  const [location, setLocation] = useLocation();
  const { isAuthenticated, isLoading } = useOwnerAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated && location !== '/platform-owner/login') {
      sessionStorage.setItem('fiarep_owner_return_to', location);
      setLocation('/platform-owner/login');
    }
  }, [isAuthenticated, isLoading, location, setLocation]);

  if (location === '/platform-owner/login') {
    return (
      <RoutedErrorBoundary>
        <OwnerLogin />
      </RoutedErrorBoundary>
    );
  }

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 grid place-items-center">
        <p className="text-sm text-slate-400">Loading Platform Control...</p>
      </div>
    );
  }

  return (
    <OwnerShell>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/platform-owner/modules" component={OwnerModules} />
          <Route path="/platform-owner" component={OwnerDashboard} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </OwnerShell>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function RootRouter() {
  const [location] = useLocation();

  if (location.startsWith("/platform-owner")) {
    return (
      <OwnerAuthProvider>
        <OwnerAppRouter />
      </OwnerAuthProvider>
    );
  }

  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <RootRouter />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
