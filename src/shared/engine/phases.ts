import type { Auction, ContractInstance, EventType, FinalTeamResult, GameState, MarketEvent, TeamState } from '../types';
import { CONTRACTS } from '../chemistry/contracts';
import { EQUIPMENT } from '../chemistry/equipment';
import { REACTIONS } from '../chemistry/reactions';
import { subRng } from './rng';
import { addLot, hasEquipment, makeIdGen, pushLog, receiveExternal, salvageValue, teamAsset } from './state';
import { computeReachability, contractMinRounds, contractReachable, type ReachabilityMap } from './reachability';
import { contractSatisfiable, deliverContract } from './commands';

const idGen = makeIdGen('C');
const lotGen = makeIdGen('B');

const EVENT_LABEL: Record<EventType, string> = {
  energy: '에너지 지원: 모든 팀 에너지 +1',
  discount: '원료 할인: 지정 원료 2종 −1코인 (이번 라운드)',
  paperDemand: '제지 수요 증가: 신규 제지 계약 보상 +10%',
  metalDemand: '금속 수요 증가: 신규 금속 계약 보상 +10%',
  gasDemand: '기체 수요 증가: 신규 기체 계약 보상 +10%',
  transport: '운송 지원: 이번 라운드 첫 납품 +2코인',
};

function scheduleEvents(state: GameState): void {
  const rng = subRng(state.seed, 'events');
  const candidates: EventType[] = ['energy', 'discount', 'transport'];
  const has = (ids: string[]) => ids.some((c) => state.activeContracts.includes(c));
  if (has(['C04', 'C07'])) candidates.push('paperDemand');
  if (has(['C09', 'C10'])) candidates.push('metalDemand');
  if (has(['C02', 'C06', 'C08'])) candidates.push('gasDemand');
  const rounds: number[] = [];
  for (let r = 2; r <= state.roundsTotal - 2; r++) rounds.push(r);
  const chosenRounds = rng.shuffle(rounds).slice(0, Math.min(state.config.eventMaxPerGame, rounds.length)).sort((a, b) => a - b);
  const types = rng.shuffle(candidates);
  state.events = chosenRounds.map((announceRound, i) => {
    const type = types[i % types.length]!;
    const ev: MarketEvent = { id: `E${i + 1}`, type, announceRound, applyRound: announceRound + 1, applied: false, label: EVENT_LABEL[type] };
    if (type === 'discount') ev.materials = rng.shuffle(state.shopMaterials.filter((m) => (state.config.prices[m] ?? 0) > 1)).slice(0, 2);
    return ev;
  });
}

const reachCache = new Map<string, ReachabilityMap>();
function reachability(state: GameState): ReachabilityMap {
  const key = `${state.activeReactions.join(',')}|${state.shopMaterials.join(',')}|${state.activeEquipment.join(',')}`;
  let m = reachCache.get(key);
  if (!m) {
    m = computeReachability(state.activeReactions, state.shopMaterials, state.activeEquipment);
    reachCache.set(key, m);
  }
  return m;
}
export const cachedReachability = reachability;

function rewardFor(state: GameState, templateId: string, extra = 0): number {
  const t = CONTRACTS[templateId]!;
  const base = state.config.contractRewards[templateId] ?? t.reward;
  const adj = state.rewardAdjust[t.category] ?? 0;
  return Math.round(base * (1 + adj)) + extra;
}

function makeOffer(state: GameState, templateId: string, round: number, minRounds: number): ContractInstance {
  const t = CONTRACTS[templateId]!;
  return {
    id: idGen(), templateId, title: t.title, requirements: t.requirements.map((r) => ({ ...r })), reward: rewardFor(state, templateId),
    deadlineRound: Math.min(state.roundsTotal, round + minRounds + state.config.deadlineSlack), acquiredRound: round,
  };
}

