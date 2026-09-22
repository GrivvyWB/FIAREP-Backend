import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, AppState, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter, usePathname } from 'expo-router';
import {
  getAppMode, setAppMode,
  verifyStaffLogin,
  setRememberedStaff,
   restoreServerSession, logout, clearAppMode, clearRememberedStaff,
   getInstallationPersona, setInstallationPersona,
   inferInstallationPersona,
   type AppMode, type InstallationPersona } from '../lib/store';
import { ui, ACCENT } from '../lib/ui';
import { syncAllEntities } from '../lib/sync';
import { clearBadge } from '../lib/push';
import { loadModuleConfig, refreshModuleConfig, moduleForRoute, moduleEnabled } from '../lib/module-access';

type ModeCtx = { mode: AppMode | null; loading: boolean; refresh: () => void };
const ModeContext = createContext<ModeCtx>({ mode: null, loading: true, refresh: () => {} });
export function useAppMode() { return useContext(ModeContext); }

const CODE_LEN = 16;
const normCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, CODE_LEN);

const HOME_FOR_MODE: Record<AppMode, string> = {
  management: '/management-home',
  administrator: '/admin-home',
  worker: '/worker-home',
  inspector: '/cpm-home',
  resident: '/resident-home',
  vendor: '/vendor-home',
  emergency: '/worker-home',
};

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, gap: 12 }} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function StaffGate(props: { onUnlock: (overrideMode?: AppMode) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  async function doLogin() {
    setMsg(''); setBusy(true);
    try {
      const ok = await verifyStaffLogin(name.trim(), normCode(code));
      if (ok) {
        const actor = await restoreServerSession();
        await refreshModuleConfig().catch(() => undefined);
        const supportedRoles: AppMode[] = ['administrator', 'management', 'worker', 'inspector', 'emergency'];
        const actualRole = actor?.role;
        if (!actualRole || !supportedRoles.includes(actualRole as AppMode)) {
          setMsg('This account has an unsupported mobile staff role. Contact an administrator.');
          return;
        }
        const modeRole = actualRole as AppMode;
        await setRememberedStaff(modeRole, name.trim()).catch(() => undefined);
        await syncAllEntities().catch(() => undefined);
        props.onUnlock(modeRole);
      }
      else setMsg('No approved account matches that name and code.');
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        (error as { status?: unknown }).status === 403
      ) {
        setMsg('Organization license is not active.');
      } else {
        setMsg('Could not reach the FIAREP backend. Try again.');
      }
    } finally { setBusy(false); }
  }

  if (!ready) {
    return <Screen><ActivityIndicator /></Screen>;
  }

  return (
    <Screen>
      <Text style={{ fontSize: 24, fontWeight: '600', textAlign: 'center' }}>Staff Member</Text>
      <Text style={[ui.label, { textAlign: 'center' }]}>
        Log in with the name and code you were issued.
      </Text>

      <Text style={ui.label}>Name</Text>
      <TextInput
        style={ui.input}
        value={name}
        onChangeText={setName}
        placeholder="Your name"
        autoCapitalize="words"
      />
      <>
          <Text style={ui.label}>Code</Text>
          <TextInput
            style={[ui.input, { textAlign: 'center', fontSize: 22, letterSpacing: 4 }]}
            value={code}
            onChangeText={(t) => setCode(normCode(t))}
            placeholder="Code"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={CODE_LEN}
          />
      </>

      {!!msg && <Text style={{ color: '#c00', textAlign: 'center' }}>{msg}</Text>}

      <Pressable style={ui.btn} onPress={doLogin} disabled={busy}>
        <Text style={ui.btnText}>{busy ? '…' : 'Log in'}</Text>
      </Pressable>
      <Pressable style={ui.btnOutline} onPress={props.onCancel}>
        <Text style={ui.btnOutlineText}>Cancel</Text>
      </Pressable>
    </Screen>
  );
}

function PersonaPicker({ onPick }: { onPick: (persona: InstallationPersona) => void }) {
  return (
    <Screen>
      <Image
        source={require('../assets/field-inspection-logo.png')}
        accessibilityLabel="FIAREP logo"
        resizeMode="contain"
        style={{ width: 300, height: 150, alignSelf: 'center', marginBottom: 6 }}
      />
      <Text style={{ fontSize: 26, fontWeight: '600', textAlign: 'center' }}>Who's using this device?</Text>
      <Pressable style={ui.btn} onPress={() => onPick('resident')}>
        <Text style={ui.btnText}>Resident</Text>
      </Pressable>
      <Pressable style={ui.btn} onPress={() => onPick('vendor')}>
        <Text style={ui.btnText}>Vendor</Text>
      </Pressable>
      <Pressable style={ui.btn} onPress={() => onPick('staff')}>
        <Text style={ui.btnText}>Staff</Text>
      </Pressable>
    </Screen>
  );
}

