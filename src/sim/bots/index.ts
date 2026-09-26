import type { ContractInstance, GameState, TeamCommand } from '../../shared/types';
import { Rng } from '../../shared/engine/rng';
import { applyTeamCommand, availableCoins } from '../../shared/engine/commands';
import { REACTIONS } from '../../shared/chemistry/reactions';
import { hasEquipment, equipmentPrice } from '../../shared/engine/state';
import { contractPayout } from '../../shared/engine/market';
import { affordableEquipment, deliverable, feasibleProcesses, feasibleReactions, nextProcess, nextProcureItems, nextReaction, planForContract, type BotView, type Plan } from './helpers';
import type { ReachabilityMap } from '../../shared/engine/reachability';

export type BotId = 'random' | 'quickcash' | 'planner' | 'byproduct' | 'investor' | 'bidder';
export const BOT_IDS: BotId[] = ['random', 'quickcash', 'planner', 'byproduct', 'investor', 'bidder'];
export const BOT_LABEL: Record<BotId, string> = { random: '무작위 봇', quickcash: '즉시 현금 봇', planner: '다단계 계획 봇', byproduct: '부산물 회수 봇', investor: '설비 투자 봇', bidder: '입찰 기회 봇' };

export interface BotContext {
  rng: Rng;
  map: ReachabilityMap;
  /** 명령 실행 (결과 기록용) */
  exec: (cmd: TeamCommand) => boolean;
}

export interface Bot {
  id: BotId;
  plan(state: GameState, teamId: string, ctx: BotContext): void;
  execute(state: GameState, teamId: string, ctx: BotContext): void;
}

const view = (state: GameState, teamId: string, map: ReachabilityMap): BotView => ({ state, team: state.teams[teamId]!, map });

function takeBestOffers(v: BotView, ctx: BotContext, score: (p: Plan) => number): void {
  const { state, team } = v;
  let guard = 4;
  while (team.contracts.length < state.config.contractLimit - (team.bid > 0 ? 1 : 0) && guard-- > 0) {
    const plans = team.offers.map((o) => planForContract(v, o)).filter((p) => p.feasible && Number.isFinite(p.cost));
    if (!plans.length) break;
    plans.sort((a, b) => score(b) - score(a));
    if (score(plans[0]!) <= 0) break;
    if (!ctx.exec({ type: 'takeContract', offerId: plans[0]!.contract.id })) break;
  }
}

function currentPlans(v: BotView): Plan[] {
  return v.team.contracts.map((c) => planForContract(v, c)).sort((a, b) => a.rounds - b.rounds || b.contract.reward - a.contract.reward);
}

/** 계획 실행의 공통 우선순위: 납품 > 공정 > 반응 > 조달 */
function executePlans(v: BotView, ctx: BotContext, opts: { allowEquipment?: (v: BotView) => string | null; holdOnLowMarket?: boolean } = {}): void {
  const { team, state } = v;
  let guard = 6;
  while (team.actionsLeft > 0 && guard-- > 0) {
    // 시세가 낮고(z ≤ −1) 기한·라운드 여유가 있으면 한 라운드 보관하는 정책 (기회비용 기반)
    const remaining = state.roundsTotal - state.round;
    const candidates = deliverable(team).filter((c) => !(opts.holdOnLowMarket && contractPayout(state, c).z <= -1 && remaining >= 2 && (c.special || c.deadlineRound > state.round)));
    const d = candidates.sort((a, b) => contractPayout(state, b).total - contractPayout(state, a).total)[0];
    if (d) { if (ctx.exec({ type: 'deliver', contractId: d.id })) continue; }
    const plans = currentPlans(v);
    let acted = false;
    for (const p of plans) {
      const pr = nextProcess(v, p);
      if (pr && ctx.exec({ type: 'process', processId: pr.processId, lotId: pr.lotId })) { acted = true; break; }
      const rx = nextReaction(v, p);
      if (rx && ctx.exec({ type: 'react', reactionId: rx.reactionId, scale: rx.scale })) { acted = true; break; }
    }
    if (acted) continue;
    const eq = opts.allowEquipment?.(v);
    if (eq && ctx.exec({ type: 'equip', equipmentId: eq })) continue;
    for (const p of plans) {
      if (p.missingEquipment.length) {
        const e = p.missingEquipment[0]!;
        if (equipmentPrice(v.state, e) <= availableCoins(team) && ctx.exec({ type: 'equip', equipmentId: e })) { acted = true; break; }
      }
      const items = nextProcureItems(v, p);
      if (items.length && ctx.exec({ type: 'procure', items })) { acted = true; break; }
    }
    if (acted) continue;
    // 계획이 없거나 막혔을 때: 에너지 부족이면 충전, 아니면 남는 원료로 가능한 공정
    const fp = feasibleProcesses(v);
    if (fp.length && ctx.exec({ type: 'process', processId: fp[0]!.processId, lotId: fp[0]!.lotId })) continue;
    if (team.energy < 3 && availableCoins(team) >= 2 && ctx.exec({ type: 'buyEnergy', bundles: 1 })) continue;
    break;
  }
}

