import type { EconomyConfig, GameState, Lot, ModeId, TeamState } from '../types';
import { DEFAULT_ECONOMY, SHOP_BY_MODE, cloneConfig, withDerivedValues } from '../config/economy';
import { findPreset } from '../chemistry/modes';
import { makePureLot } from '../chemistry/processes';
import { MATERIALS } from '../chemistry/materials';
import { addElements, addWater } from './ledger';
import { ensureValueLedger, MC, refMc } from './value';

export const SCIENCE_VERSION = 'chem-1.0';
export const ENGINE_BUILD = 'engine-3.0';
/** 새 경기의 규칙 버전. 저장된 구버전 경기(rules 없음)는 2로 읽고 지급 방식을 소급 변경하지 않는다. */
export const RULES_VERSION = 3;

export const TEAM_COLORS = ['#1F6F78', '#B87346', '#5B7F3A', '#8C4E7A', '#C48F1F', '#4A6FB5', '#A8493E', '#4E8C7B'];
export const TEAM_EMBLEMS = ['circle', 'triangle', 'diamond', 'hexagon', 'star', 'square', 'wave', 'leaf'] as const;
export const EMBLEM_LABEL: Record<string, string> = { circle: '원', triangle: '삼각', diamond: '마름모', hexagon: '육각', star: '별', square: '사각', wave: '물결', leaf: '잎' };

export interface TeamSeed {
  id: string;
  name: string;
  color: string;
  emblem: string;
  bundleId?: string | null;
  leaseId?: string | null;
}

export interface GameOptions {
  seed: string;
  mode: ModeId;
  presetId?: string;
  roundsTotal?: number;
  config?: EconomyConfig;
  teams: TeamSeed[];
  /** 기본 manual. 시간제 구버전 검증용으로만 'timed' */
  turnMode?: 'manual' | 'timed';
  /** 기본 3(V3). 2 = 고정 시작 묶음·지원품 없음(구버전 재현·회귀 테스트용) */
  rules?: number;
}

export function createTeam(seed: TeamSeed, config: EconomyConfig): TeamState {
  return {
    id: seed.id,
    name: seed.name,
    color: seed.color,
    emblem: seed.emblem,
    bundleId: seed.bundleId ?? null,
    leaseId: seed.leaseId ?? null,
    coins: config.startCoins,
    energy: config.startEnergy,
    actionsLeft: 0,
    lots: [],
    processes: [],
    equipment: [],
    contracts: [],
    offers: [],
    templateCounts: {},
    cancelledThisRound: false,
    lastCancelRound: 0,
    bid: 0,
    purchasesThisRound: {},
    heatRecoveredThisRound: 0,
    delivered: 0,
    deliveredContracts: [],
    revenue: 0,
    assetHistory: [],
    solventLedger: { inflow: 0, recovered: 0, disposed: 0 },
    elementLedger: { inflow: {}, outflow: {} },
    memo: '',
    pins: [],
    operatorId: null,
    operatorIndex: 0,
    roundReady: false,
    badges: [],
    stalledRounds: 0,
    firstDeliveryRound: null,
    producedCount: 0,
    processedCount: 0,
    reactionUse: {},
    support: null,
    supportHistory: [],
    buyback: { lastRound: 0, totalCoins: 0, sales: [] },
    valueLedger: { inflow: 0, delivered: 0, sold: 0 },
    deliveredUnits: 0,
    deliveredSupportUnits: 0,
    supportRevenue: 0,
  };
}

/** 로트를 재고에 추가하되, 동일 물질·등급·태그·이력의 순물질 로트는 합친다. */
export function addLot(team: TeamState, lot: Lot): void {
  if (lot.units <= 0 && lot.solvent <= 0) return;
  if (lot.kind === 'pure') {
    const key = lotMergeKey(lot);
    const existing = team.lots.find((l) => l.kind === 'pure' && lotMergeKey(l) === key);
    if (existing) {
      existing.units += lot.units;
      existing.solvent += lot.solvent;
      if (lot.basis) existing.basis = (existing.basis ?? 0) + lot.basis;
      return;
    }
  }
  team.lots.push(lot);
}

export function lotMergeKey(lot: Lot): string {
  return [lot.materialId, lot.grade, [...lot.tags].sort().join('+'), lot.origin.type, lot.origin.reactionId ?? '', lot.origin.chain.join('>')].join('|');
}

