import type { ContractInstance, GameState, SupportKind, TeamCommand } from '../../shared/types';
import { Rng } from '../../shared/engine/rng';
import { applyTeamCommand, availableCoins } from '../../shared/engine/commands';
import { REACTIONS } from '../../shared/chemistry/reactions';
import { hasEquipment, equipmentPrice } from '../../shared/engine/state';
import { contractPayout } from '../../shared/engine/market';
import { supportPending, replacementValue } from '../../shared/engine/support';
import { lotSellable, quoteBuyback } from '../../shared/engine/buyback';
import { lotUsableFor } from '../../shared/engine/commands';
import { affordableEquipment, deliverable, feasibleProcesses, feasibleReactions, nextProcess, nextProcureItems, nextReaction, planForContract, type BotView, type Plan } from './helpers';
import type { ReachabilityMap } from '../../shared/engine/reachability';

export type BotId = 'random' | 'quickcash' | 'planner' | 'byproduct' | 'investor' | 'bidder' | 'supportfinished' | 'supportbasic' | 'recycler';
export const BOT_IDS: BotId[] = ['random', 'quickcash', 'planner', 'byproduct', 'investor', 'bidder', 'supportfinished', 'supportbasic', 'recycler'];
export const BOT_LABEL: Record<BotId, string> = { random: '무작위 봇', quickcash: '즉시 납품 봇', planner: '다단계 계획 봇', byproduct: '부산물 활용 봇', investor: '설비 투자 봇', bidder: '입찰 기회 봇', supportfinished: '지원 완성형 선호 봇', supportbasic: '기초 재료 선호 봇', recycler: '매입 악용 시도 봇' };

export interface BotContext {
  rng: Rng;
  map: ReachabilityMap;
  /** 명령 실행 (결과 기록용) */
  exec: (cmd: TeamCommand) => boolean;
}

export interface Bot {
  id: BotId;
  /** V3: 라운드 처음 연구지원품 1묶음 반송 (미래 지원품·다른 팀 계획은 보지 않는다) */
  support(state: GameState, teamId: string, ctx: BotContext): void;
  plan(state: GameState, teamId: string, ctx: BotContext): void;
  execute(state: GameState, teamId: string, ctx: BotContext): void;
}

/**
 * 지원품 묶음의 쓸모 점수: 보유·제안 주문의 계획에 필요한 원료는 상점 가격의 1.5배, 주문 조건에 맞는 완성 소재는 주문 단가의 1.5배,
 * 나머지는 재료 가치의 40%만 친다. 가장 쓸모없는 묶음을 반송한다.
 */
export function supportScores(state: GameState, teamId: string, map: ReachabilityMap): number[] {
  const team = state.teams[teamId]!;
  const g = team.support;
  if (!g) return [];
  const v = view(state, teamId, map);
  const need: Record<string, number> = {};
  const plans = [...team.contracts, ...team.offers.slice(0, 2)].map((c) => planForContract(v, c));
  for (const p of plans) for (const s of p.shopping) need[s.materialId] = (need[s.materialId] ?? 0) + s.units;
  const reqs = [...team.contracts, ...team.offers].flatMap((c) => c.requirements.map((r) => ({ r, unit: (state.config.contractRewards[c.templateId] ?? c.reward) / Math.max(1, c.requirements.reduce((a, x) => a + x.units, 0)) })));
  return g.bundles.map((b) => {
    let s = 0;
    const left = { ...need };
    for (const it of b.items) {
      const probe = { id: 'p', kind: 'pure' as const, materialId: it.materialId, units: it.units, grade: 'support' as const, tags: it.tags, solvent: 0, origin: { type: 'support' as const, chain: [] } };
      const req = reqs.find((x) => lotUsableFor(probe, x.r));
      // 완성 소재는 원료값이 아니라 아낀 행동·에너지·라운드만큼 값지다 (주문 단가의 1.5배로 친다)
      if (req) { s += req.unit * it.units * 1.5; continue; }
      const useful = Math.min(it.units, left[it.materialId] ?? 0);
      left[it.materialId] = (left[it.materialId] ?? 0) - useful;
      s += useful * replacementValue(state, it.materialId) * 1.5 + (it.units - useful) * replacementValue(state, it.materialId) * 0.4;
    }
    return s;
  });
}

function returnIndexFor(state: GameState, teamId: string, map: ReachabilityMap, keep?: SupportKind): number {
  const g = state.teams[teamId]!.support!;
  const scores = supportScores(state, teamId, map);
  let idx = -1;
  g.bundles.forEach((b, i) => { if (keep && b.kind === keep) return; if (idx < 0 || scores[i]! < scores[idx]!) idx = i; });
  return Math.max(0, idx);
}