function ModePicker({ onPick, notice }: { onPick: (m: AppMode) => void; notice?: string }) {
  const [gateFor, setGateFor] = useState(false);

  if (gateFor) {
    return (
      <StaffGate
        onUnlock={(override?: AppMode) => { setGateFor(false); onPick(override || 'management'); }}
        onCancel={() => setGateFor(false)}
      />
    );
  }

  return (
    <Screen>
      <Image
        source={require('../assets/field-inspection-logo.png')}
        accessibilityLabel="FIAREP logo"
        resizeMode="contain"
        style={{ width: 300, height: 150, alignSelf: 'center', marginBottom: 6 }}
      />
      <Text style={{ fontSize: 26, fontWeight: '600', textAlign: 'center' }}>Staff sign in</Text>
      {!!notice && <Text style={{ color: '#9a3412', textAlign: 'center', marginBottom: 8 }}>{notice}</Text>}
      <Pressable style={ui.btn} onPress={() => setGateFor(true)}>
        <Text style={ui.btnText}>Staff Member  🔒</Text>
      </Pressable>
    </Screen>
  );
}

function AdministratorStack() {
  return (
    <Stack initialRouteName="admin-home">
      <Stack.Screen name="admin-home" options={{ title: 'Administrator', headerBackVisible: false }} />
      <Stack.Screen name="attendance" options={{ title: 'Attendance' }} />
      <Stack.Screen name="dispatch-job" options={{ title: 'Assign a Job' }} />
      <Stack.Screen name="in-house-assignments" options={{ title: 'In-house assignments' }} />
      <Stack.Screen name="report-detail" options={{ title: 'Job Details' }} />
      <Stack.Screen name="admin-job" options={{ title: 'Add Job' }} />
      <Stack.Screen name="change-orders" options={{ title: 'Change Orders' }} />
      <Stack.Screen name="notifications" options={{ title: 'Inbox' }} />
      <Stack.Screen name="manage-requests" options={{ title: 'Manage Requests' }} />
      <Stack.Screen name="assign-emergency" options={{ title: 'Assign Emergency Unit' }} />
      <Stack.Screen name="manage-trucks" options={{ title: 'Emergency Units' }} />
      <Stack.Screen name="truck-scores" options={{ title: 'Truck Scores' }} />
      <Stack.Screen name="emergency-activity" options={{ title: 'Emergency Activity' }} />
      <Stack.Screen name="leave-request" options={{ title: 'Request Time Off' }} />
      <Stack.Screen name="leave-dashboard" options={{ title: 'Leave Calendar' }} />
      <Stack.Screen name="contractor-scores" options={{ title: 'Contractor Scores' }} />
      <Stack.Screen name="dev-scores" options={{ title: 'Development Scores' }} />
      <Stack.Screen name="property-scores" options={{ title: 'Building & Residential Scores' }} />
      <Stack.Screen name="management" options={{ title: 'Resident Reports' }} />
      <Stack.Screen name="worker" options={{ title: 'Worker Jobs' }} />
      <Stack.Screen name="resident" options={{ title: 'Report an Issue' }} />
      <Stack.Screen name="resident-lookup" options={{ title: 'Check Report Status' }} />
      <Stack.Screen name="index" options={{ title: 'Projects' }} />
      <Stack.Screen name="project/[id]" options={{ title: 'Project' }} />
      <Stack.Screen name="project/intake" options={{ title: 'Intake' }} />
      <Stack.Screen name="project/inspection" options={{ title: 'Inspection' }} />
      <Stack.Screen name="project/compass" options={{ title: 'Compass' }} />
      <Stack.Screen name="project/room" options={{ title: 'Add room', presentation: 'modal' }} />
      <Stack.Screen name="settings" options={{ title: 'Default rates' }} />
      <Stack.Screen name="project/rates" options={{ title: 'Project rates', presentation: 'modal' }} />
      <Stack.Screen name="project/roof" options={{ title: 'Roof lookup', presentation: 'modal' }} />
      <Stack.Screen name="project/checklist" options={{ title: 'Renovation checklist' }} />
      <Stack.Screen name="project/project-scope" options={{ title: 'Scope of Work' }} />
      <Stack.Screen name="project/photos" options={{ title: 'Photos' }} />
      <Stack.Screen name="project/scans" options={{ title: 'Scans' }} />
      <Stack.Screen name="project/roofplan" options={{ title: 'Roof plan sketch' }} />
      <Stack.Screen name="hud-inspections" options={{ title: 'HUD Inspections' }} />
      <Stack.Screen name="hud-inspection" options={{ title: 'HUD Inspection' }} />
      <Stack.Screen name="hud-review" options={{ title: 'HUD Inspections' }} />
      <Stack.Screen name="hud-view" options={{ title: 'Inspection' }} />
      <Stack.Screen name="violation-send" options={{ title: 'Send Violation' }} />
      <Stack.Screen name="assign-route" options={{ title: 'Assign a Route' }} />
    </Stack>
  );
}

