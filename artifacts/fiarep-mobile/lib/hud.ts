import * as SQLite from 'expo-sqlite';
import { addNotification, listManagementForDevelopment, queueMutation } from './store';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

let _db: SQLite.SQLiteDatabase | null = null;
async function db(): Promise<SQLite.SQLiteDatabase> {
  if (!_db) _db = await SQLite.openDatabaseAsync('construction.db');
  return _db;
}
async function ensureHudTable(d: SQLite.SQLiteDatabase) {
  try { await d.execAsync('CREATE TABLE IF NOT EXISTS hud_inspections (id TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL)'); } catch (e) {}
}

// ---- HUD / NSPIRE inspection types ----

export type HudInspectionType = 'initial' | 'annual' | 'special' | 'reinspection';
export type HudStatus = 'pending' | 'in_progress' | 'completed' | 'failed';
export type PassFail = 'pass' | 'fail';
export type HudResult = 'pass' | 'fail' | 'inconclusive';
export type Severity = 'low' | 'medium' | 'high';
export type RoomType = 'living_room' | 'kitchen' | 'bathroom' | 'bedroom' | 'hallway' | 'common_area';
export type DeficiencyLocation = 'unit' | 'inside' | 'outside';
export type CorrectionTimeframe = '24_hours' | '30_days' | 'annual';
export type RationaleCode = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6' | 'PP1';
export type PhysicalCategory = 'interior' | 'exterior';
export type Urgency = 'high' | 'medium' | 'low';
export type LeadRisk = 'low' | 'medium' | 'high';
export type LeadAction = 'stabilization' | 'abatement' | 'clearance_test';
export type ActionStatus = 'pending' | 'in_progress' | 'completed';

export type HudItem = {
  id: string;
  itemName: string;
  result: HudResult;
  comments?: string;
  severity?: Severity;
  photos: string[];
};

export type HudRoom = {
  id: string;
  roomType: RoomType;
  items: HudItem[];
};

export type HudDeficiency = {
  id: string;
  title: string;
  definition?: string;
  location?: DeficiencyLocation;
  criteria?: string;
  healthSafety?: boolean;
  correctionTimeframe?: CorrectionTimeframe;
  rationaleCode?: RationaleCode;
  notes?: string;
  photos: string[];
};

export type HudPhysicalItem = {
  id: string;
  category: PhysicalCategory;
  itemName: string;
  maintenanceNeeded?: boolean;
  urgency?: Urgency;
  onPriorReport?: boolean;
  estimatedCost?: number;
  photos: string[];
};

export type HudLeadAssessment = {
  leadVisualAssessment?: boolean;
  deterioratedPaintPresent?: boolean;
  riskLevel?: LeadRisk;
  requiredAction?: LeadAction;
  photos: string[];
};

export type HudLifeSafety = {
  smokeDetectorsPresent?: boolean;
  coDetectorsPresent?: boolean;
  fireExitsClear?: boolean;
  emergencyLightingOperational?: boolean;
  tripHazardsPresent?: boolean;
  gasLeakDetected?: boolean;
  electricalHazardPresent?: boolean;
};

export type HudCorrectiveAction = {
  id: string;
  description: string;
  assignedToStaff?: string;
  deadline?: string;
  status?: ActionStatus;
};

export type HudInspection = {
  id: string;
  inspectionType: HudInspectionType;
  inspectionDate: string;
  inspectorName: string;
  development: string;
  projectId?: string;
  unitAddress: string;
  unitId?: string;
  residentName?: string;
  staffName?: string;
  housingType?: string;
  yearConstructed?: number;
  status: HudStatus;
  childrenUnder6?: boolean;
  utilitiesAvailable: string[];
  overallResult?: PassFail;
  followUpDate?: string;
  inspectorSignature?: string;
  generalComments?: string;
  rooms: HudRoom[];
  deficiencies: HudDeficiency[];
  physicalItems: HudPhysicalItem[];
  lead: HudLeadAssessment;
  lifeSafety: HudLifeSafety;
  correctiveActions: HudCorrectiveAction[];
  notes: HudNote[];
  review?: HudReview;
  createdAt: string;
  updatedAt: string;
};

export type ReviewDecision = 'approved' | 'needs_revision' | 'rejected';
export type HudReview = {
  decision: ReviewDecision;
  decidedBy: string;
  decidedAt: string;
  notes?: string;
};

export type HudNote = {
  id: string;
  text: string;
  byRole: string;
  byName: string;
  at: string;
};

// ---- Storage ----