/** 팀별 계약 제안 생성: 도달 가능·남은 라운드 안에 완료 가능·한도 이내인 템플릿에서 결정적으로 고른다. */
export function generateOffers(state: GameState, team: TeamState, map: ReachabilityMap): ContractInstance[] {
  const remaining = state.roundsTotal - state.round + 1;
  const eligible = state.activeContracts.filter((cid) => {
    const t = CONTRACTS[cid]!;
    const limit = t.byproductOnly ? state.config.byproductTemplateLimit : state.config.sameTemplateLimit;
    if ((team.templateCounts[cid] ?? 0) >= limit) return false;
    if (!contractReachable(map, t)) return false;
    const mr = Math.max(t.minRounds, contractMinRounds(map, t));
    return mr <= remaining;
  });
  const rng = subRng(state.seed, 'offers', team.id, state.round);
  const shuffled = rng.shuffle(eligible);
  const out: ContractInstance[] = [];
  const cats = new Set<string>();
  // 첫 라운드에는 시작 묶음으로 2~3라운드 안에 끝낼 수 있는 짧은 계약을 반드시 하나 넣는다
  if (state.round === 1) {
    const quick = shuffled.filter((cid) => CONTRACTS[cid]!.minRounds <= 3 && !CONTRACTS[cid]!.byproductOnly);
    const bundlePref = quick.find((cid) => bundleMatches(team.bundleId, cid)) ?? quick[0];
    if (bundlePref) { out.push(makeOffer(state, bundlePref, state.round, CONTRACTS[bundlePref]!.minRounds)); cats.add(CONTRACTS[bundlePref]!.category); }
  }
  for (const cid of shuffled) {
    if (out.length >= state.config.offersPerRound) break;
    if (out.some((o) => o.templateId === cid)) continue;
    const t = CONTRACTS[cid]!;
    if (cats.has(t.category) && shuffled.length > state.config.offersPerRound) continue;
    out.push(makeOffer(state, cid, state.round, Math.max(t.minRounds, contractMinRounds(map, t))));
    cats.add(t.category);
  }
  for (const cid of shuffled) {
    if (out.length >= state.config.offersPerRound) break;
    if (out.some((o) => o.templateId === cid)) continue;
    out.push(makeOffer(state, cid, state.round, CONTRACTS[cid]!.minRounds));
  }
  return out;
}

function bundleMatches(bundleId: string | null, cid: string): boolean {
  const map: Record<string, string[]> = { gas: ['C01', 'C02'], carbonate: ['C04', 'C06', 'C07'], material: ['C03'] };
  return (map[bundleId ?? ''] ?? []).includes(cid);
}

function makeAuction(state: GameState, round: number, index: number, map: ReachabilityMap): Auction | null {
  const rng = subRng(state.seed, 'auction', round);
  const remaining = state.roundsTotal - round + 1;
  const eligible = state.activeContracts.filter((cid) => {
    const t = CONTRACTS[cid]!;
    return !t.byproductOnly && contractReachable(map, t) && Math.max(t.minRounds, contractMinRounds(map, t)) <= remaining;
  });
  if (!eligible.length) return null;
  const sorted = eligible.sort((a, b) => (state.config.contractRewards[b] ?? 0) - (state.config.contractRewards[a] ?? 0));
  const pool = sorted.slice(0, Math.min(3, sorted.length));
  const cid = rng.pick(pool);
  const t = CONTRACTS[cid]!;
  const contract: ContractInstance = {
    id: idGen(), templateId: cid, title: `[도시 특별] ${t.title}`, requirements: t.requirements.map((r) => ({ ...r })),
    reward: rewardFor(state, cid, state.config.auctionBonus), deadlineRound: state.roundsTotal, acquiredRound: round, special: true,
  };
  const base = subRng(state.seed, 'priority').shuffle(state.teamOrder);
  const rot = index % Math.max(1, base.length);
  const priorityOrder = [...base.slice(rot), ...base.slice(0, rot)];
  return { id: `A${round}`, round, contract, bids: {}, resolved: false, winnerId: null, priorityOrder };
}

