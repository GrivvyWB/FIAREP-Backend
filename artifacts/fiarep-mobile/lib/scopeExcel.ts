import ExcelJS from 'exceljs';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { COST_CATEGORIES, COST_DISCLAIMER, type CostEstimateState } from './costEstimate';
import { lineAmount, sectionTotal, grandTotal as scopeGrand, costPerDU as scopeCostPerDU, type VendorScope } from './vendorScope';
import type { ProcurementRequest } from './store';

const parseNum = (v: any) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, '')); return isNaN(n) ? 0 : n; };
const money = '$#,##0.00';
const border1 = { style: 'thin', color: { rgb: '444444' } };
const allBorders = { top: border1, bottom: border1, left: border1, right: border1 };

// Build an .xlsx of the scope. If a Divisions scope is supplied (contract
// layout) it is exported with Division/Section/line rows; otherwise the legacy
// Nature-of-Work cost estimate is exported. Runs on-device with styled cells.
export async function exportScopeExcel(req: ProcurementRequest, est: CostEstimateState | any, divScope?: VendorScope | null): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Scope');
  const merges: any[] = [];
  let R = 0;
  const argb = (rgb: string) => `FF${rgb}`;
  const set = (r: number, c: number, v: any, s?: any, _t: string = 's') => {
    const cell = ws.getCell(r + 1, c + 1);
    cell.value = v;
    if (s) {
      cell.style = {
        ...s,
        ...(s.font ? { font: { ...s.font, ...(s.font.sz ? { size: s.font.sz } : {}) } } : {}),
        ...(s.fill ? { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(s.fill.fgColor.rgb) } } } : {}),
        ...(s.border ? {
          border: Object.fromEntries(Object.entries(s.border).map(([side, value]) => [
            side,
            { ...(value as object), color: { argb: argb((value as any).color.rgb) } },
          ])),
        } : {}),
      } as ExcelJS.Style;
    }
  };

  let lastCol = 2;
  let headerRow = -1;
  let noteRow = -1;

  const hasDivs = !!(divScope && Array.isArray(divScope.divisions) && divScope.divisions.length > 0);

  if (hasDivs) {
    // ── Division/Section layout: Description | Qty | Unit | Unit Cost | Amount
    lastCol = 4;
    const h = divScope!.header || {};
    const SECTION_FILL = { fill: { fgColor: { rgb: 'D9EAD3' } }, font: { bold: true }, border: allBorders };
    const DIV_FILL = { fill: { fgColor: { rgb: 'B6D7A8' } }, font: { bold: true, sz: 12 }, border: allBorders };
    const HEADER_FILL = { fill: { fgColor: { rgb: 'D9EAD3' } }, font: { bold: true }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: allBorders };
    const CELL = { border: allBorders, alignment: { vertical: 'top', wrapText: true } };
    const NUM_CELL = { border: allBorders, alignment: { horizontal: 'right', vertical: 'top' } };
    const COST_CELL = { border: allBorders, alignment: { horizontal: 'right', vertical: 'top' }, numFmt: money };

    // Title
    set(R, 0, 'SCOPE OF WORK', { font: { bold: true, sz: 13, underline: true }, alignment: { horizontal: 'center', vertical: 'center' } });
    merges.push({ s: { r: R, c: 0 }, e: { r: R, c: lastCol } });
    R += 2;

    const hdrRow = (k: string, v: string) => {
      set(R, 0, k, { font: { bold: false } });
      set(R, 1, v, { font: { bold: true } });
      merges.push({ s: { r: R, c: 1 }, e: { r: R, c: lastCol } });
      R += 1;
    };
    hdrRow('JOB ID:', String(req.trackingId || 'Not yet assigned'));
    hdrRow('CONTRACTOR:', String(h.contractor || req.vendor || ''));
    hdrRow('MULTI-BUILDING PROJECT?:', String(h.multiBuilding || ''));
    hdrRow('DATE:', String(h.date || ''));
    hdrRow('CONSTRUCTION PROJECT MANAGER:', String(h.projectManager || ''));
    hdrRow('NUMBER OF DUs:', String(h.numDUs || ''));
    hdrRow('PROJECT NAME:', String(h.projectName || ''));
    hdrRow('ADDRESS:', String(h.address || req.address || ''));
    R += 1;

    // Column headers
    set(R, 0, 'DESCRIPTION', HEADER_FILL);
    set(R, 1, 'QUANTITY', HEADER_FILL);
    set(R, 2, 'UNIT', HEADER_FILL);
    set(R, 3, 'UNIT COST', HEADER_FILL);
    set(R, 4, 'AMOUNT', HEADER_FILL);
    headerRow = R;
    R += 1;

    for (const d of divScope!.divisions) {
      // Division header row
      set(R, 0, d.title, DIV_FILL);
      for (let c = 1; c <= lastCol; c++) set(R, c, '', DIV_FILL);
      merges.push({ s: { r: R, c: 0 }, e: { r: R, c: lastCol } });
      R += 1;
      for (const sec of d.sections) {
        // Section header row
        set(R, 0, sec.code, SECTION_FILL);
        for (let c = 1; c <= lastCol; c++) set(R, c, '', SECTION_FILL);
        merges.push({ s: { r: R, c: 0 }, e: { r: R, c: lastCol } });
        R += 1;
        for (const l of sec.lines) {
          set(R, 0, String(l.description || ''), CELL);
          if (String(l.quantity || '').trim()) set(R, 1, parseNum(l.quantity), NUM_CELL, 'n'); else set(R, 1, '', CELL);
          set(R, 2, String(l.unit || ''), NUM_CELL);
          if (String(l.unitCost || '').trim()) set(R, 3, parseNum(l.unitCost), COST_CELL, 'n'); else set(R, 3, '', CELL);
          const amt = lineAmount(l);
          if (amt) set(R, 4, amt, COST_CELL, 'n'); else set(R, 4, '', CELL);
          R += 1;
        }
        // Section sub-total
        set(R, 0, '', { border: allBorders });
        set(R, 1, '', { border: allBorders });
        set(R, 2, '', { border: allBorders });
        set(R, 3, 'Sub-Total', { border: allBorders, alignment: { horizontal: 'right' }, font: { bold: true } });
        set(R, 4, sectionTotal(sec), { border: allBorders, alignment: { horizontal: 'right' }, numFmt: money, font: { bold: true } }, 'n');
        R += 1;
      }
    }

    R += 1;
    // Grand total + cost per DU
    set(R, 3, 'GRAND TOTAL', { border: allBorders, alignment: { horizontal: 'right' }, font: { bold: true } });
    set(R, 4, scopeGrand(divScope!), { border: allBorders, alignment: { horizontal: 'right' }, numFmt: money, font: { bold: true } }, 'n');
    R += 1;
    set(R, 3, 'COST PER D.U.', { border: allBorders, alignment: { horizontal: 'right' }, font: { italic: true } });
    set(R, 4, scopeCostPerDU(divScope!), { border: allBorders, alignment: { horizontal: 'right' }, numFmt: money, font: { italic: true } }, 'n');
    noteRow = R;

    ws.columns = [{ width: 60 }, { width: 12 }, { width: 10 }, { width: 14 }, { width: 16 }];
  } else {
    // ── Legacy Nature of Work & Estimate of Cost layout ──
    const h = (est && est.header) || {};
    const rows = (est && est.rows) || {};
    const estimate = COST_CATEGORIES.reduce((sum, c) => sum + parseNum((rows[c.id] || {}).cost), 0);
    const cont = estimate * 0.10;
    const total = estimate + cont;
    const units = parseNum((est && est.totals ? est.totals : {}).numUnits);
    const perDU = units > 0 ? total / units : 0;

    const SECTION_FILL = { fill: { fgColor: { rgb: 'D9EAD3' } }, font: { bold: true }, border: allBorders };
    const HEADER_FILL = { fill: { fgColor: { rgb: 'D9EAD3' } }, font: { bold: true }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: allBorders };
    const CELL = { border: allBorders, alignment: { vertical: 'top', wrapText: true } };
    const COST_CELL = { border: allBorders, alignment: { horizontal: 'right', vertical: 'top' }, numFmt: money };
    const KEY = { font: { bold: false } };
    const VAL = { font: { bold: true } };

    set(R, 0, 'NATURE OF WORK & ESTIMATE OF COST', { font: { bold: true, sz: 13, underline: true }, alignment: { horizontal: 'center', vertical: 'center' } });
    merges.push({ s: { r: R, c: 0 }, e: { r: R, c: 2 } });
    R += 2;

    const hdrRow = (k: string, v: string) => {
      set(R, 0, k, KEY);
      set(R, 1, v, VAL);
      merges.push({ s: { r: R, c: 1 }, e: { r: R, c: 2 } });
      R += 1;
    };
    hdrRow('DATE:', String(h.date || ''));
    hdrRow('BUILDING ADDRESS:', String(h.buildingAddress || ''));
    hdrRow('INSPECTION DATE(S):', String(h.inspectionDates || ''));
    hdrRow('CONST. PROJECT MANAGER:', String(h.projectManager || ''));
    if (h.companyName) hdrRow('COMPANY:', String(h.companyName));
    R += 1;

    set(R, 0, 'LOCATION:', HEADER_FILL);
    set(R, 1, 'BRIEF DESCRIPTION OF THE WORK REQUIRED TO REMOVE OR REMEDY THE CONDITION:', HEADER_FILL);
    set(R, 2, 'ESTIMATE OF COST:', HEADER_FILL);
    headerRow = R;
    R += 1;

    for (const c of COST_CATEGORIES) {
      const r = rows[c.id] || {};
      set(R, 0, c.title, SECTION_FILL);
      set(R, 1, '', SECTION_FILL);
      set(R, 2, '', SECTION_FILL);
      merges.push({ s: { r: R, c: 0 }, e: { r: R, c: 2 } });
      R += 1;
      set(R, 0, String(r.location || ''), CELL);
      set(R, 1, String(r.description || ''), CELL);
      if (r.cost) set(R, 2, parseNum(r.cost), COST_CELL, 'n');
      else set(R, 2, '', CELL);
      R += 1;
    }

    const totRow = (label: string, val: number | '', italic: boolean, bold: boolean) => {
      set(R, 0, '', { border: allBorders });
      set(R, 1, label, { border: allBorders, alignment: { horizontal: 'right' }, font: { italic, bold } });
      if (val === '') set(R, 2, '', { border: allBorders });
      else set(R, 2, val, { border: allBorders, alignment: { horizontal: 'right' }, numFmt: money, font: { italic, bold } }, 'n');
      R += 1;
    };
    totRow('COST ESTIMATE:', estimate, false, true);
    totRow('CONTINGENCY (10%):', cont, true, false);
    totRow('TOTAL :', total, false, true);
    totRow('COST/DU :', units > 0 ? perDU : '', true, false);

    R += 1;
    set(R, 0, 'PLEASE NOTE:', { font: { bold: true } });
    R += 1;
    set(R, 0, COST_DISCLAIMER, { font: { italic: true }, alignment: { wrapText: true, vertical: 'top' } });
    merges.push({ s: { r: R, c: 0 }, e: { r: R, c: 2 } });
    noteRow = R;

    ws.columns = [{ width: 32 }, { width: 58 }, { width: 16 }];
  }

  for (const merge of merges) {
    ws.mergeCells(merge.s.r + 1, merge.s.c + 1, merge.e.r + 1, merge.e.c + 1);
  }
  if (headerRow >= 0) ws.getRow(headerRow + 1).height = 40;
  if (noteRow >= 0) ws.getRow(noteRow + 1).height = 60;

  const contents = await wb.xlsx.writeBuffer();
  const safe = (req.address || 'scope').replace(/[^a-z0-9]+/gi, '_').slice(0, 40);
  const file = new File(Paths.document, 'scope_' + safe + '.xlsx');
  file.write(new Uint8Array(contents));

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      dialogTitle: 'Scope of Work',
      UTI: 'org.openxmlformats.spreadsheetml.sheet',
    });
  }
}
