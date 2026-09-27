import type { EconomyConfig, GameState, ModeId } from '../shared/types';
import { createGame, TEAM_COLORS, TEAM_EMBLEMS } from '../shared/engine/state';
import { startGame, settleAndOpenNextRound, cachedReachability } from '../shared/engine/phases';
import { applyTeamCommand } from '../shared/engine/commands';
import { verifyTeamLedger } from '../shared/engine/ledger';
import { verifyValueLedger } from '../shared/engine/value';
import { subRng } from '../shared/engine/rng';
import { BOTS, makeExec, type BotId } from './bots';
import { DEFAULT_ECONOMY } from '../shared/config/economy';

export interface GameSpec {
  seed: string;
  mode: ModeId;
  presetId?: string;
  rounds: number;
  teams: { bot: BotId; bundleId: string; leaseId?: string }[];
  config?: EconomyConfig;
  /** 규칙 버전 (기본 3) */
  rules?: number;
}

export interface TeamOutcome {
  teamId: string;
  position: number;
  bot: BotId;
  bundleId: string;
  asset: number;
  coins: number;
  delivered: number;
  rank: number;
  firstDelivery: number | null;
  stalledRounds: number;
  revenue: number;
  deliveredTemplates: string[];
  equipmentBought: number;
  wonAuction: boolean;
  /** V3 관측 */
  buybackCoins: number;
  deliveredUnits: number;
  deliveredSupportUnits: number;
  supportRevenue: number;
  supportReturns: Record<string, number>;
  supportForfeits: number;
  /** 라운드별 받은 2묶음 추정가치 */
  keptValues: number[];
}

export interface GameOutcome {
  spec: GameSpec;
  teams: TeamOutcome[];
  errors: string[];
  ledgerOk: boolean;
  rounds: number;
  finalState?: GameState;
}

function checkInvariants(state: GameState, errors: string[]): boolean {
  let ok = true;
  for (const t of Object.values(state.teams)) {
    const v = verifyTeamLedger(t);
    if (!v.ok) { ok = false; errors.push(`R${state.round} ${t.id} 원장 불일치: ${v.diffs.map((d) => `${d.element} ${d.expected}≠${d.actual}`).join(', ')}`); }
    for (const l of t.lots) if (l.units < 0 || l.solvent < 0) { ok = false; errors.push(`R${state.round} ${t.id} 음수 재고 ${l.id}`); }
    if (t.coins < 0) { ok = false; errors.push(`R${state.round} ${t.id} 음수 코인`); }
    if (t.energy < 0 || t.energy > state.config.energyCap) { ok = false; errors.push(`R${state.round} ${t.id} 에너지 범위 이탈 ${t.energy}`); }
    if (t.contracts.length > state.config.contractLimit) { ok = false; errors.push(`R${state.round} ${t.id} 계약 한도 초과`); }
    const vv = verifyValueLedger(t);
    if (!vv.ok) { ok = false; errors.push(`R${state.round} ${t.id} 가치 원장 불일치: ${vv.detail}`); }
    if ((t.buyback?.totalCoins ?? 0) > (state.buybackGameCap ?? Infinity)) { ok = false; errors.push(`R${state.round} ${t.id} 매입 누적 상한 초과`); }
  }
  return ok;
}