export const RandomBot: Bot = {
  id: 'random',
  plan(state, teamId, ctx) {
    const team = state.teams[teamId]!;
    if (team.offers.length && team.contracts.length < state.config.contractLimit && ctx.rng.next() < 0.8) ctx.exec({ type: 'takeContract', offerId: ctx.rng.pick(team.offers).id });
    const auction = state.auctions.find((a) => a.round === state.round && !a.resolved);
    if (auction && ctx.rng.next() < 0.5) ctx.exec({ type: 'bid', amount: ctx.rng.int(4) });
  },
  execute(state, teamId, ctx) {
    const v = view(state, teamId, ctx.map);
    const { team } = v;
    let guard = 8;
    while (team.actionsLeft > 0 && guard-- > 0) {
      const options: TeamCommand[] = [];
      for (const d of deliverable(team)) options.push({ type: 'deliver', contractId: d.id });
      for (const f of feasibleReactions(v)) options.push({ type: 'react', reactionId: f.reactionId, scale: f.scale });
      for (const p of feasibleProcesses(v)) options.push({ type: 'process', processId: p.processId, lotId: p.lotId });
      const shop = state.shopMaterials.filter((m) => (state.config.prices[m] ?? 9) <= availableCoins(team));
      if (shop.length) options.push({ type: 'procure', items: [{ materialId: ctx.rng.pick(shop), units: 1 + ctx.rng.int(3) }] });
      const eq = affordableEquipment(v);
      if (eq.length && ctx.rng.next() < 0.2) options.push({ type: 'equip', equipmentId: ctx.rng.pick(eq) });
      if (!options.length) break;
      ctx.exec(ctx.rng.pick(options));
    }
  },
};

export const QuickCashBot: Bot = {
  id: 'quickcash',
  plan(state, teamId, ctx) {
    const v = view(state, teamId, ctx.map);
    takeBestOffers(v, ctx, (p) => (p.contract.reward - p.cost) / Math.max(1, p.rounds));
  },
  execute(state, teamId, ctx) {
    executePlans(view(state, teamId, ctx.map), ctx);
  },
};

export const PlannerBot: Bot = {
  id: 'planner',
  plan(state, teamId, ctx) {
    const v = view(state, teamId, ctx.map);
    takeBestOffers(v, ctx, (p) => (p.contract.reward - p.cost - p.energy * 0.7) * (p.rounds <= 4 ? 1.1 : 1));
  },
  execute(state, teamId, ctx) {
    const v = view(state, teamId, ctx.map);
    executePlans(v, ctx, {
      holdOnLowMarket: true,
      allowEquipment: (vv) => (vv.state.round <= 4 && !hasEquipment(vv.team, 'U01') && availableCoins(vv.team) >= equipmentPrice(vv.state, 'U01') + 12 && vv.state.activeEquipment.includes('U01') ? 'U01' : null),
    });
  },
};

export const ByproductBot: Bot = {
  id: 'byproduct',
  plan(state, teamId, ctx) {
    const v = view(state, teamId, ctx.map);
    // 이미 재고에 있는(또는 진행 중인) 부산물로 채울 수 있는 계약을 높이 평가
    takeBestOffers(v, ctx, (p) => {
      const stockBonus = p.contract.requirements.reduce((a, r) => a + (p.routes.some((x) => x.req === r) ? 0 : r.units * 6), 0);
      return p.contract.reward - p.cost + stockBonus;
    });
  },
  execute(state, teamId, ctx) {
    const v = view(state, teamId, ctx.map);
    executePlans(v, ctx, {
      allowEquipment: (vv) => (vv.state.round <= 5 && !hasEquipment(vv.team, 'U03') && vv.state.activeEquipment.includes('U03') && availableCoins(vv.team) >= 20 ? 'U03' : null),
    });
  },
};