/** 경기 시작: 시작 묶음·임대 설비 지급, 이벤트 예정, 1라운드 계획 단계로. */
export function startGame(state: GameState): void {
  if (state.phase !== 'setup') throw new Error('이미 시작된 경기입니다.');
  for (const team of Object.values(state.teams)) {
    const bundle = state.config.bundles.find((b) => b.id === team.bundleId) ?? state.config.bundles[0]!;
    team.bundleId = bundle.id;
    for (const it of bundle.items) receiveExternal(team, it.materialId, it.units, 'bundle', lotGen);
    team.coins += bundle.extraCoins;
    if (state.mode === 'industrial') {
      const leasable = state.activeEquipment.filter((e) => EQUIPMENT[e]?.leasable);
      const lease = team.leaseId && leasable.includes(team.leaseId) ? team.leaseId : leasable[0] ?? null;
      team.leaseId = lease;
      if (lease) team.equipment.push({ id: lease, paid: 0, leased: true, round: 0 });
    }
  }
  scheduleEvents(state);
  state.round = 0;
  state.phase = 'settle';
  beginPlan(state);
}

/** 계획 단계 시작 (라운드 +1). 에너지 공급, 이벤트 적용·예고, 제안·입찰 생성. */
export function beginPlan(state: GameState): void {
  if (state.phase === 'finished') return;
  state.round += 1;
  state.phase = 'plan';
  state.priceAdjust = {};
  state.rewardAdjust = {};
  state.transportBonusRound = null;
  const map = reachability(state);
  // 예고된 이벤트 적용
  for (const ev of state.events) {
    if (ev.applyRound === state.round && !ev.applied) {
      ev.applied = true;
      if (ev.type === 'energy') for (const t of Object.values(state.teams)) t.energy = Math.min(state.config.energyCap, t.energy + 1);
      if (ev.type === 'discount') for (const m of ev.materials ?? []) state.priceAdjust[m] = -1;
      if (ev.type === 'paperDemand') state.rewardAdjust['paper'] = 0.1;
      if (ev.type === 'metalDemand') state.rewardAdjust['metal'] = 0.1;
      if (ev.type === 'gasDemand') state.rewardAdjust['gas'] = 0.1;
      if (ev.type === 'transport') state.transportBonusRound = state.round;
      pushLog(state, 'event', `이벤트 적용: ${ev.label}`);
    }
    if (ev.announceRound === state.round) pushLog(state, 'event', `다음 라운드 예고: ${ev.label}`);
  }
  for (const team of Object.values(state.teams)) {
    if (state.round > 1) team.energy = Math.min(state.config.energyCap, team.energy + state.config.energyPerRound);
    team.actionsLeft = state.config.actionsPerRound;
    team.purchasesThisRound = {};
    team.heatRecoveredThisRound = 0;
    team.bid = 0;
    team.offers = generateOffers(state, team, map);
  }
  if (state.config.auctionRounds.includes(state.round)) {
    const a = makeAuction(state, state.round, state.config.auctionRounds.indexOf(state.round), map);
    if (a) { state.auctions.push(a); pushLog(state, 'auction', `도시 특별 계약 공개: ${a.contract.title} (보상 ${a.contract.reward})`); }
  }
  state.version += 1;
}

export function beginExecute(state: GameState): void {
  if (state.phase !== 'plan') throw new Error('계획 단계가 아닙니다.');
  state.phase = 'execute';
  state.version += 1;
}

