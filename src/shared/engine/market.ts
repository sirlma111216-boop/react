import type { ContractInstance, GameState } from '../types';
import { CONTRACTS } from '../chemistry/contracts';
import { subRng } from './rng';

/** 시장 단계 z ∈ {-2,-1,0,1,2}. 계수 = 1 + 0.04·z (92%~108%). */
export const MARKET_STEP = 0.04;
export const MARKET_MIN = -2;
export const MARKET_MAX = 2;
export const PRICING_VERSION = 2;

export const MARKET_CATEGORIES = ['water', 'gas', 'ceramics', 'paper', 'salt', 'metal', 'nitrogen', 'bio'] as const;

export function marketFactor(z: number): number {
  return 1 + MARKET_STEP * Math.max(MARKET_MIN, Math.min(MARKET_MAX, z));
}

/** 0.5 는 올림 (서버·시뮬레이터 공통 반올림 규칙) */
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5);
}

/** 경기 시작: 모든 카테고리 z=0 */
export function initMarket(state: GameState): void {
  state.market = {};
  state.marketHistory = {};
  for (const c of MARKET_CATEGORIES) { state.market[c] = 0; state.marketHistory[c] = [0]; }
}

/**
 * 다음 라운드 시세를 시드·라운드·카테고리로 결정적으로 뽑는다 (−1/0/+1 을 25/50/25%).
 * 새로고침·재접속·명령 재시도로 다시 추첨되지 않는다. 마지막 라운드 정산에서는 호출하지 않는다.
 */
export function drawNextMarket(state: GameState, nextRound: number): void {
  for (const c of MARKET_CATEGORIES) {
    const rng = subRng(state.seed, 'market', nextRound, c);
    const r = rng.next();
    const delta = r < 0.25 ? -1 : r < 0.75 ? 0 : 1;
    const z = Math.max(MARKET_MIN, Math.min(MARKET_MAX, (state.market[c] ?? 0) + delta));
    state.market[c] = z;
    (state.marketHistory[c] ??= []).push(z);
  }
}

export function contractCategory(c: ContractInstance): string {
  return c.category ?? CONTRACTS[c.templateId]?.category ?? 'gas';
}

/** 계약의 현재 라운드 지급액 분해: 기본금, 시장 가감액, 고정 보너스, 합계 */
export function contractPayout(state: { market: Record<string, number> }, c: ContractInstance): { base: number; adjust: number; bonus: number; total: number; z: number; fixed: boolean } {
  const bonus = c.bonus ?? 0;
  if (c.pricingVersion !== PRICING_VERSION) {
    // 구버전 고정가 계약: 약속된 금액 그대로 (reward 에 보너스가 이미 포함됨)
    return { base: c.reward, adjust: 0, bonus: 0, total: c.reward, z: 0, fixed: true };
  }
  const z = state.market[contractCategory(c)] ?? 0;
  const priced = roundHalfUp(c.reward * marketFactor(z));
  return { base: c.reward, adjust: priced - c.reward, bonus, total: priced + bonus, z, fixed: false };
}

/** 계약 수락 전 보여줄 변동 범위 (기본금의 92%~108%) */
export function payoutRange(c: ContractInstance): { min: number; max: number } {
  const bonus = c.bonus ?? 0;
  return { min: roundHalfUp(c.reward * marketFactor(MARKET_MIN)) + bonus, max: roundHalfUp(c.reward * marketFactor(MARKET_MAX)) + bonus };
}
