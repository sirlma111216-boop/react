import type { GameState, TeamState } from './types';
import type { AuctionPublic, GameView } from './protocol';
import { CONTRACTS } from './chemistry/contracts';
import { priceOf } from './engine/state';

/** 팀의 현재 생산 카테고리 (공개 정보) */
export function teamCategory(team: TeamState): string | null {
  const c = team.contracts[0];
  if (c) return CONTRACTS[c.templateId]?.category ?? null;
  return null;
}

export function auctionPublic(state: GameState, teamId: string | null): AuctionPublic | null {
  const a = state.auctions.find((x) => x.round === state.round) ?? null;
  if (!a) return null;
  return { id: a.id, round: a.round, contract: a.contract, myBid: teamId ? a.bids[teamId] ?? 0 : 0, resolved: a.resolved, winnerId: a.winnerId, bidderCount: Object.values(a.bids).filter((b) => b > 0).length };
}

/** 특정 팀(또는 관전자)의 게임 투영. 다른 팀의 비공개 정보는 포함하지 않는다. */
export function projectGame(state: GameState, teamId: string | null): GameView {
  const prices: Record<string, number> = {};
  for (const m of state.shopMaterials) prices[m] = priceOf(state, m);
  const cfg = state.config;
  const myTeam = teamId ? state.teams[teamId] ?? null : null;
  return {
    round: state.round,
    roundsTotal: state.roundsTotal,
    phase: state.phase,
    mode: state.mode,
    presetId: state.presetId,
    activeReactions: state.activeReactions,
    activeEquipment: state.activeEquipment,
    shopMaterials: state.shopMaterials,
    prices,
    rewardAdjust: state.rewardAdjust,
    transportBonusRound: state.transportBonusRound,
    events: state.events.filter((e) => e.announceRound <= state.round),
    auction: auctionPublic(state, teamId),
    log: state.log.slice(-40),
    myTeam: myTeam ? stripTeam(myTeam) : null,
    results: state.results,
    turnMode: state.turnMode,
    market: state.market,
    marketHistory: state.marketHistory,
    roundVersion: state.roundVersion,
    readyCount: state.teamOrder.filter((id) => state.teams[id]?.roundReady).length,
    teamCount: state.teamOrder.length,
    config: {
      contractLimit: cfg.contractLimit, actionsPerRound: cfg.actionsPerRound, energyCap: cfg.energyCap, procureMaxKinds: cfg.procureMaxKinds, procureMaxTotal: cfg.procureMaxTotal,
      procureMaxPerKindPerRound: cfg.procureMaxPerKindPerRound, energyBundleCost: cfg.energyBundleCost, energyBundleAmount: cfg.energyBundleAmount, energyBundleMax: cfg.energyBundleMax, auctionMaxBid: cfg.auctionMaxBid,
      bundles: cfg.bundles,
    },
  };
}

/** 팀 상태에서 내부 원장(검증용)은 제외한다. */
export function stripTeam(t: TeamState): TeamState {
  return { ...t, elementLedger: { inflow: {}, outflow: {} } };
}
