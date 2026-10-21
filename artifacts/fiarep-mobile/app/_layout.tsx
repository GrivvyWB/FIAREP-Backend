// Registers the background location task for the time clock before any screen renders.
import '../lib/clock-location';
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, AppState, Image, Linking } from 'react-native';
import * as Location from 'expo-location';
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
import { customFetch } from '@workspace/api-client-react';
import * as SecureStore from 'expo-secure-store';
import CodeMessage from '../components/CodeMessage';
import MessagesBar from '../components/MessagesBar';

type ModeCtx = { mode: AppMode | null; loading: boolean; refresh: () => void };
const ModeContext = createContext<ModeCtx>({ mode: null, loading: true, refresh: () => {} });
export function useAppMode() { return useContext(ModeContext); }

const CODE_LEN = 16;
const normCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, CODE_LEN);

export const HOME_FOR_MODE: Record<AppMode, string> = {
  management: '/management-home',
  administrator: '/admin-home',
  worker: '/worker-home',
  inspector: '/cpm-home',
  resident: '/resident-home',
  vendor: '/vendor-home',
  emergency: '/worker-home',
  community_coordinator: '/community-home',
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

// The organization this phone signs in under: typed once (by the director or owner), then remembered for everyone on it.
const BOUND_ORG_KEY = 'fiarep_bound_org';
const LAST_LOGIN_KEY = 'fiarep.staff.lastLogin';

function StaffGate(props: { onUnlock: (overrideMode?: AppMode) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [org, setOrg] = useState('');
  const [boundOrg, setBoundOrg] = useState('');
  useEffect(() => { SecureStore.getItemAsync(BOUND_ORG_KEY).then((v) => setBoundOrg(v || '')).catch(() => undefined); }, []);

  // The phone remembers the last name and code that signed in (in the
  // keychain), so after a sign-out it is one tap to get back in.
  useEffect(() => {
    SecureStore.getItemAsync(LAST_LOGIN_KEY).then((raw) => {
      try {
        const last = raw ? JSON.parse(raw) as { name?: string; code?: string } : null;
        if (last?.name) setName(last.name);
        if (last?.code) setCode(normCode(last.code));
      } catch { /* nothing remembered */ }
    }).catch(() => undefined).finally(() => setReady(true));
  }, []);

  async function forgetLogin() {
    await SecureStore.deleteItemAsync(LAST_LOGIN_KEY).catch(() => undefined);
    setName(''); setCode('');
  }

  async function doLogin() {
    setMsg(''); setBusy(true);
    try {
      const useOrg = (boundOrg || org).trim();
      const ok = await verifyStaffLogin(name.trim(), normCode(code), undefined, undefined, useOrg || undefined);
      if (ok) {
        if (useOrg && !boundOrg) { await SecureStore.setItemAsync(BOUND_ORG_KEY, useOrg.toUpperCase(), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }).catch(() => undefined); setBoundOrg(useOrg.toUpperCase()); }
        await SecureStore.setItemAsync(LAST_LOGIN_KEY, JSON.stringify({ name: name.trim(), code: normCode(code) }),
          { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }).catch(() => undefined);
        const actor = await restoreServerSession();
        await refreshModuleConfig().catch(() => undefined);
        const supportedRoles: AppMode[] = ['administrator', 'management', 'worker', 'inspector', 'emergency', 'community_coordinator'];
        const actualRole = actor?.role;
        if (!actualRole || !supportedRoles.includes(actualRole as AppMode)) {
          setMsg('This account has an unsupported mobile staff role. Contact an administrator.');
          return;
        }
        const modeRole = actualRole as AppMode;
        // Location is part of using the app, for every staff role, no exceptions.
        {
          const { requireWorkerLocation } = await import('../lib/clock-location');
          const ok = await requireWorkerLocation();
          if (!ok) { setMsg('FIAREP needs your location to sign in — set Location to "Always" for FIAREP in your phone settings, then try again.'); return; }
        }
        await setRememberedStaff(modeRole as Parameters<typeof setRememberedStaff>[0], name.trim()).catch(() => undefined);
        await syncAllEntities().catch(() => undefined);
        props.onUnlock(modeRole);
      }
      else setMsg('No approved account matches that name and code.');
    } catch (error) {
      // Only say the backend is unreachable when there was genuinely no reply.
      // This used to report every failure that way — a 500, a timeout, a
      // thrown error — which hid what had actually gone wrong.
      const status = typeof error === 'object' && error !== null && 'status' in error
        ? (error as { status?: unknown }).status
        : undefined;
      const needsOrg = typeof error === 'object' && error !== null && (error as { data?: { needsOrganization?: unknown } }).data?.needsOrganization === true;
      if (needsOrg) setMsg("Type your organization's ID — it is needed the first time on this phone.");
      else if (status === 403) setMsg('Organization license is not active.');
      else if (status === 401) setMsg('No approved account matches that name and code.');
      else if (typeof status === 'number') setMsg(`The server refused the sign-in (${status}). Try again.`);
      else setMsg('Could not reach the FIAREP backend. Try again.');
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
            // Hidden as it is typed and when filled in from the saved sign-in.
            secureTextEntry
          />
      </>

      {boundOrg ? (
        <Pressable onPress={() => { void SecureStore.deleteItemAsync(BOUND_ORG_KEY).catch(() => undefined); setBoundOrg(''); }} style={{ paddingVertical: 4 }}>
          <Text style={{ textAlign: 'center', color: '#666', fontSize: 13 }}>Organization {boundOrg} · change</Text>
        </Pressable>
      ) : (
        <>
          <Text style={ui.label}>Organization ID</Text>
          <TextInput style={ui.input} value={org} onChangeText={setOrg} placeholder="First time on this phone (FIAREP staff: leave blank)" autoCapitalize="characters" autoCorrect={false} />
        </>
      )}

      {!!msg && <Text style={{ color: '#c00', textAlign: 'center' }}>{msg}</Text>}

      <Pressable style={ui.btn} onPress={doLogin} disabled={busy}>
        <Text style={ui.btnText}>{busy ? '…' : 'Log in'}</Text>
      </Pressable>
      <Pressable style={ui.btnOutline} onPress={props.onCancel}>
        <Text style={ui.btnOutlineText}>Cancel</Text>
      </Pressable>
      {!!(name || code) && (
        <Pressable onPress={() => void forgetLogin()} style={{ padding: 8 }}>
          <Text style={{ textAlign: 'center', color: '#666', fontSize: 13 }}>Not you? Clear the saved name and code</Text>
        </Pressable>
      )}
    </Screen>
  );
}

function PersonaPicker({ onPick }: { onPick: (persona: InstallationPersona) => void }) {
  // A client handed a code by a FIAREP Services member (no plan, no account)
  // writes to that member here, before choosing anything. Messaging is for
  // staff and clients - never residents or vendors.
  const [messaging, setMessaging] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    customFetch<{ open: boolean }>('/api/v1/public/messages/status', { responseType: 'json' } as never)
      .then((r) => setOpen(r.open !== false)).catch(() => setOpen(false));
  }, []);
  if (messaging) return <Screen><CodeMessage onBack={() => setMessaging(false)} /></Screen>;
  return (
    <Screen>
      {open && <MessagesBar label="Message FIAREP" sub="Sign up with your name, or type a code from FIAREP Services." onPress={() => setMessaging(true)} />}
      <Image
        source={require('../assets/field-inspection-logo.png')}
        accessibilityLabel="FIAREP logo"
        resizeMode="contain"
        style={{ width: 300, height: 150, alignSelf: 'center', marginBottom: 2 }}
      />
      <Text style={{ fontSize: 13, fontWeight: '500', color: '#555', textAlign: 'center', marginBottom: 10 }}>
        Field Infrastructure, Asset Reporting & Evaluation Performance
      </Text>
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
        style={{ width: 300, height: 150, alignSelf: 'center', marginBottom: 2 }}
      />
      <Text style={{ fontSize: 13, fontWeight: '500', color: '#555', textAlign: 'center', marginBottom: 10 }}>
        Field Infrastructure, Asset Reporting & Evaluation Performance
      </Text>
      <Text style={{ fontSize: 26, fontWeight: '600', textAlign: 'center' }}>Staff sign in</Text>
      {!!notice && <Text style={{ color: '#9a3412', textAlign: 'center', marginBottom: 8 }}>{notice}</Text>}
      <Pressable style={ui.btn} onPress={() => setGateFor(true)}>
        <Text style={ui.btnText}>Staff Member  🔒</Text>
      </Pressable>
    </Screen>
  );
}