function InspectorStack() {
  return (
    <Stack initialRouteName="cpm-home">
      <Stack.Screen name="cpm-home" options={{ title: 'CPM / Inspector', headerBackVisible: false }} />
      <Stack.Screen name="attendance" options={{ title: 'Attendance' }} />
      <Stack.Screen name="create-report" options={{ title: 'Create Report' }} />
      <Stack.Screen name="leave-request" options={{ title: 'Request Time Off' }} />
      <Stack.Screen name="leave-dashboard" options={{ title: 'Leave Calendar' }} />
      <Stack.Screen name="notifications" options={{ title: 'Inbox' }} />
      <Stack.Screen name="report-detail" options={{ title: 'Job Details' }} />
      <Stack.Screen name="inspector-violations" options={{ title: 'Log Violations' }} />
      <Stack.Screen name="fiarep-vision" options={{ title: 'FIAREP Vision' }} />
      <Stack.Screen name="cpm-change-order" options={{ title: 'Change Work Order' }} />
      <Stack.Screen name="inspector-routes" options={{ title: 'My Routes' }} />
      <Stack.Screen name="scope-submit" options={{ title: 'Submit Scope' }} />
      <Stack.Screen name="index" options={{ title: 'Projects' }} />
      <Stack.Screen name="project/[id]" options={{ title: 'Project' }} />
      <Stack.Screen name="project/intake" options={{ title: 'Intake' }} />
      <Stack.Screen name="project/inspection" options={{ title: 'Inspection' }} />
      <Stack.Screen name="project/compass" options={{ title: 'Compass' }} />
      <Stack.Screen name="project/room" options={{ title: 'Add room', presentation: 'modal' }} />
      <Stack.Screen name="settings" options={{ title: 'Default rates' }} />
      <Stack.Screen name="project/rates" options={{ title: 'Project rates', presentation: 'modal' }} />
      <Stack.Screen name="project/roof" options={{ title: 'Roof lookup', presentation: 'modal' }} />
      <Stack.Screen name="project/checklist" options={{ title: 'Renovation checklist' }} />
      <Stack.Screen name="project/project-scope" options={{ title: 'Scope of Work' }} />
      <Stack.Screen name="project/photos" options={{ title: 'Photos' }} />
      <Stack.Screen name="project/scans" options={{ title: 'Scans' }} />
      <Stack.Screen name="project/roofplan" options={{ title: 'Roof plan sketch' }} />
      <Stack.Screen name="hud-inspections" options={{ title: 'HUD Inspections' }} />
      <Stack.Screen name="hud-inspection" options={{ title: 'HUD Inspection' }} />
      <Stack.Screen name="hud-review" options={{ title: 'HUD Inspections' }} />
      <Stack.Screen name="hud-view" options={{ title: 'Inspection' }} />
    </Stack>
  );
}

