import type { BuybackConfig, CommandResult, GameState, Lot, TeamState } from '../types';
import { MATERIALS } from '../chemistry/materials';
import { addElements, addWater } from './ledger';
import { ensureValueLedger, MC, peekBasis, refMc, takeBasis } from './value';
import { pushLog } from './state';
import { josa } from '../josa';

/**
 * 잉여 재고 매입 (V3). 상점의 낮은 수요를 표현하는 제한적 거래이며 납품을 대체하지 않는다.
 * - 팀당 라운드 1회, 여러 물질을 한 바구니로. 행동력은 들지 않는다.
 * - 한 라운드 상한 roundCap, 경기 누적 상한은 경기 길이에 비례해 시작 시 고정.
 * - 칸별 회수가 = rate × min(로트의 회수 원가 몫, 기준 회수가치 × 칸). 내부는 밀리코인 정수, 바구니 합계에서 최종 내림.
 * - 혼합물·진행 중 산출물·반송/미확정 지원품·설비는 대상이 아니다(재고 로트에 없거나 거절).
 */

export const DEFAULT_BUYBACK: BuybackConfig = { rate: 0.3, roundCap: 5, gameCap: 20, baseRounds: 10, perRound: 1 };

export function buybackConfig(state: GameState): BuybackConfig {
  return state.config.buyback ?? DEFAULT_BUYBACK;
}

/** 경기 길이에 비례한 누적 상한 (시작 시 state.buybackGameCap 로 고정) */
export function computeGameCap(state: GameState): number {
  const c = buybackConfig(state);
  return Math.max(c.roundCap, Math.round((c.gameCap * state.roundsTotal) / c.baseRounds));
}

export function gameCapOf(state: GameState): number {
  return state.buybackGameCap ?? computeGameCap(state);
}

/** 매입할 수 있는 로트인가 */
export function lotSellable(lot: Lot): boolean {
  return lot.kind === 'pure' && lot.units > 0 && !!MATERIALS[lot.materialId!];
}

export interface BuybackLine { lotId: string; materialId: string; units: number; mc: number; capped: boolean }
export interface BuybackQuote {
  ok: boolean;
  error?: string;
  lines: BuybackLine[];
  /** 밀리코인 합계와 최종 코인(내림) */
  totalMc: number;
  coins: number;
  roundLeft: number;
  gameLeft: number;
  usedThisRound: boolean;
}

/** 견적 (상태를 바꾸지 않는다). 서버·UI가 같은 함수를 쓴다. */
export function quoteBuyback(state: GameState, team: TeamState, items: { lotId: string; units: number }[]): BuybackQuote {
  const c = buybackConfig(state);
  const bb = team.buyback ?? { lastRound: 0, totalCoins: 0, sales: [] };
  const usedThisRound = bb.lastRound === state.round;
  const gameLeft = Math.max(0, gameCapOf(state) - bb.totalCoins);
  const roundLeft = usedThisRound ? 0 : Math.min(c.roundCap, gameLeft);
  const lines: BuybackLine[] = [];
  const seen = new Set<string>();
  const base = { lines, totalMc: 0, coins: 0, roundLeft, gameLeft, usedThisRound };
  const rateNum = Math.round(c.rate * 1000);
  for (const it of items) {
    const units = Math.floor(Number(it.units));
    if (!(units > 0)) continue;
    if (seen.has(it.lotId)) return { ...base, ok: false, error: '같은 재료가 두 번 들어 있어요.' };
    seen.add(it.lotId);
    const lot = team.lots.find((l) => l.id === it.lotId);
    if (!lot) return { ...base, ok: false, error: '창고에 없는 재료예요. (만드는 중이거나 이미 쓴 것)' };
    if (lot.kind !== 'pure') return { ...base, ok: false, error: '섞인 것은 그대로 넘길 수 없어요. 먼저 정리해 유효한 재료를 얻으세요.' };
    if (!lotSellable(lot)) return { ...base, ok: false, error: '넘길 수 없는 재료예요.' };
    if (units > lot.units) return { ...base, ok: false, error: `${MATERIALS[lot.materialId!]!.displayName}${josa(MATERIALS[lot.materialId!]!.displayName, '은/는')} ${lot.units}개만 있어요.` };
    const share = peekBasis(lot, units);
    const cap = refMc(state, lot.materialId!) * units;
    const mc = Math.floor((Math.min(share, cap) * rateNum) / 1000);
    lines.push({ lotId: lot.id, materialId: lot.materialId!, units, mc, capped: share > cap });
  }
  const totalMc = lines.reduce((a, l) => a + l.mc, 0);
  const coins = Math.floor(totalMc / MC);
  return { ...base, ok: true, lines, totalMc, coins };
}