function ProjectsHome({ to }: { to: string }) {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.replace(to as never)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Home">
      <Text style={{ color: ACCENT, fontWeight: '700', fontSize: 16 }}>Home</Text>
    </Pressable>
  );
}

function AdministratorStack() {
  return (
    <Stack initialRouteName="admin-home">
      <Stack.Screen name="admin-home" options={{ title: 'Administrator', headerBackVisible: false, headerShown: false }} />
      <Stack.Screen name="inspector-violations" options={{ title: 'HPD / DOB' }} />
      <Stack.Screen name="violation-guide" options={{ title: 'Take me there', headerBackTitle: 'Back' }} />
      <Stack.Screen name="translator" options={{ title: 'Translator' }} />
      <Stack.Screen name="command-center" options={{ title: 'Command Center' }} />
      <Stack.Screen name="attendance" options={{ title: 'Attendance' }} />
      <Stack.Screen name="dispatch-job" options={{ title: 'Assign a Job' }} />
      <Stack.Screen name="in-house-assignments" options={{ title: 'In-house assignments' }} />
      <Stack.Screen name="report-detail" options={{ title: 'Job Details' }} />
      <Stack.Screen name="admin-job" options={{ title: 'Add Job' }} />
      <Stack.Screen name="change-orders" options={{ title: 'Change Orders' }} />
      <Stack.Screen name="notifications" options={{ title: 'Inbox' }} />
      <Stack.Screen name="message" options={{ title: 'Message' }} />
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
      <Stack.Screen name="index" options={{ title: 'Projects', headerRight: () => <ProjectsHome to="/admin-home" /> }} />
      <Stack.Screen name="project/[id]" options={{ title: 'Project' }} />
      <Stack.Screen name="project/intake" options={{ title: 'Intake' }} />
      <Stack.Screen name="project/inspection" options={{ title: 'Inspection' }} />
      <Stack.Screen name="project/compass" options={{ title: 'Compass' }} />
      <Stack.Screen name="project/room" options={{ title: 'Add room', presentation: 'modal' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
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
      {/* FIAREP's administrators also work in the field: their technician tools. */}
      <Stack.Screen name="my-jobs" options={{ title: 'My Jobs', headerBackTitle: 'Back' }} />
      <Stack.Screen name="quick-quote" options={{ title: 'Quick Quote', headerBackTitle: 'Back' }} />
      <Stack.Screen name="price-quote" options={{ title: 'Price Quote', headerBackTitle: 'Back' }} />
      <Stack.Screen name="fiarep-vision" options={{ title: 'FIAREP Vision', headerBackTitle: 'Back' }} />
      <Stack.Screen name="smart-repair" options={{ title: 'Smart Repair', headerBackTitle: 'Back' }} />
      <Stack.Screen name="site-checkin" options={{ title: 'Building Check-In', headerBackTitle: 'Back' }} />
      <Stack.Screen name="priority-queue" options={{ title: 'Priority Queue', headerBackTitle: 'Back' }} />
      <Stack.Screen name="baseline" options={{ title: 'Building Baseline', headerBackTitle: 'Back' }} />
      <Stack.Screen name="baseline-assess" options={{ title: 'Building Baseline', headerBackTitle: 'Back' }} />
      <Stack.Screen name="inspector-routes" options={{ title: 'My Routes', headerBackTitle: 'Back' }} />
      <Stack.Screen name="my-inspections" options={{ title: 'My Inspections', headerBackTitle: 'Back' }} />
      <Stack.Screen name="create-report" options={{ title: 'Create Report', headerBackTitle: 'Back' }} />
      <Stack.Screen name="measurement" options={{ title: 'Measurement', headerBackTitle: 'Back' }} />
      <Stack.Screen name="saved-measurements" options={{ title: 'Saved Measurements', headerBackTitle: 'Back' }} />
      <Stack.Screen name="scope-submit" options={{ title: 'Submit Scope', headerBackTitle: 'Back' }} />
      <Stack.Screen name="cpm-change-order" options={{ title: 'Change Work Order', headerBackTitle: 'Back' }} />
      <Stack.Screen name="scope-review" options={{ title: 'Scope Review', headerBackTitle: 'Back' }} />
      <Stack.Screen name="community-home" options={{ title: 'FIAREP Services', headerBackTitle: 'Back' }} />
      <Stack.Screen name="community-resident" options={{ title: 'Resident', headerBackTitle: 'Back' }} />
      <Stack.Screen name="community-building" options={{ title: 'Building & owner', headerBackTitle: 'Back' }} />
      <Stack.Screen name="fiarep-messages" options={{ title: 'Messages', headerBackTitle: 'Back' }} />
      <Stack.Screen name="client-messages" options={{ title: 'Message FIAREP', headerBackTitle: 'Back' }} />
    </Stack>
  );
}

function InspectorStack() {
  return (
    <Stack initialRouteName="cpm-home">
      <Stack.Screen name="cpm-home" options={{ title: 'Tech', headerBackVisible: false, headerShown: false }} />
      <Stack.Screen name="my-jobs" options={{ title: 'My Jobs' }} />
      <Stack.Screen name="translator" options={{ title: 'Translator' }} />
      <Stack.Screen name="command-center" options={{ title: 'Command Center' }} />
      <Stack.Screen name="my-inspections" options={{ title: 'My Inspections' }} />
      <Stack.Screen name="attendance" options={{ title: 'Attendance' }} />
      <Stack.Screen name="create-report" options={{ title: 'Create Report' }} />
      <Stack.Screen name="leave-request" options={{ title: 'Request Time Off' }} />
      <Stack.Screen name="leave-dashboard" options={{ title: 'Leave Calendar' }} />
      <Stack.Screen name="notifications" options={{ title: 'Inbox' }} />
      <Stack.Screen name="client-messages" options={{ title: 'Message FIAREP', headerBackTitle: 'Back' }} />
      <Stack.Screen name="fiarep-messages" options={{ title: 'Messages', headerBackTitle: 'Back' }} />
      <Stack.Screen name="message" options={{ title: 'Message' }} />
      <Stack.Screen name="report-detail" options={{ title: 'Job Details' }} />
      <Stack.Screen name="inspector-violations" options={{ title: 'Log Violations' }} />
      <Stack.Screen name="violation-guide" options={{ title: 'Take me there', headerBackTitle: 'Back' }} />
      <Stack.Screen name="fiarep-vision" options={{ title: 'FIAREP Vision' }} />
      <Stack.Screen name="smart-repair" options={{ title: 'Smart Repair', headerBackTitle: 'Back' }} />
      <Stack.Screen name="site-checkin" options={{ title: 'Building Check-In', headerBackTitle: 'Back' }} />
      <Stack.Screen name="baseline" options={{ title: 'Building Baseline', headerBackTitle: 'Back' }} />
      <Stack.Screen name="baseline-assess" options={{ title: 'Building Baseline', headerBackTitle: 'Back' }} />
      <Stack.Screen name="cpm-change-order" options={{ title: 'Change Work Order' }} />
      <Stack.Screen name="inspector-routes" options={{ title: 'My Routes' }} />
      <Stack.Screen name="scope-submit" options={{ title: 'Submit Scope' }} />
      <Stack.Screen name="price-quote" options={{ title: 'Price Quote' }} />
      <Stack.Screen name="quick-quote" options={{ title: 'Quick Quote' }} />
      <Stack.Screen name="index" options={{ title: 'Projects', headerRight: () => <ProjectsHome to="/cpm-home" /> }} />
      <Stack.Screen name="project/[id]" options={{ title: 'Project' }} />
      <Stack.Screen name="project/intake" options={{ title: 'Intake' }} />
      <Stack.Screen name="project/inspection" options={{ title: 'Inspection' }} />
      <Stack.Screen name="project/compass" options={{ title: 'Compass' }} />
      <Stack.Screen name="project/room" options={{ title: 'Add room', presentation: 'modal' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
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
      <Stack.Screen name="management-home" options={{ title: 'Management', headerBackVisible: false, headerShown: false }} />
      <Stack.Screen name="client-messages" options={{ title: 'Message FIAREP', headerBackTitle: 'Back' }} />
      <Stack.Screen name="inspector-violations" options={{ title: 'HPD / DOB' }} />
      <Stack.Screen name="violation-guide" options={{ title: 'Take me there', headerBackTitle: 'Back' }} />
      <Stack.Screen name="translator" options={{ title: 'Translator' }} />
      <Stack.Screen name="command-center" options={{ title: 'Command Center' }} />
      <Stack.Screen name="notifications" options={{ title: 'Inbox' }} />
      <Stack.Screen name="fiarep-messages" options={{ title: 'Messages', headerBackTitle: 'Back' }} />
      <Stack.Screen name="message" options={{ title: 'Message' }} />
      <Stack.Screen name="manage-requests" options={{ title: 'Manage Requests' }} />
      <Stack.Screen name="in-house-assignments" options={{ title: 'In-house assignments' }} />
      <Stack.Screen name="cpm-home" options={{ title: 'CPM Supervisor', headerBackVisible: false }} />
      <Stack.Screen name="attendance" options={{ title: 'Attendance' }} />
      <Stack.Screen name="dispatch-job" options={{ title: 'Assign a Job' }} />
      <Stack.Screen name="index" options={{ title: 'Projects', headerRight: () => <ProjectsHome to="/management-home" /> }} />
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
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      <Stack.Screen name="management" options={{ title: 'Resident Reports' }} />
      <Stack.Screen name="smart-repair" options={{ title: 'Smart Repair', headerBackTitle: 'Back' }} />
      <Stack.Screen name="site-checkin" options={{ title: 'Building Check-In', headerBackTitle: 'Back' }} />
      <Stack.Screen name="priority-queue" options={{ title: 'Priority Queue', headerBackTitle: 'Back' }} />
      <Stack.Screen name="baseline" options={{ title: 'Building Baseline', headerBackTitle: 'Back' }} />
      <Stack.Screen name="baseline-assess" options={{ title: 'Building Baseline', headerBackTitle: 'Back' }} />
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
      <Stack.Screen name="worker-home" options={{ title: 'Worker', headerBackVisible: false, headerShown: false }} />
      <Stack.Screen name="inspector-violations" options={{ title: 'HPD / DOB' }} />
      <Stack.Screen name="violation-guide" options={{ title: 'Take me there', headerBackTitle: 'Back' }} />
      <Stack.Screen name="translator" options={{ title: 'Translator' }} />
      <Stack.Screen name="command-center" options={{ title: 'Command Center' }} />
      <Stack.Screen name="index" options={{ title: 'Projects', headerRight: () => <ProjectsHome to="/worker-home" /> }} />
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
      <Stack.Screen name="client-messages" options={{ title: 'Message FIAREP', headerBackTitle: 'Back' }} />
      <Stack.Screen name="fiarep-messages" options={{ title: 'Messages', headerBackTitle: 'Back' }} />
      <Stack.Screen name="message" options={{ title: 'Message' }} />
      <Stack.Screen name="my-jobs" options={{ title: 'My Jobs' }} />
      <Stack.Screen name="worker-change-order" options={{ title: 'Change Work Order' }} />
      <Stack.Screen name="smart-repair" options={{ title: 'Smart Repair', headerBackTitle: 'Back' }} />
      <Stack.Screen name="site-checkin" options={{ title: 'Building Check-In', headerBackTitle: 'Back' }} />
      <Stack.Screen name="leave-request" options={{ title: 'Request Time Off' }} />
      <Stack.Screen name="project/elevator" options={{ title: 'Elevator Services' }} />
      <Stack.Screen name="worker" options={{ title: 'Worker Jobs' }} />
      <Stack.Screen name="resident-lookup" options={{ title: 'Check Report Status' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
</Stack>
  );
}

function EmergencyStack() {
  return (
    <Stack initialRouteName="worker-home">
      <Stack.Screen name="worker-home" options={{ title: 'Emergency Maintenance', headerBackVisible: false, headerShown: false }} />
      <Stack.Screen name="inspector-violations" options={{ title: 'HPD / DOB' }} />
      <Stack.Screen name="violation-guide" options={{ title: 'Take me there', headerBackTitle: 'Back' }} />
      <Stack.Screen name="translator" options={{ title: 'Translator' }} />
      <Stack.Screen name="command-center" options={{ title: 'Command Center' }} />
      <Stack.Screen name="attendance" options={{ title: 'Attendance' }} />
      <Stack.Screen name="report-detail" options={{ title: 'Job Details' }} />
      <Stack.Screen name="change-orders" options={{ title: 'Change Orders' }} />
      <Stack.Screen name="notifications" options={{ title: 'Inbox' }} />
      <Stack.Screen name="client-messages" options={{ title: 'Message FIAREP', headerBackTitle: 'Back' }} />
      <Stack.Screen name="fiarep-messages" options={{ title: 'Messages', headerBackTitle: 'Back' }} />
      <Stack.Screen name="message" options={{ title: 'Message' }} />
      <Stack.Screen name="my-jobs" options={{ title: 'My Jobs' }} />
      <Stack.Screen name="worker-change-order" options={{ title: 'Change Work Order' }} />
      <Stack.Screen name="leave-request" options={{ title: 'Request Time Off' }} />
      <Stack.Screen name="project/elevator" options={{ title: 'Elevator Services' }} />
      <Stack.Screen name="worker" options={{ title: 'Worker Jobs' }} />
      <Stack.Screen name="resident-lookup" options={{ title: 'Check Report Status' }} />
      <Stack.Screen name="emergency-units" options={{ title: 'Emergency Units' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
</Stack>
  );
}

// Field outreach only (FIAREP Services at FIAREP). Their records never leave
// the coordinator unit (the server enforces it), so this stack has no
// complaints, projects or inspections.
function CommunityStack() {
  return (
    <Stack initialRouteName="community-home">
      <Stack.Screen name="community-home" options={{ title: 'Community Coordinators', headerBackVisible: false }} />
      <Stack.Screen name="inspector-violations" options={{ title: 'HPD / DOB' }} />
      <Stack.Screen name="violation-guide" options={{ title: 'Take me there', headerBackTitle: 'Back' }} />
      <Stack.Screen name="translator" options={{ title: 'Translator' }} />
      <Stack.Screen name="command-center" options={{ title: 'Command Center' }} />
      <Stack.Screen name="community-resident" options={{ title: 'Resident' }} />
      <Stack.Screen name="community-building" options={{ title: 'Building & owner' }} />
      <Stack.Screen name="fiarep-messages" options={{ title: 'Messages', headerBackTitle: 'Back' }} />
      <Stack.Screen name="notifications" options={{ title: 'Inbox' }} />
      <Stack.Screen name="client-messages" options={{ title: 'Message FIAREP', headerBackTitle: 'Back' }} />
      <Stack.Screen name="message" options={{ title: 'Message' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
    </Stack>
  );
}

function ResidentStack() {
  return (
    <Stack initialRouteName="resident-home">
      <Stack.Screen name="resident-home" options={{ title: 'Resident Services', headerBackVisible: false }} />
      <Stack.Screen name="resident-desk" options={{ title: '' }} />
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
      <Stack.Screen name="vendor-change-order" options={{ title: 'Change Work Order' }} />
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
  const [locationBlocked, setLocationBlocked] = useState(false);

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
        } else if (restored && ['administrator', 'management', 'worker', 'inspector', 'emergency', 'community_coordinator'].includes(restored.role)) {
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
    // Check for new work every 30 seconds while the app is open, so an
    // assignment shows up (and alerts) without closing and reopening the app.
    const poll = setInterval(() => {
      if (AppState.currentState === 'active') syncAllEntities().catch(() => undefined);
    }, 30_000);
    return () => { mounted = false; sub.remove(); clearInterval(poll); };
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

  // Every staff role keeps Location on "Always": checked on every open and every
  // return to the app. Turned off, the app stops at this screen until it is back.
  const staffMode = !!mode && mode !== 'resident' && mode !== 'vendor';
  useEffect(() => {
    if (!staffMode) { setLocationBlocked(false); return; }
    const check = async () => {
      try {
        const fg = await Location.getForegroundPermissionsAsync();
        const bg = await Location.getBackgroundPermissionsAsync();
        setLocationBlocked(!(fg.granted && bg.granted));
      } catch { setLocationBlocked(false); }
    };
    void check();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') void check(); });
    return () => sub.remove();
  }, [staffMode]);

  let content;
  if (!booting && staffMode && locationBlocked) {
    content = (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 14, backgroundColor: '#fff' }}>
        <Text style={{ fontSize: 22, fontWeight: '800', textAlign: 'center' }}>Location is required</Text>
        <Text style={{ fontSize: 15, color: '#444', textAlign: 'center' }}>FIAREP records where you are while you use the app: the building you check in at, when you leave it and when you come back. Set Location to "Always" for FIAREP to keep using the app.</Text>
        <Pressable style={ui.btn} onPress={() => void (async () => {
          const { requireWorkerLocation } = await import('../lib/clock-location');
          if (await requireWorkerLocation()) setLocationBlocked(false);
        })()}><Text style={{ color: '#fff', fontWeight: '700' }}>Allow location</Text></Pressable>
        <Pressable style={ui.btnOutline} onPress={() => void Linking.openSettings()}><Text style={{ color: ACCENT, fontWeight: '700' }}>Open Settings</Text></Pressable>
      </SafeAreaView>
    );
  } else if (booting) {
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
  } else if (mode === 'community_coordinator') {
    content = <CommunityStack />;
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