function ManagementStack() {
  return (
    <Stack initialRouteName="management-home">
      <Stack.Screen name="management-home" options={{ title: 'Management', headerBackVisible: false }} />
      <Stack.Screen name="notifications" options={{ title: 'Inbox' }} />
      <Stack.Screen name="manage-requests" options={{ title: 'Manage Requests' }} />
      <Stack.Screen name="in-house-assignments" options={{ title: 'In-house assignments' }} />
      <Stack.Screen name="cpm-home" options={{ title: 'CPM Supervisor', headerBackVisible: false }} />
      <Stack.Screen name="attendance" options={{ title: 'Attendance' }} />
      <Stack.Screen name="dispatch-job" options={{ title: 'Assign a Job' }} />
      <Stack.Screen name="index" options={{ title: 'Projects' }} />
      <Stack.Screen name="project/[id]" options={{ title: 'Project' }} />
      <Stack.Screen name="project/intake" options={{ title: 'Intake' }} />
      <Stack.Screen name="project/inspection" options={{ title: 'Inspection' }} />
      <Stack.Screen name="project/compass" options={{ title: 'Compass' }} />
      <Stack.Screen name="project/room" options={{ title: 'Add room', presentation: 'modal' }} />
      <Stack.Screen name="project/rates" options={{ title: 'Project rates', presentation: 'modal' }} />
      <Stack.Screen name="project/roof" options={{ title: 'Roof lookup', presentation: 'modal' }} />
      <Stack.Screen name="project/checklist" options={{ title: 'Renovation checklist' }} />
      <Stack.Screen name="project/project-scope" options={{ title: 'Scope of Work' }} />
      <Stack.Screen name="project/photos" options={{ title: 'Photos' }} />
      <Stack.Screen name="project/scans" options={{ title: 'Scans' }} />
      <Stack.Screen name="project/roofplan" options={{ title: 'Roof plan sketch' }} />
      <Stack.Screen name="report-detail" options={{ title: 'Job Details' }} />
      <Stack.Screen name="change-orders" options={{ title: 'Change Orders' }} />
      <Stack.Screen name="create-report" options={{ title: 'Create Report' }} />
      <Stack.Screen name="audit-log" options={{ title: 'Audit Log' }} />
      <Stack.Screen name="settings" options={{ title: 'Default rates' }} />
      <Stack.Screen name="management" options={{ title: 'Resident Reports' }} />
      <Stack.Screen name="worker" options={{ title: 'Worker Jobs' }} />
      <Stack.Screen name="resident" options={{ title: 'Report an Issue' }} />
      <Stack.Screen name="resident-lookup" options={{ title: 'Check Report Status' }} />
      <Stack.Screen name="dev-scores" options={{ title: 'Development Scores' }} />
      <Stack.Screen name="contractor-scores" options={{ title: 'Contractor Scores' }} />
      <Stack.Screen name="property-scores" options={{ title: 'Building & Residential Scores' }} />
      <Stack.Screen name="hud-review" options={{ title: 'HUD Inspections' }} />
      <Stack.Screen name="hud-view" options={{ title: 'Inspection' }} />
      <Stack.Screen name="violation-send" options={{ title: 'Send Violation' }} />
      <Stack.Screen name="leave-request" options={{ title: 'Request Time Off' }} />
      <Stack.Screen name="leave-dashboard" options={{ title: 'Leave Calendar' }} />
      <Stack.Screen name="assign-emergency" options={{ title: 'Assign Emergency Unit' }} />
      <Stack.Screen name="emergency-units" options={{ title: 'Emergency Units' }} />
      <Stack.Screen name="manage-trucks" options={{ title: 'Emergency Units' }} />
      <Stack.Screen name="truck-scores" options={{ title: 'Truck Scores' }} />
      <Stack.Screen name="emergency-activity" options={{ title: 'Emergency Activity' }} />
      <Stack.Screen name="elevator-dashboard" options={{ title: 'Elevator Dashboard' }} />
      <Stack.Screen name="inspection-approvals" options={{ title: 'Inspection Approvals' }} />
      <Stack.Screen name="scope-review" options={{ title: 'CPM Supervisor Scope Review' }} />
      <Stack.Screen name="scope-submit" options={{ title: 'Submit Scope' }} />
      <Stack.Screen name="cpm-change-order" options={{ title: 'Change Work Order' }} />
      <Stack.Screen name="assign-route" options={{ title: 'Assign a Route' }} />
    </Stack>
  );
}