function equipmentRoi(v: BotView): string | null {
  const { state, team } = v;
  const remaining = state.roundsTotal - state.round + 1;
  if (remaining < 6) return null;
  if (team.equipment.filter((e) => !e.leased).length >= 2) return null;
  if (team.equipment.some((e) => e.round === state.round)) return null;
  const coins = availableCoins(team);
  const cands: { id: string; value: number }[] = [];
  const usesExo = state.activeReactions.some((r) => REACTIONS[r]!.heatRecoverable);
  if (!hasEquipment(team, 'U01') && state.activeEquipment.includes('U01')) cands.push({ id: 'U01', value: remaining * 2.5 });
  if (usesExo && !hasEquipment(team, 'U02') && state.activeEquipment.includes('U02')) cands.push({ id: 'U02', value: remaining * 1.2 });
  if (!hasEquipment(team, 'U04') && state.activeEquipment.includes('U04') && state.activeReactions.some((r) => ['R07', 'R09', 'R13', 'R16', 'R18'].includes(r))) cands.push({ id: 'U04', value: remaining * 1.0 });
  if (!hasEquipment(team, 'U03') && state.activeEquipment.includes('U03')) cands.push({ id: 'U03', value: remaining * 0.6 });
  for (const c of cands) {
    const price = equipmentPrice(state, c.id);
    // 잔존가치 50%를 고려한 순비용보다 기대 이득이 커야 한다
    if (c.value > price * 0.5 + 6 && coins >= price + 16) return c.id;
  }
  return null;
}

export const InvestorBot: Bot = {
  id: 'investor',
  plan(state, teamId, ctx) {
    const v = view(state, teamId, ctx.map);
    takeBestOffers(v, ctx, (p) => p.contract.reward - p.cost - p.energy * 0.5);
  },
  execute(state, teamId, ctx) {
    executePlans(view(state, teamId, ctx.map), ctx, { allowEquipment: equipmentRoi });
  },
};

export const BidderBot: Bot = {
  id: 'bidder',
  plan(state, teamId, ctx) {
    const v = view(state, teamId, ctx.map);
    const auction = state.auctions.find((a) => a.round === state.round && !a.resolved);
    if (auction && v.team.contracts.length < state.config.contractLimit) {
      const plan = planForContract(v, auction.contract as ContractInstance);
      const remaining = state.roundsTotal - state.round + 1;
      if (plan.feasible && plan.rounds <= remaining) {
        // 공개 정보: 다른 팀의 보유 계약 수가 가득 차 있으면 경쟁이 낮다
        const rivalsFree = state.teamOrder.filter((t) => t !== teamId && state.teams[t]!.contracts.length < state.config.contractLimit).length;
        const margin = plan.contract.reward - plan.cost;
        const amount = Math.max(0, Math.min(state.config.auctionMaxBid, Math.floor(margin / 4) - (rivalsFree === 0 ? 2 : 0)));
        if (amount > 0) ctx.exec({ type: 'bid', amount });
      }
    }
    takeBestOffers(v, ctx, (p) => p.contract.reward - p.cost);
  },
  execute(state, teamId, ctx) {
    executePlans(view(state, teamId, ctx.map), ctx, { allowEquipment: (vv) => (vv.state.round <= 3 && !hasEquipment(vv.team, 'U01') && availableCoins(vv.team) >= 30 && vv.state.activeEquipment.includes('U01') ? 'U01' : null) });
  },
};

export const BOTS: Record<BotId, Bot> = { random: RandomBot, quickcash: QuickCashBot, planner: PlannerBot, byproduct: ByproductBot, investor: InvestorBot, bidder: BidderBot };

/** 명령 실행 래퍼: 엔진 검증을 통과한 명령만 반영된다 (봇도 특권이 없다). */
export function makeExec(state: GameState, teamId: string, onError?: (e: string) => void): (cmd: TeamCommand) => boolean {
  return (cmd) => {
    const r = applyTeamCommand(state, teamId, cmd);
    if (!r.ok && onError) onError(r.error ?? '?');
    return r.ok;
  };
}
