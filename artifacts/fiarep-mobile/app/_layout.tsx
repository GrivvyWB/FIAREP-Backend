import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, AppState, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import {
  getAppMode, setAppMode,
  verifyStaffLogin, hasAnyAdministrator, bootstrapAdministrator,
  setRememberedStaff, getRememberedStaff,
   setCurrentActor, restoreServerSession, logout, clearAppMode, clearRememberedStaff,
   type AppMode } from '../lib/store';
import { ui, ACCENT } from '../lib/ui';
import { syncAllEntities } from '../lib/sync';

type ModeCtx = { mode: AppMode | null; loading: boolean; refresh: () => void };
const ModeContext = createContext<ModeCtx>({ mode: null, loading: true, refresh: () => {} });
export function useAppMode() { return useContext(ModeContext); }

type StaffRole = 'administrator' | 'management' | 'worker' | 'inspector' | 'resident' | 'vendor' | 'emergency';
const CODE_LEN = 4;
const normCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LEN);
const ROLE_LABEL: Record<StaffRole, string> = {
  administrator: 'Administrator',
  management: 'Management',
  worker: 'Staff Member',
  inspector: 'CPM / Inspector',
  resident: 'Resident',
  vendor: 'Vendor',
  emergency: 'Emergency Unit',
};
const roleLabel = (role: StaffRole) => ROLE_LABEL[role];