function WorkerStack() {
  return (
    <Stack initialRouteName="worker-home">
      <Stack.Screen name="elevator-jobs" options={{ title: 'My Elevator Jobs' }} />
      <Stack.Screen name="worker-home" options={{ title: 'Worker', headerBackVisible: false }} />
      <Stack.Screen name="index" options={{ title: 'Projects' }} />
      <Stack.Screen name="project/[id]" options={{ title: 'Project' }} />
      <Stack.Screen name="project/room" options={{ title: 'Add room', presentation: 'modal' }} />
      <Stack.Screen name="project/rates" options={{ title: 'Project rates', presentation: 'modal' }} />
      <Stack.Screen name="project/roof" options={{ title: 'Roof lookup', presentation: 'modal' }} />
      <Stack.Screen name="project/checklist" options={{ title: 'Renovation checklist' }} />
      <Stack.Screen name="project/project-scope" options={{ title: 'Scope of Work' }} />
      <Stack.Screen name="project/photos" options={{ title: 'Photos' }} />
      <Stack.Screen name="project/scans" options={{ title: 'Scans' }} />
      <Stack.Screen name="project/roofplan" options={{ title: 'Roof plan sketch' }} />
      <Stack.Screen name="project/intake" options={{ title: 'Intake' }} />
      <Stack.Screen name="project/inspection" options={{ title: 'Inspection' }} />
      <Stack.Screen name="project/compass" options={{ title: 'Compass' }} />
      <Stack.Screen name="attendance" options={{ title: 'Attendance' }} />
      <Stack.Screen name="report-detail" options={{ title: 'Job Details' }} />
      <Stack.Screen name="change-orders" options={{ title: 'Change Orders' }} />
      <Stack.Screen name="notifications" options={{ title: 'Inbox' }} />
      <Stack.Screen name="my-jobs" options={{ title: 'My Jobs' }} />
      <Stack.Screen name="worker-change-order" options={{ title: 'Change Work Order' }} />
      <Stack.Screen name="leave-request" options={{ title: 'Request Time Off' }} />
      <Stack.Screen name="project/elevator" options={{ title: 'Elevator Services' }} />
      <Stack.Screen name="worker" options={{ title: 'Worker Jobs' }} />
      <Stack.Screen name="resident-lookup" options={{ title: 'Check Report Status' }} />
    </Stack>
  );
}

function EmergencyStack() {
  return (
    <Stack initialRouteName="worker-home">
      <Stack.Screen name="worker-home" options={{ title: 'Emergency Maintenance', headerBackVisible: false }} />
      <Stack.Screen name="attendance" options={{ title: 'Attendance' }} />
      <Stack.Screen name="report-detail" options={{ title: 'Job Details' }} />
      <Stack.Screen name="change-orders" options={{ title: 'Change Orders' }} />
      <Stack.Screen name="notifications" options={{ title: 'Inbox' }} />
      <Stack.Screen name="my-jobs" options={{ title: 'My Jobs' }} />
      <Stack.Screen name="worker-change-order" options={{ title: 'Change Work Order' }} />
      <Stack.Screen name="leave-request" options={{ title: 'Request Time Off' }} />
      <Stack.Screen name="project/elevator" options={{ title: 'Elevator Services' }} />
      <Stack.Screen name="worker" options={{ title: 'Worker Jobs' }} />
      <Stack.Screen name="resident-lookup" options={{ title: 'Check Report Status' }} />
      <Stack.Screen name="emergency-units" options={{ title: 'Emergency Units' }} />
    </Stack>
  );
}

function ResidentStack() {
  return (
    <Stack initialRouteName="resident-home">
      <Stack.Screen name="resident-home" options={{ title: 'Resident Services', headerBackVisible: false }} />
      <Stack.Screen name="resident" options={{ title: 'Report an Issue' }} />
      <Stack.Screen name="resident-lookup" options={{ title: 'Check Report Status' }} />
    </Stack>
  );
}

function VendorStack() {
  return (
    <Stack initialRouteName="vendor-home">
      <Stack.Screen name="vendor-home" options={{ title: 'Vendor', headerBackVisible: false }} />
      <Stack.Screen name="vendor-quote" options={{ title: 'Your Quote' }} />
      <Stack.Screen name="resident-lookup" options={{ title: 'Check Status' }} />
      <Stack.Screen name="project/checklist" options={{ title: 'Renovation checklist' }} />
      <Stack.Screen name="project/project-scope" options={{ title: 'Scope of Work' }} />
      <Stack.Screen name="project/estimate" options={{ title: 'Nature of Work & Cost Estimate' }} />
      <Stack.Screen name="project/elevator" options={{ title: 'Elevator Services' }} />
    </Stack>
  );
}

