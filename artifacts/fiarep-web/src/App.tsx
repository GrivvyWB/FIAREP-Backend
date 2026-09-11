import { type ReactNode, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import { Shell } from '@/components/layout/shell';

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
import Elevators from '@/pages/elevators';
import Leave from '@/pages/leave';
import Notifications from '@/pages/notifications';
import Settings from '@/pages/settings';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

function AppRouter() {
  const [location, setLocation] = useLocation();
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated && location !== '/login') {
      sessionStorage.setItem('fiarep_return_to', location);
      setLocation('/login');
    }
  }, [isAuthenticated, isLoading, location, setLocation]);

  // If login, don't wrap in Shell
  if (location === '/login') {
    return (
      <RoutedErrorBoundary>
        <Login />
      </RoutedErrorBoundary>
    );
  }

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-background grid place-items-center">
        <p className="text-sm text-muted-foreground">Loading FIAREP...</p>
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
          <Route path="/procurement" component={Procurement} />
          <Route path="/emergency" component={Emergency} />
          <Route path="/elevators" component={Elevators} />
          <Route path="/leave" component={Leave} />
          <Route path="/notifications" component={Notifications} />
          <Route path="/settings" component={Settings} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </Shell>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <AuthProvider>
            <AppRouter />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