/** 한 경기를 헤드리스로 끝까지 실행한다. 봇은 플레이어와 동일한 명령 검증을 거친다. */
export function runGame(spec: GameSpec, opts: { keepState?: boolean; verbose?: boolean } = {}): GameOutcome {
  const errors: string[] = [];
  const state = createGame({
    seed: spec.seed, mode: spec.mode, presetId: spec.presetId, roundsTotal: spec.rounds, config: spec.config ?? DEFAULT_ECONOMY, rules: spec.rules ?? 3,
    teams: spec.teams.map((t, i) => ({ id: `T${i + 1}`, name: `${t.bot}-${i + 1}`, color: TEAM_COLORS[i % TEAM_COLORS.length]!, emblem: TEAM_EMBLEMS[i % TEAM_EMBLEMS.length]!, bundleId: t.bundleId, leaseId: t.leaseId ?? null })),
  });
  for (const [i, t] of spec.teams.entries()) {
    applyTeamCommand(state, `T${i + 1}`, { type: 'chooseBundle', bundleId: t.bundleId });
    if (t.leaseId) applyTeamCommand(state, `T${i + 1}`, { type: 'chooseLease', equipmentId: t.leaseId });
  }
  try {
    startGame(state);
    let ledgerOk = true;
    let guard = 0;
    while (state.phase !== 'finished' && guard++ < 100) {
      const map = cachedReachability(state);
      // V3: 라운드 처음 각 팀 담당자가 연구지원품을 고른다 (자기 팀 공개 정보만 본다)
      for (const [i, t] of spec.teams.entries()) {
        const teamId = `T${i + 1}`;
        BOTS[t.bot].support(state, teamId, { rng: subRng(spec.seed, 'bot', teamId, state.round, 'support'), map, exec: makeExec(state, teamId) });
      }
      // 수동 라운드: 주문 받기·입찰(plan) 과 행동(execute)이 같은 라운드 안에서 이루어진다
      for (const [i, t] of spec.teams.entries()) {
        const teamId = `T${i + 1}`;
        const ctx = { rng: subRng(spec.seed, 'bot', teamId, state.round, 'plan'), map, exec: makeExec(state, teamId) };
        BOTS[t.bot].plan(state, teamId, ctx);
      }
      // 실행 단계: 팀 순서를 라운드마다 회전 (동시 진행 모사)
      const order = spec.teams.map((_, i) => i);
      const rot = state.round % order.length;
      const rotated = [...order.slice(rot), ...order.slice(0, rot)];
      for (const i of rotated) {
        const t = spec.teams[i]!;
        const teamId = `T${i + 1}`;
        const ctx = { rng: subRng(spec.seed, 'bot', teamId, state.round, 'exec'), map, exec: makeExec(state, teamId, opts.verbose ? (e) => console.log(`  ${teamId} 거절: ${e}`) : undefined) };
        BOTS[t.bot].execute(state, teamId, ctx);
      }
      for (const id of state.teamOrder) applyTeamCommand(state, id, { type: 'readyRound', on: true });
      const roundDone = state.round;
      settleAndOpenNextRound(state);
      if (!checkInvariants(state, errors)) ledgerOk = false;
      if (opts.verbose) console.log(`R${roundDone}: ` + state.teamOrder.map((id) => `${id}=${state.teams[id]!.coins}c/${state.teams[id]!.delivered}d`).join(' '));
    }
    if (state.phase !== 'finished') errors.push('경기가 종료되지 않음');
    const res = state.results ?? [];
    const teams: TeamOutcome[] = spec.teams.map((t, i) => {
      const id = `T${i + 1}`;
      const ts = state.teams[id]!;
      const r = res.find((x) => x.teamId === id);
      return {
        teamId: id, position: i, bot: t.bot, bundleId: t.bundleId, asset: r?.asset ?? 0, coins: ts.coins, delivered: ts.delivered, rank: r?.rank ?? 0,
        firstDelivery: ts.firstDeliveryRound, stalledRounds: ts.stalledRounds, revenue: ts.revenue, deliveredTemplates: ts.deliveredContracts.map((d) => d.templateId),
        equipmentBought: ts.equipment.filter((e) => !e.leased).length, wonAuction: state.auctions.some((a) => a.winnerId === id),
        buybackCoins: ts.buyback?.totalCoins ?? 0, deliveredUnits: ts.deliveredUnits ?? 0, deliveredSupportUnits: ts.deliveredSupportUnits ?? 0, supportRevenue: ts.supportRevenue ?? 0,
        supportReturns: (ts.supportHistory ?? []).reduce((acc, h) => { if (h.returnedKind) acc[h.returnedKind] = (acc[h.returnedKind] ?? 0) + 1; return acc; }, {} as Record<string, number>),
        supportForfeits: (ts.supportHistory ?? []).filter((h) => h.status === 'forfeited').length,
        keptValues: (ts.supportHistory ?? []).map((h) => h.keptValue),
      };
    });
    return { spec, teams, errors, ledgerOk, rounds: state.round, finalState: opts.keepState ? state : undefined };
  } catch (e) {
    errors.push(`예외: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    return { spec, teams: [], errors, ledgerOk: false, rounds: state.round, finalState: opts.keepState ? state : undefined };
  }
}