export default function Layout() {
  const router = useRouter();
  const pathname = usePathname();
  const [mode, setMode] = useState<AppMode | null>(null);
  const [persona, setPersona] = useState<InstallationPersona | null>(null);
  const [booting, setBooting] = useState(true);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let mounted = true;
    (async () => {
      const savedMode = await getAppMode().catch(() => null);
      const savedPersona = await getInstallationPersona().catch(() => null);
      const restored = await restoreServerSession().catch(() => null);
      await loadModuleConfig().catch(() => null);
      if (restored) await refreshModuleConfig().catch(() => undefined);
      const inferred = inferInstallationPersona(savedMode, restored?.role);
      const selected = savedPersona || inferred;

      if (selected && !savedPersona) {
        await setInstallationPersona(selected).catch(() => undefined);
      }

      if (selected === 'resident') {
        if (restored && restored.role !== 'resident') {
          await logout().catch(() => undefined);
          await clearAppMode().catch(() => undefined);
          if (restored.role === 'procurement') await clearRememberedStaff('procurement').catch(() => undefined);
        } else if (savedMode && savedMode !== 'resident') {
          await clearAppMode().catch(() => undefined);
        }
        await setAppMode('resident').catch(() => undefined);
        if (mounted) {
          setPersona('resident');
          setMode('resident');
        }
      } else if (selected === 'vendor') {
        if (restored) {
          await logout().catch(() => undefined);
          await clearAppMode().catch(() => undefined);
          if (restored.role === 'procurement') await clearRememberedStaff('procurement').catch(() => undefined);
        }
        await setAppMode('vendor').catch(() => undefined);
        if (mounted) {
          setPersona('vendor');
          setMode('vendor');
        }
      } else if (selected === 'staff') {
        if (restored?.role === 'resident' || restored?.role === 'vendor') {
          await logout().catch(() => undefined);
          await clearAppMode().catch(() => undefined);
        } else if (restored && restored.role === 'procurement') {
          await logout().catch(() => undefined);
          await clearAppMode().catch(() => undefined);
          await clearRememberedStaff('procurement').catch(() => undefined);
          if (mounted) setNotice('The Procurement mobile role is no longer available. Choose another FIAREP role.');
        } else if (restored && ['administrator', 'management', 'worker', 'inspector', 'emergency'].includes(restored.role)) {
          await syncAllEntities().catch(() => undefined);
          if (mounted) setMode(restored.role === 'emergency' ? 'emergency' : restored.role as AppMode);
        } else {
          await clearAppMode().catch(() => undefined);
        }
        if (mounted) setPersona('staff');
      } else if (mounted) {
        setPersona(null);
      }
    })().catch(() => undefined).finally(() => {
      if (mounted) setBooting(false);
    });
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        syncAllEntities().catch(() => undefined);
        clearBadge().catch(() => undefined);
      }
    });
    return () => { mounted = false; sub.remove(); };
  }, []);

  useEffect(() => {
    if (!booting && mode) {
      const redirect = setTimeout(() => {
        router.replace(HOME_FOR_MODE[mode] as never);
      }, 0);
      return () => clearTimeout(redirect);
    }
  }, [booting, mode, router]);

  // A route can be opened from a notification or an old deep link without
  // passing through a home-card click. Keep the tenant policy authoritative.
  useEffect(() => {
    if (booting || !mode || !pathname) return;
    const module = moduleForRoute(pathname);
    if (module && !moduleEnabled(module)) {
      router.replace(HOME_FOR_MODE[mode] as never);
    }
  }, [booting, mode, pathname, router]);

  const refresh = useCallback(() => { setMode(null); }, []);

  async function pickPersona(next: InstallationPersona) {
    const chosen = await setInstallationPersona(next);
    if (chosen === 'resident' || chosen === 'vendor') {
      const publicMode = chosen;
      await setAppMode(publicMode).catch(() => undefined);
      setMode(publicMode);
    } else {
      await clearAppMode().catch(() => undefined);
      setMode(null);
    }
    setPersona(chosen);
  }

  async function pick(m: AppMode) {
    await setAppMode(m).catch(() => undefined);
    setMode(m);
  }

  let content;
  if (booting) {
    content = (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={ACCENT} />
      </View>
    );
  } else if (persona === null) {
    content = <PersonaPicker onPick={pickPersona} />;
  } else if (mode === null) {
    content = <ModePicker onPick={pick} notice={notice} />;
  } else if (mode === 'emergency') {
    content = <EmergencyStack />;
  } else if (mode === 'resident') {
    content = <ResidentStack />;
  } else if (mode === 'worker') {
    content = <WorkerStack />;
  } else if (mode === 'inspector') {
    content = <InspectorStack />;
  } else if (mode === 'administrator') {
    content = <AdministratorStack />;
  } else if (mode === 'vendor') {
    content = <VendorStack />;
  } else {
    content = <ManagementStack />;
  }

  return (
    <ModeContext.Provider value={{ mode, loading: false, refresh }}>
      <View key={mode ?? 'picker'} style={{ flex: 1 }}>
      {content}
      </View>
    </ModeContext.Provider>
  );
}