/**
 * 외부 유입(구매·시작 묶음·연구지원품)을 원장에 기록하며 로트를 추가한다.
 * basisMc: 이 유입의 경제 가치 풀(밀리코인) — 구매는 실제 지불액, 지원품은 명시된 외부지원 가치.
 */
export function receiveExternal(team: TeamState, materialId: string, units: number, originType: 'purchase' | 'bundle' | 'lease' | 'support', idGen: () => string, opts: { basisMc?: number; tags?: string[] } = {}): void {
  const m = MATERIALS[materialId];
  if (!m) throw new Error(`물질 없음: ${materialId}`);
  const solvent = m.phase === 'aq' ? units : 0;
  const isSupport = originType === 'support';
  const lot = makePureLot(materialId, units, isSupport ? 'support' : 'purchased', isSupport ? [...(opts.tags ?? [])] : ['purchased'], { type: originType, chain: [] }, solvent, idGen());
  const basis = Math.max(0, Math.round(opts.basisMc ?? 0));
  if (basis) { lot.basis = basis; ensureValueLedger(team).inflow += basis; }
  addElements(team.elementLedger.inflow, materialId, units);
  if (solvent) {
    addWater(team.elementLedger.inflow, solvent);
    team.solventLedger.inflow += solvent;
  }
  addLot(team, lot);
}

export function createGame(opts: GameOptions): GameState {
  const base = opts.config ? cloneConfig(opts.config) : cloneConfig(DEFAULT_ECONOMY);
  // 기준 회수가치는 경기 시작 시 설정 스냅숏에 고정한다 (경기 중 가격표가 바뀌어도 매입가는 그대로)
  const config = base.materialValues ? base : withDerivedValues(base);
  const preset = findPreset(opts.mode, opts.presetId);
  const teams: Record<string, TeamState> = {};
  for (const t of opts.teams) teams[t.id] = createTeam(t, config);
  return {
    version: 0,
    seed: opts.seed,
    mode: opts.mode,
    presetId: preset.id,
    roundsTotal: opts.roundsTotal ?? 10,
    round: 0,
    phase: 'setup',
    config,
    scienceVersion: SCIENCE_VERSION,
    buildHash: ENGINE_BUILD,
    teamOrder: opts.teams.map((t) => t.id),
    teams,
    activeReactions: preset.reactions.slice(),
    activeContracts: preset.contracts.slice(),
    activeEquipment: preset.equipment.slice(),
    shopMaterials: SHOP_BY_MODE[opts.mode]!.slice(),
    priceAdjust: {},
    rewardAdjust: {},
    events: [],
    auctions: [],
    log: [],
    results: null,
    transportBonusRound: null,
    turnMode: opts.turnMode ?? 'manual',
    market: {},
    marketHistory: {},
    roundVersion: 0,
    rules: opts.rules ?? RULES_VERSION,
  };
}

/** 이 경기가 V3 규칙(연구지원품·재고 매입·가치 원장)을 쓰는가 */
export function isV3(state: GameState): boolean {
  return (state.rules ?? 2) >= 3;
}

/** 기준 회수가치 × 칸 (밀리코인) — 지원품 외부 가치 풀 */
export function supportBasisMc(state: GameState, materialId: string, units: number): number {
  return refMc(state, materialId) * units;
}
export { MC };

export function priceOf(state: GameState, materialId: string): number {
  const base = state.config.prices[materialId] ?? 0;
  return Math.max(1, base + (state.priceAdjust[materialId] ?? 0));
}

export function equipmentPrice(state: GameState, id: string): number {
  return state.config.equipmentPrices[id] ?? 0;
}

export function reactionSlots(state: GameState, team: TeamState): number {
  return state.config.reactionSlots + (team.equipment.some((e) => e.id === 'U01') ? 1 : 0);
}

export function hasEquipment(team: TeamState, id: string): boolean {
  return team.equipment.some((e) => e.id === id);
}

export function salvageValue(state: GameState, team: TeamState): number {
  let s = 0;
  for (const e of team.equipment) if (!e.leased) s += Math.floor(e.paid * state.config.equipmentSalvageRate);
  return s;
}

export function teamAsset(state: GameState, team: TeamState): number {
  return team.coins + salvageValue(state, team);
}

export function pushLog(state: GameState, type: string, text: string, teamId?: string): void {
  state.log.push({ at: state.log.length, round: state.round, teamId, type, text });
  if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
}

let idc = 0;
export function makeIdGen(prefix: string): () => string {
  return () => `${prefix}${(++idc).toString(36)}`;
}
