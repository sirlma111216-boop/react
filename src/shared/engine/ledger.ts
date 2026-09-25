import type { Lot, TeamState } from '../types';
import { MATERIALS } from '../chemistry/materials';
import { lotComponents } from '../chemistry/processes';

export type ElementCount = Record<string, number>;

export function addElements(into: ElementCount, materialId: string, units: number, sign = 1): void {
  const m = MATERIALS[materialId];
  if (!m) throw new Error(`물질 없음: ${materialId}`);
  for (const [el, n] of Object.entries(m.composition)) into[el] = (into[el] ?? 0) + sign * n * units;
}

export function addWater(into: ElementCount, units: number, sign = 1): void {
  into['H'] = (into['H'] ?? 0) + sign * 2 * units;
  into['O'] = (into['O'] ?? 0) + sign * units;
}

export function lotElements(lot: Lot, into: ElementCount = {}): ElementCount {
  for (const c of lotComponents(lot)) addElements(into, c.materialId, c.units);
  if (lot.solvent) addWater(into, lot.solvent);
  return into;
}

/** 팀이 현재 보유한 원소 총량 (재고 + 진행 중 공정의 확정 산출 + 회수수). */
export function heldElements(team: TeamState): ElementCount {
  const out: ElementCount = {};
  for (const lot of team.lots) lotElements(lot, out);
  for (const p of team.processes) {
    for (const lot of p.outputs) lotElements(lot, out);
    if (p.solventReleased) addWater(out, p.solventReleased);
  }
  addWater(out, team.solventLedger.recovered);
  addWater(out, team.solventLedger.disposed);
  return out;
}

/** 원장 검증: inflow − outflow == held 이어야 한다. 어긋난 원소 목록을 돌려준다. */
export function verifyTeamLedger(team: TeamState): { ok: boolean; diffs: { element: string; expected: number; actual: number }[] } {
  const held = heldElements(team);
  const diffs: { element: string; expected: number; actual: number }[] = [];
  const elements = new Set([...Object.keys(team.elementLedger.inflow), ...Object.keys(team.elementLedger.outflow), ...Object.keys(held)]);
  for (const el of elements) {
    const expected = (team.elementLedger.inflow[el] ?? 0) - (team.elementLedger.outflow[el] ?? 0);
    const actual = held[el] ?? 0;
    if (Math.abs(expected - actual) > 1e-9) diffs.push({ element: el, expected, actual });
  }
  return { ok: diffs.length === 0, diffs };
}

/** 로트 총 전하 (이온성 화합물은 formula unit 기준 0) */
export function lotCharge(lot: Lot): number {
  let q = 0;
  for (const c of lotComponents(lot)) q += (MATERIALS[c.materialId]?.charge ?? 0) * c.units;
  return q;
}

export function lotMassGrams(lot: Lot): number {
  let g = 0;
  for (const c of lotComponents(lot)) g += MATERIALS[c.materialId]!.molarMass * 0.1 * c.units;
  g += 18 * 0.1 * lot.solvent;
  return Math.round(g * 100) / 100;
}