export function newHudInspection(): HudInspection {
  const now = new Date().toISOString();
  return {
    id: uid(),
    inspectionType: 'annual',
    inspectionDate: now.slice(0, 10),
    inspectorName: '',
    development: '',
    unitAddress: '',
    status: 'in_progress',
    utilitiesAvailable: [],
    rooms: [],
    deficiencies: [],
    physicalItems: [],
    lead: { photos: [] },
    lifeSafety: {},
    correctiveActions: [],
    notes: [],
    createdAt: now,
    updatedAt: now,
  };
}

export async function saveHudInspection(insp: HudInspection): Promise<void> {
  const d = await db();
  await ensureHudTable(d);
  const next = { ...insp, updatedAt: new Date().toISOString() };
  const existing = await d.getFirstAsync<{ id: string }>('SELECT id FROM hud_inspections WHERE id = ?', insp.id);
  if (existing) {
    await d.runAsync('UPDATE hud_inspections SET state = ? WHERE id = ?', JSON.stringify(next), insp.id);
  } else {
    await d.runAsync('INSERT INTO hud_inspections (id,state) VALUES (?,?)', insp.id, JSON.stringify(next));
  }
}

export async function addHudNote(inspectionId: string, text: string, byRole: string, byName: string): Promise<void> {
  const insp = await getHudInspection(inspectionId);
  if (!insp) return;
  const note: HudNote = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    text: text.trim(),
    byRole,
    byName,
    at: new Date().toISOString(),
  };
  const next = { ...insp, notes: [...(insp.notes || []), note] };
  await saveHudInspection(next);
}

// Notify admin + management for the inspection's development that it's ready for review.
export async function notifyInspectionForReview(insp: HudInspection): Promise<void> {
  const queued = {
    ...insp,
    ...(insp.review?.decision === "needs_revision"
      ? { _pendingWorkflowActions: [{ action: "resubmit", body: {} }] }
      : {}),
  };
  await queueMutation("hud-inspections", insp.id, queued);
  const detail = (insp.unitAddress || 'Inspection') + (insp.development ? ' \u00b7 ' + insp.development : '');
  await addNotification('administrator', 'HUD inspection ready for review', detail, 'hud:' + insp.id);
  if (insp.development) {
    try {
      const mgrs = await listManagementForDevelopment(insp.development);
      for (const m of mgrs) { await addNotification(m.name, 'HUD inspection ready for review', detail, 'hud:' + insp.id); }
    } catch {}
  }
}

// Admin records a decision (approved / needs_revision / rejected) and notifies the inspector.
export async function setHudReview(inspectionId: string, decision: ReviewDecision, notes: string, byName: string): Promise<void> {
  const insp = await getHudInspection(inspectionId);
  if (!insp) return;
  const review: HudReview = { decision, decidedBy: byName, decidedAt: new Date().toISOString(), notes: notes.trim() || undefined };
  const nextStatus = decision === 'approved' ? 'completed' : insp.status;
  const next = { ...insp, review, status: nextStatus as HudStatus };
  await saveHudInspection(next);
  // Notify the inspector by name.
  const label = decision === 'approved' ? 'HUD inspection approved' : decision === 'needs_revision' ? 'HUD inspection needs revision' : 'HUD inspection rejected';
  const detail = (insp.unitAddress || 'Inspection') + (notes.trim() ? ' \u00b7 ' + notes.trim() : '');
  if (insp.inspectorName) { await addNotification(insp.inspectorName, label, detail, 'hud:' + insp.id); }
}

export async function listHudInspections(): Promise<HudInspection[]> {
  const d = await db();
  await ensureHudTable(d);
  const rows = await d.getAllAsync<{ state: string }>('SELECT state FROM hud_inspections');
  const items = rows.map(r => { try { return JSON.parse(r.state) as HudInspection; } catch { return null; } }).filter(Boolean) as HudInspection[];
  return items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export async function getHudInspection(id: string): Promise<HudInspection | null> {
  const d = await db();
  await ensureHudTable(d);
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM hud_inspections WHERE id = ?', id);
  if (!row) return null;
  try { return JSON.parse(row.state) as HudInspection; } catch { return null; }
}

export async function deleteHudInspection(id: string): Promise<void> {
  const d = await db();
  await ensureHudTable(d);
  await d.runAsync('DELETE FROM hud_inspections WHERE id = ?', id);
}

export const RATIONALE_CODES: RationaleCode[] = ['R1','R2','R3','R4','R5','R6','R7','M1','M2','M3','M4','M5','M6','PP1'];
export const ROOM_TYPES: RoomType[] = ['living_room','kitchen','bathroom','bedroom','hallway','common_area'];
export const HUD_INSPECTION_TYPES: HudInspectionType[] = ['initial','annual','special','reinspection'];
export const CORRECTION_TIMEFRAMES: CorrectionTimeframe[] = ['24_hours','30_days','annual'];