/**
 * 이 바구니를 넘기면 받은 의뢰에 쓸 재료가 모자라게 되는가 (경고만, 막지 않는다).
 * 납품 조건에 바로 쓰는 재고와, 보유 의뢰 경로의 원료로 쓰일 재고를 함께 본다.
 */
export function buybackShortfall(team: TeamState, items: { lotId: string; units: number }[], needs: Record<string, number>): { materialId: string; short: number }[] {
  const sell: Record<string, number> = {};
  for (const it of items) {
    const lot = team.lots.find((l) => l.id === it.lotId);
    if (lot?.kind === 'pure') sell[lot.materialId!] = (sell[lot.materialId!] ?? 0) + Math.max(0, Math.floor(it.units));
  }
  const out: { materialId: string; short: number }[] = [];
  for (const [m, n] of Object.entries(sell)) {
    const need = needs[m] ?? 0;
    if (!need) continue;
    const have = team.lots.filter((l) => l.kind === 'pure' && l.materialId === m).reduce((a, l) => a + l.units, 0);
    const before = Math.max(0, need - have);
    const after = Math.max(0, need - (have - n));
    if (after > before) out.push({ materialId: m, short: after });
  }
  return out;
}

/** 매입 실행: 선택한 칸만큼 소비하고 확정 전에 보여 준 견적과 같을 때만 코인을 준다. */
export function sellSurplus(state: GameState, team: TeamState, items: { lotId: string; units: number }[], expectCoins?: number): CommandResult {
  const c = buybackConfig(state);
  const q = quoteBuyback(state, team, items);
  if (!q.ok) return { ok: false, error: q.error };
  if (!q.lines.length) return { ok: false, error: '넘길 재료를 고르세요.' };
  if (q.usedThisRound) return { ok: false, error: `재고 매입은 라운드마다 ${c.perRound}번이에요. 다음 라운드에 다시 할 수 있어요.` };
  if (q.gameLeft <= 0) return { ok: false, error: '이번 경기의 매입 한도를 모두 썼어요.' };
  if (q.coins <= 0) return { ok: false, error: '이 바구니는 0코인이에요. 수량을 늘리거나 보관하세요. (물질만 잃지 않도록 매입하지 않아요)' };
  if (q.coins > q.roundLeft) return { ok: false, error: `한도(${q.roundLeft}코인)를 넘어요. 수량을 줄여 주세요. 넘는 만큼 재고를 가져가지 않아요.` };
  if (expectCoins !== undefined && expectCoins !== q.coins) return { ok: false, error: `견적이 바뀌었어요 (지금 ${q.coins}코인). 다시 확인해 주세요.` };
  const ledger = ensureValueLedger(team);
  let units = 0;
  for (const line of q.lines) {
    const lot = team.lots.find((l) => l.id === line.lotId)!;
    const solvTake = lot.units > 0 ? Math.floor((lot.solvent * line.units) / lot.units) : 0;
    ledger.sold += takeBasis(lot, line.units);
    lot.units -= line.units;
    lot.solvent -= solvTake;
    // 물질량 원장: 팀 밖으로 나간 물질 (외부 반출)
    addElements(team.elementLedger.outflow, line.materialId, line.units);
    if (solvTake) addWater(team.elementLedger.outflow, solvTake);
    units += line.units;
  }
  team.lots = team.lots.filter((l) => l.units > 0 || l.solvent > 0);
  team.coins += q.coins;
  const bb = (team.buyback ??= { lastRound: 0, totalCoins: 0, sales: [] });
  bb.lastRound = state.round;
  bb.totalCoins += q.coins;
  bb.sales.push({ round: state.round, coins: q.coins, units });
  pushLog(state, 'buyback', `${team.name}: 잉여 재고 ${units}개 매입 +${q.coins}코인`, team.id);
  return { ok: true, consumedAction: false };
}