const HOME_FOR_MODE: Record<AppMode, string> = {
  management: '/management-home',
  administrator: '/admin-home',
  worker: '/worker-home',
  inspector: '/cpm-home',
  resident: '/resident-home',
  vendor: '/vendor-home',
  emergency: '/emergency-units',
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

function StaffGate(props: { role: StaffRole; label?: string; expectedPosition?: string; onUnlock: (overrideMode?: AppMode) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [canBootstrap, setCanBootstrap] = useState(false);
  const [ready, setReady] = useState(false);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);

  useEffect(() => {
    if (props.role === 'administrator') {
      hasAnyAdministrator()
        .then((h) => setCanBootstrap(!h))
        .catch(() => setMsg('Could not reach the FIAREP backend. Try again.'))
        .finally(() => setReady(true));
    } else {
      setReady(true);
    }
  }, [props.role]);

  async function doLogin() {
    setMsg(''); setBusy(true);
    try {
      const ok = await verifyStaffLogin(name.trim(), normCode(code), props.role, props.expectedPosition, organizationId);
      if (ok) {
        await setRememberedStaff(props.role, name.trim()).catch(() => undefined);
        props.onUnlock();
      }
      else setMsg('No approved account matches that name and code.');
    } catch {
      setMsg('Could not reach the FIAREP backend. Try again.');
    } finally { setBusy(false); }
  }

  async function doBootstrap() {
    setMsg(''); setBusy(true);
    try {
      if (!name.trim()) { setMsg('Enter your name.'); setBusy(false); return; }
      const acct = await bootstrapAdministrator(name.trim());
      await setCurrentActor('administrator', name.trim());
      // Show the generated code, then continue.
      setIssuedCode(acct.code);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      setMsg(message.includes('409') ? 'An administrator already exists. Log in instead.' : 'Could not create the administrator. Try again.');
    } finally { setBusy(false); }
  }

  if (!ready) {
    return <Screen><ActivityIndicator /></Screen>;
  }

  // Bootstrap success: show generated admin code once, then enter.
  if (issuedCode) {
    return (
      <Screen>
        <Text style={{ fontSize: 24, fontWeight: '600', textAlign: 'center' }}>Administrator created</Text>
        <Text style={[ui.label, { textAlign: 'center' }]}>Your login code (save it):</Text>
        <Text style={{ fontSize: 34, fontWeight: '700', textAlign: 'center', letterSpacing: 6, color: ACCENT }}>{issuedCode}</Text>
        <Text style={[ui.label, { textAlign: 'center' }]}>Log in with your name and this code next time.</Text>
        <Pressable style={ui.btn} onPress={() => props.onUnlock()}>
          <Text style={ui.btnText}>Continue</Text>
        </Pressable>
      </Screen>
    );
  }

  const bootstrapping = props.role === 'administrator' && canBootstrap;

  return (
    <Screen>
      <Text style={{ fontSize: 24, fontWeight: '600', textAlign: 'center' }}>{props.label || roleLabel(props.role)}</Text>
      <Text style={[ui.label, { textAlign: 'center' }]}>
        {bootstrapping
          ? 'No administrator exists yet. Create the first administrator account.'
          : `Log in with the name and code you were issued.`}
      </Text>

      <Text style={ui.label}>Name</Text>
      <TextInput
        style={ui.input}
        value={name}
        onChangeText={setName}
        placeholder="Your name"
        autoCapitalize="words"
      />
      {!bootstrapping && (
        <>
          <Text style={ui.label}>Organization ID (customer staff)</Text>
          <TextInput style={ui.input} value={organizationId} onChangeText={setOrganizationId} placeholder="Leave blank for default FIAREP" autoCapitalize="none" />
        </>
      )}

      {!bootstrapping && (
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
      )}

      {!!msg && <Text style={{ color: '#c00', textAlign: 'center' }}>{msg}</Text>}

      <Pressable style={ui.btn} onPress={bootstrapping ? doBootstrap : doLogin} disabled={busy}>
        <Text style={ui.btnText}>{busy ? '…' : bootstrapping ? 'Create administrator' : 'Log in'}</Text>
      </Pressable>
      <Pressable style={ui.btnOutline} onPress={props.onCancel}>
        <Text style={ui.btnOutlineText}>Cancel</Text>
      </Pressable>
    </Screen>
  );
}

function ModePicker({ onPick, notice }: { onPick: (m: AppMode) => void; notice?: string }) {
  const [gateFor, setGateFor] = useState<StaffRole | null>(null);
  const [boroughDirectorGate, setBoroughDirectorGate] = useState(false);
  const [emergencyGate, setEmergencyGate] = useState(false);
  const pickStaffRole = async (role: StaffRole) => {
    const staff = await restoreServerSession();
    if (staff?.role === role) onPick(role as AppMode);
    else setGateFor(role);
  };

  if (gateFor) {
    return (
      <StaffGate
        role={gateFor}
        label={boroughDirectorGate ? 'Borough Director' : emergencyGate ? 'Emergency Unit' : undefined}
        expectedPosition={boroughDirectorGate ? 'Borough Director' : undefined}
        onUnlock={(override?: AppMode) => { const r = override || (emergencyGate ? 'emergency' : gateFor as AppMode); setGateFor(null); setBoroughDirectorGate(false); setEmergencyGate(false); onPick(r); }}
        onCancel={() => { setGateFor(null); setBoroughDirectorGate(false); setEmergencyGate(false); }}
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
      <Text style={{ fontSize: 26, fontWeight: '600', textAlign: 'center' }}>Who's using this device?</Text>
      <Text style={[ui.label, { textAlign: 'center', marginBottom: 12 }]}>Staff roles require an issued code.</Text>
      {!!notice && <Text style={{ color: '#9a3412', textAlign: 'center', marginBottom: 8 }}>{notice}</Text>}
      <Pressable style={ui.btn} onPress={() => onPick('resident')}>
        <Text style={ui.btnText}>Resident</Text>
      </Pressable>
      <Pressable style={ui.btn} onPress={() => onPick('vendor')}>
        <Text style={ui.btnText}>Vendor</Text>
      </Pressable>
       <Pressable style={[ui.btn, { backgroundColor: '#c0392b' }]} onPress={() => { setEmergencyGate(true); setGateFor('emergency'); }}>
        <Text style={ui.btnText}>Emergency Unit</Text>
      </Pressable>
      <Pressable style={ui.btn} onPress={() => { setBoroughDirectorGate(true); setGateFor('management'); }}>
        <Text style={ui.btnText}>Borough Director  🔒</Text>
      </Pressable>
       <Pressable style={ui.btn} onPress={() => pickStaffRole('administrator')}>
        <Text style={ui.btnText}>Administrator  🔒</Text>
      </Pressable>
       <Pressable style={ui.btn} onPress={() => pickStaffRole('management')}>
        <Text style={ui.btnText}>Management  🔒</Text>
      </Pressable>
      <Pressable style={ui.btn} onPress={() => pickStaffRole('worker')}>
        <Text style={ui.btnText}>Staff Member  🔒</Text>
      </Pressable>
      <Pressable style={ui.btn} onPress={() => pickStaffRole('inspector')}>
        <Text style={ui.btnText}>CPM / Inspector  🔒</Text>
      </Pressable>
    </Screen>
  );
}

function AdministratorStack() {
  return (
    <Stack initialRouteName="admin-home">
      <Stack.Screen name="admin-home" options={{ title: 'Administrator', headerBackVisible: false }} />
      <Stack.Screen name="dispatch-job" options={{ title: 'Assign a Job' }} />
      <Stack.Screen name="report-detail" options={{ title: 'Job Details' }} />
      <Stack.Screen name="admin-job" options={{ title: 'Add Job' }} />
      <Stack.Screen name="change-orders" options={{ title: 'Change Orders' }} />
      <Stack.Screen name="notifications" options={{ title: 'Inbox' }} />
      <Stack.Screen name="audit-log" options={{ title: 'Audit Log' }} />
      <Stack.Screen name="manage-requests" options={{ title: 'Manage Requests' }} />
      <Stack.Screen name="assign-emergency" options={{ title: 'Assign Emergency Unit' }} />
      <Stack.Screen name="manage-trucks" options={{ title: 'Emergency Units' }} />
      <Stack.Screen name="truck-scores" options={{ title: 'Truck Scores' }} />
      <Stack.Screen name="emergency-activity" options={{ title: 'Emergency Activity' }} />
      <Stack.Screen name="leave-request" options={{ title: 'Request Time Off' }} />
      <Stack.Screen name="leave-dashboard" options={{ title: 'Leave Calendar' }} />
      <Stack.Screen name="bulk-employees" options={{ title: 'Bulk Employees' }} />
      <Stack.Screen name="contractor-scores" options={{ title: 'Contractor Scores' }} />
      <Stack.Screen name="staff-approvals" options={{ title: 'Staff' }} />
      <Stack.Screen name="dev-scores" options={{ title: 'Development Scores' }} />
      <Stack.Screen name="management" options={{ title: 'Resident Reports' }} />
      <Stack.Screen name="worker" options={{ title: 'Worker Jobs' }} />
      <Stack.Screen name="resident" options={{ title: 'Report an Issue' }} />
      <Stack.Screen name="resident-lookup" options={{ title: 'Check Report Status' }} />
      <Stack.Screen name="index" options={{ title: 'Projects' }} />
      <Stack.Screen name="project/[id]" options={{ title: 'Project' }} />
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
      <Stack.Screen name="scope-review" options={{ title: 'Scope Review' }} />
      <Stack.Screen name="violation-send" options={{ title: 'Send Violation' }} />
      <Stack.Screen name="assign-route" options={{ title: 'Assign a Route' }} />
    </Stack>
  );
}

function InspectorStack() {
  return (
    <Stack initialRouteName="cpm-home">
      <Stack.Screen name="cpm-home" options={{ title: 'CPM / Inspector', headerBackVisible: false }} />
      <Stack.Screen name="notifications" options={{ title: 'Inbox' }} />
      <Stack.Screen name="report-detail" options={{ title: 'Job Details' }} />
      <Stack.Screen name="inspector-violations" options={{ title: 'Log Violations' }} />
      <Stack.Screen name="fiarep-vision" options={{ title: 'FIAREP Vision' }} />
      <Stack.Screen name="cpm-change-order" options={{ title: 'Change Work Order' }} />
      <Stack.Screen name="inspector-routes" options={{ title: 'My Routes' }} />
      <Stack.Screen name="scope-submit" options={{ title: 'Submit Scope' }} />
      <Stack.Screen name="index" options={{ title: 'Projects' }} />
      <Stack.Screen name="project/[id]" options={{ title: 'Project' }} />
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
      <Stack.Screen name="dispatch-job" options={{ title: 'Assign a Job' }} />
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
      <Stack.Screen name="report-detail" options={{ title: 'Job Details' }} />
      <Stack.Screen name="change-orders" options={{ title: 'Change Orders' }} />
      <Stack.Screen name="create-report" options={{ title: 'Create Report' }} />
      <Stack.Screen name="notifications" options={{ title: 'Inbox' }} />
      <Stack.Screen name="audit-log" options={{ title: 'Audit Log' }} />
      <Stack.Screen name="settings" options={{ title: 'Default rates' }} />
      <Stack.Screen name="management" options={{ title: 'Resident Reports' }} />
      <Stack.Screen name="worker" options={{ title: 'Worker Jobs' }} />
      <Stack.Screen name="resident" options={{ title: 'Report an Issue' }} />
      <Stack.Screen name="resident-lookup" options={{ title: 'Check Report Status' }} />
      <Stack.Screen name="staff-approvals" options={{ title: 'Staff' }} />
      <Stack.Screen name="dev-scores" options={{ title: 'Development Scores' }} />
      <Stack.Screen name="bulk-employees" options={{ title: 'Bulk Employees' }} />
      <Stack.Screen name="contractor-scores" options={{ title: 'Contractor Scores' }} />
      <Stack.Screen name="hud-review" options={{ title: 'HUD Inspections' }} />
      <Stack.Screen name="hud-view" options={{ title: 'Inspection' }} />
      <Stack.Screen name="scope-review" options={{ title: 'Scope Review' }} />
      <Stack.Screen name="violation-send" options={{ title: 'Send Violation' }} />
      <Stack.Screen name="scope-approvals" options={{ title: 'Scope Approvals' }} />
      <Stack.Screen name="leave-request" options={{ title: 'Request Time Off' }} />
      <Stack.Screen name="leave-dashboard" options={{ title: 'Leave Calendar' }} />
      <Stack.Screen name="assign-emergency" options={{ title: 'Assign Emergency Unit' }} />
      <Stack.Screen name="emergency-units" options={{ title: 'Emergency Units' }} />
      <Stack.Screen name="manage-trucks" options={{ title: 'Emergency Units' }} />
      <Stack.Screen name="truck-scores" options={{ title: 'Truck Scores' }} />
      <Stack.Screen name="emergency-activity" options={{ title: 'Emergency Activity' }} />
      <Stack.Screen name="elevator-dashboard" options={{ title: 'Elevator Dashboard' }} />
      <Stack.Screen name="inspection-approvals" options={{ title: 'Inspection Approvals' }} />
      <Stack.Screen name="assign-route" options={{ title: 'Assign a Route' }} />
    </Stack>
  );
}

function WorkerStack() {
  return (
    <Stack initialRouteName="worker-home">
      <Stack.Screen name="worker-home" options={{ title: 'Worker', headerBackVisible: false }} />
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
    <Stack initialRouteName="emergency-units">
      <Stack.Screen name="emergency-units" options={{ title: 'Emergency Units', headerBackVisible: false }} />
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
  const [mode, setMode] = useState<AppMode | null>(null);
  const [booting, setBooting] = useState(true);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let mounted = true;
    restoreServerSession().then(async (restored) => {
      if (restored && restored.role === 'procurement') {
        await logout().catch(() => undefined);
        await clearAppMode().catch(() => undefined);
        await clearRememberedStaff('procurement').catch(() => undefined);
        if (mounted) setNotice('The Procurement mobile role is no longer available. Choose another FIAREP role.');
      } else if (restored && mounted && ['resident', 'administrator', 'management', 'worker', 'inspector', 'vendor', 'emergency'].includes(restored.role)) {
        const savedMode = await getAppMode().catch(() => null);
        const restoredMode = restored.role === 'emergency'
          ? 'emergency'
          : restored.role as AppMode;
        setMode(restoredMode);
      }
    }).catch(() => undefined).finally(() => {
      if (mounted) setBooting(false);
    });
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        syncAllEntities().catch(() => undefined);
      }
    });
    return () => { mounted = false; sub.remove(); };
  }, []);

  useEffect(() => {
    if (!booting && mode) {
      router.replace(HOME_FOR_MODE[mode] as never);
    }
  }, [booting, mode, router]);

  const refresh = useCallback(() => { setMode(null); }, []);

  async function pick(m: AppMode) {
    setMode(m);
    await setAppMode(m).catch(() => undefined);
  }

  let content;
  if (booting) {
    content = (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={ACCENT} />
      </View>
    );
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
