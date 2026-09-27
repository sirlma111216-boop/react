import type { GameState, Lot, TeamState } from '../types';
import { lotComponents } from '../chemistry/processes';

/**
 * 경제 가치 원장 (V3). 물질량 원장(ledger.ts)과 섞지 않는다.
 * 단위는 밀리코인(1코인 = 1000). 모든 분배는 정수이며 합이 보존된다.
 * - 들어오는 곳: 구매(실제 지불액), 연구지원품·구버전 시작 묶음(명시된 외부지원 가치).
 * - 나가는 곳: 납품(delivered), 잉여 재고 매입(sold).
 * - 반응·가공·로트 병합/분할은 풀을 옮기기만 한다. 에너지·수수료·용매·촉매는 풀을 늘리지 않는다.
 */
export const MC = 1000;

export function materialValue(state: GameState, materialId: string): number {
  return state.config.materialValues?.[materialId] ?? state.config.prices[materialId] ?? 1;
}

/** 기준 회수가치(밀리코인/칸) */
export function refMc(state: GameState, materialId: string): number {
  return Math.round(materialValue(state, materialId) * MC);
}

export function ensureValueLedger(team: TeamState): NonNullable<TeamState['valueLedger']> {
  team.valueLedger ??= { inflow: 0, delivered: 0, sold: 0 };
  return team.valueLedger;
}

/** 로트에서 units 칸을 떼어 낼 때 함께 빠지는 풀 (마지막 칸이면 남은 풀 전부) */
export function takeBasis(lot: Lot, units: number): number {
  const basis = lot.basis ?? 0;
  if (basis <= 0 || units <= 0) return 0;
  const share = units >= lot.units ? basis : Math.floor((basis * units) / lot.units);
  lot.basis = basis - share;
  return share;
}

/** 떼어 내지 않고 몫만 계산 (견적용) */
export function peekBasis(lot: Lot, units: number): number {
  const basis = lot.basis ?? 0;
  if (basis <= 0 || units <= 0) return 0;
  return units >= lot.units ? basis : Math.floor((basis * units) / lot.units);
}

/** 산출 로트들에 풀을 기준 가치 비중대로 나눈다. 나머지는 가장 비중이 큰 로트에. 합은 pool 과 같다. */
export function distributeBasis(state: GameState, outputs: Lot[], pool: number): void {
  for (const o of outputs) o.basis = 0;
  if (pool <= 0 || !outputs.length) return;
  const weights = outputs.map((o) => lotComponents(o).reduce((a, c) => a + c.units * refMc(state, c.materialId), 0));
  const total = weights.reduce((a, b) => a + b, 0);
  let assigned = 0;
  let maxI = 0;
  outputs.forEach((o, i) => {
    const share = total > 0 ? Math.floor((pool * weights[i]!) / total) : i === 0 ? pool : 0;
    o.basis = share;
    assigned += share;
    if (weights[i]! > weights[maxI]!) maxI = i;
  });
  outputs[maxI]!.basis = (outputs[maxI]!.basis ?? 0) + (pool - assigned);
}

/** 팀이 지금 가진 풀: 창고 로트 + 진행 중 작업의 확정 산출 */
export function heldBasis(team: TeamState): number {
  let s = 0;
  for (const l of team.lots) s += l.basis ?? 0;
  for (const p of team.processes) for (const l of p.outputs) s += l.basis ?? 0;
  return s;
}

/** 원장 검증: inflow = held + delivered + sold. 로트의 풀은 음수일 수 없다. */
export function verifyValueLedger(team: TeamState): { ok: boolean; detail: string } {
  const v = team.valueLedger;
  if (!v) return { ok: true, detail: 'no ledger' };
  const held = heldBasis(team);
  const neg = team.lots.some((l) => (l.basis ?? 0) < 0) || team.processes.some((p) => p.outputs.some((l) => (l.basis ?? 0) < 0));
  const ok = !neg && v.inflow === held + v.delivered + v.sold;
  return { ok, detail: `inflow ${v.inflow} vs held ${held} + delivered ${v.delivered} + sold ${v.sold}${neg ? ' (음수 풀)' : ''}` };
}
