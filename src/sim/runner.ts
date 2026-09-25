import type { EconomyConfig, GameState, ModeId } from '../shared/types';
import { createGame, TEAM_COLORS, TEAM_EMBLEMS } from '../shared/engine/state';
import { startGame, beginExecute, settleRound, beginPlan, cachedReachability } from '../shared/engine/phases';
import { applyTeamCommand } from '../shared/engine/commands';
import { verifyTeamLedger } from '../shared/engine/ledger';
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
  }
  return ok;
}

/** 한 경기를 헤드리스로 끝까지 실행한다. 봇은 플레이어와 동일한 명령 검증을 거친다. */
export function runGame(spec: GameSpec, opts: { keepState?: boolean; verbose?: boolean } = {}): GameOutcome {
  const errors: string[] = [];
  const state = createGame({
    seed: spec.seed, mode: spec.mode, presetId: spec.presetId, roundsTotal: spec.rounds, config: spec.config ?? DEFAULT_ECONOMY,
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
      // 계획 단계
      for (const [i, t] of spec.teams.entries()) {
        const teamId = `T${i + 1}`;
        const ctx = { rng: subRng(spec.seed, 'bot', teamId, state.round, 'plan'), map, exec: makeExec(state, teamId) };
        BOTS[t.bot].plan(state, teamId, ctx);
      }
      beginExecute(state);
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
      settleRound(state);
      if (!checkInvariants(state, errors)) ledgerOk = false;
      if (opts.verbose) console.log(`R${state.round}: ` + state.teamOrder.map((id) => `${id}=${state.teams[id]!.coins}c/${state.teams[id]!.delivered}d`).join(' '));
      if (state.phase === 'settle') beginPlan(state);
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
      };
    });
    return { spec, teams, errors, ledgerOk, rounds: state.round, finalState: opts.keepState ? state : undefined };
  } catch (e) {
    errors.push(`예외: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    return { spec, teams: [], errors, ledgerOk: false, rounds: state.round, finalState: opts.keepState ? state : undefined };
  }
}