function defaultSupport(state: GameState, teamId: string, ctx: BotContext, keep?: SupportKind): void {
  const team = state.teams[teamId]!;
  if (!supportPending(state, team)) return;
  ctx.exec({ type: 'chooseSupport', grantId: team.support!.grantId, returnIndex: returnIndexFor(state, teamId, ctx.map, keep) });
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
  support(state, teamId, ctx) {
    const team = state.teams[teamId]!;
    if (supportPending(state, team)) ctx.exec({ type: 'chooseSupport', grantId: team.support!.grantId, returnIndex: ctx.rng.int(team.support!.bundles.length) });
  },
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
  support: (s, t, c) => defaultSupport(s, t, c),
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
  support: (s, t, c) => defaultSupport(s, t, c),
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
  support: (s, t, c) => defaultSupport(s, t, c),
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
  support: (s, t, c) => defaultSupport(s, t, c),
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
  support: (s, t, c) => defaultSupport(s, t, c),
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

/** 지원 완성형 선호: 완성 소재 상자는 절대 반송하지 않고, 즉시 납품 정책으로 논다 */
export const SupportFinishedBot: Bot = {
  id: 'supportfinished',
  support: (s, t, c) => defaultSupport(s, t, c, 'finished'),
  plan: (s, t, c) => QuickCashBot.plan(s, t, c),
  execute: (s, t, c) => QuickCashBot.execute(s, t, c),
};

/** 기초 재료 선호: 기초 원료 상자는 절대 반송하지 않고, 다단계 계획 정책으로 논다 */
export const SupportBasicBot: Bot = {
  id: 'supportbasic',
  support: (s, t, c) => defaultSupport(s, t, c, 'basic'),
  plan: (s, t, c) => PlannerBot.plan(s, t, c),
  execute: (s, t, c) => PlannerBot.execute(s, t, c),
};

/**
 * 매입 악용 시도: 즉시 납품 정책에 더해 매 라운드 (1) 가장 싼 원료를 사서 되팔아 보고 (2) 계획에 없는 재고를 한도까지 넘긴다.
 * 매입이 생산·납품보다 유리하면 이 봇이 이긴다 — 그러면 상한·가치·빈도를 낮춘다.
 */
export const RecyclerBot: Bot = {
  id: 'recycler',
  support: (s, t, c) => defaultSupport(s, t, c),
  plan: (s, t, c) => QuickCashBot.plan(s, t, c),
  execute(state, teamId, ctx) {
    const team = state.teams[teamId]!;
    if (team.actionsLeft > 0 && (team.buyback?.lastRound ?? 0) !== state.round && ctx.rng.next() < 0.5) {
      const cheap = [...state.shopMaterials].sort((a, b) => (state.config.prices[a] ?? 9) - (state.config.prices[b] ?? 9))[0];
      if (cheap) ctx.exec({ type: 'procure', items: [{ materialId: cheap, units: state.config.procureMaxPerKindPerRound }] });
    }
    QuickCashBot.execute(state, teamId, ctx);
    sellLeftovers(state, teamId, ctx.map, ctx);
  },
};

/** 계획에 필요 없는 순물질 재고를 한도 안에서 가장 많이 넘긴다 */
export function sellLeftovers(state: GameState, teamId: string, map: ReachabilityMap, ctx: BotContext): void {
  const team = state.teams[teamId]!;
  if ((state.rules ?? 2) < 3 || team.roundReady || (team.buyback?.lastRound ?? 0) === state.round) return;
  const v = view(state, teamId, map);
  const keep: Record<string, number> = {};
  for (const c of team.contracts) {
    const p = planForContract(v, c);
    for (const r of p.routes) for (const i of r.route.inputsPerBatch) for (const alt of i.alternatives) keep[alt] = (keep[alt] ?? 0) + i.units * r.batches;
    for (const req of c.requirements) keep[req.materialId] = (keep[req.materialId] ?? 0) + req.units;
  }
  const items: { lotId: string; units: number }[] = [];
  for (const l of team.lots) {
    if (!lotSellable(l)) continue;
    const spare = l.units - (keep[l.materialId!] ?? 0);
    if (spare > 0) { items.push({ lotId: l.id, units: spare }); keep[l.materialId!] = 0; }
    else keep[l.materialId!] = (keep[l.materialId!] ?? 0) - l.units;
  }
  if (!items.length) return;
  let q = quoteBuyback(state, team, items);
  while (q.ok && q.coins > q.roundLeft && items.length) {
    const last = items[items.length - 1]!;
    if (last.units > 1) last.units -= 1; else items.pop();
    q = quoteBuyback(state, team, items);
  }
  if (q.ok && q.coins > 0 && q.coins <= q.roundLeft) ctx.exec({ type: 'sellSurplus', items, expectCoins: q.coins });
}

export const BOTS: Record<BotId, Bot> = { random: RandomBot, quickcash: QuickCashBot, planner: PlannerBot, byproduct: ByproductBot, investor: InvestorBot, bidder: BidderBot, supportfinished: SupportFinishedBot, supportbasic: SupportBasicBot, recycler: RecyclerBot };

/** 명령 실행 래퍼: 엔진 검증을 통과한 명령만 반영된다 (봇도 특권이 없다). */
export function makeExec(state: GameState, teamId: string, onError?: (e: string) => void): (cmd: TeamCommand) => boolean {
  return (cmd) => {
    const r = applyTeamCommand(state, teamId, cmd);
    if (!r.ok && onError) onError(r.error ?? '?');
    return r.ok;
  };
}