/** 실행 종료 → 정산. 서버에서 한 번만 호출한다. */
export function settleRound(state: GameState): void {
  if (state.phase !== 'execute') throw new Error('실행 단계가 아닙니다.');
  state.phase = 'settle';
  // 입찰 개봉
  const auction = state.auctions.find((a) => a.round === state.round && !a.resolved);
  if (auction) {
    auction.resolved = true;
    let best = 0;
    let winner: string | null = null;
    for (const tid of auction.priorityOrder) {
      const b = auction.bids[tid] ?? 0;
      const team = state.teams[tid];
      if (!team || b <= 0 || team.contracts.length >= state.config.contractLimit || b > team.coins) continue;
      if (b > best) { best = b; winner = tid; }
    }
    if (winner) {
      const team = state.teams[winner]!;
      team.coins -= best;
      team.contracts.push({ ...auction.contract, bidPaid: best, acquiredRound: state.round });
      team.templateCounts[auction.contract.templateId] = (team.templateCounts[auction.contract.templateId] ?? 0) + 1;
      auction.winnerId = winner;
      pushLog(state, 'auction', `${team.name} 낙찰 (${best}코인): ${auction.contract.title}`);
    } else pushLog(state, 'auction', `유찰: ${auction.contract.title}`);
    for (const t of Object.values(state.teams)) t.bid = 0;
  }
  for (const team of Object.values(state.teams)) {
    // 공정 완료
    const done = team.processes.filter((p) => p.completesRound <= state.round);
    for (const p of done) {
      for (const lot of p.outputs) addLot(team, lot);
      if (p.solventReleased) team.solventLedger.recovered += p.solventReleased;
      if (p.kind === 'reaction') {
        team.producedCount += 1;
        if (p.heatRecoverable && hasEquipment(team, 'U02') && team.heatRecoveredThisRound < state.config.heatRecoveryPerRound) {
          team.heatRecoveredThisRound += 1;
          team.energy = Math.min(state.config.energyCap, team.energy + 1);
          if (!team.badges.includes('열회수 달인') && team.heatRecoveredThisRound >= 2) team.badges.push('열회수 달인');
        }
        const r = REACTIONS[p.defId]!;
        pushLog(state, 'done', `${team.name}: ${r.name} 완료`, team.id);
      } else {
        team.processedCount += 1;
        if (p.outputs.some((o) => o.grade === 'recovered') && !team.badges.includes('우수 재활용')) team.badges.push('우수 재활용');
      }
    }
    team.processes = team.processes.filter((p) => p.completesRound > state.round);
    // 기한 만료 계약 제거 (벌금 없음)
    const expired = team.contracts.filter((c) => !c.special && c.deadlineRound < state.round + 1 && state.round < state.roundsTotal);
    for (const c of expired) pushLog(state, 'contract', `${team.name}: ${c.title} 기한 만료`, team.id);
    team.contracts = team.contracts.filter((c) => !expired.includes(c));
    if (team.actionsLeft >= state.config.actionsPerRound) team.stalledRounds += 1;
    team.assetHistory.push(teamAsset(state, team));
  }
  if (state.round >= state.roundsTotal) finishGame(state);
  state.version += 1;
}

export function finishGame(state: GameState): void {
  // 마지막 정산 뒤 자동 납품 (추가 구매·반응·계약 불가)
  for (const team of Object.values(state.teams)) {
    const sorted = [...team.contracts].sort((a, b) => b.reward - a.reward);
    for (const c of sorted) if (contractSatisfiable(team, c).ok) deliverContract(state, team, c);
    if (team.delivered >= 3 && !team.badges.includes('깔끔한 인계')) team.badges.push('깔끔한 인계');
    team.assetHistory[team.assetHistory.length - 1] = teamAsset(state, team);
  }
  const results: FinalTeamResult[] = Object.values(state.teams).map((t) => {
    const top = Object.entries(t.reactionUse).sort((a, b) => b[1] - a[1])[0];
    return { teamId: t.id, name: t.name, coins: t.coins, salvage: salvageValue(state, t), asset: teamAsset(state, t), delivered: t.delivered, rank: 0, badges: t.badges, topReaction: top ? top[0] : null, revenue: t.revenue };
  });
  results.sort((a, b) => b.asset - a.asset || b.delivered - a.delivered);
  let rank = 0;
  results.forEach((r, i) => {
    const prev = results[i - 1];
    rank = prev && prev.asset === r.asset && prev.delivered === r.delivered ? prev.rank : i + 1;
    r.rank = rank;
  });
  state.results = results;
  state.phase = 'finished';
  pushLog(state, 'finish', '경기 종료');
}

/** 다음 단계로 전이 (서버 알람·시뮬레이터 공용). */
export function advancePhase(state: GameState): void {
  if (state.phase === 'plan') beginExecute(state);
  else if (state.phase === 'execute') settleRound(state);
  else if (state.phase === 'settle') beginPlan(state);
}
