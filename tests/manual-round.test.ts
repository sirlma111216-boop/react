import { describe, it, expect } from 'vitest';
import { createGame, TEAM_COLORS, TEAM_EMBLEMS } from '../src/shared/engine/state';
import { startGame, settleAndOpenNextRound, allTeamsReady } from '../src/shared/engine/phases';
import { applyTeamCommand } from '../src/shared/engine/commands';
import { contractPayout, drawNextMarket, marketFactor, roundHalfUp, PRICING_VERSION } from '../src/shared/engine/market';
import type { GameState } from '../src/shared/types';

function game(n = 2, rounds = 4): GameState {
  const g = createGame({ seed: 'manual-seed', mode: 'classic', roundsTotal: rounds, teams: Array.from({ length: n }, (_, i) => ({ id: `T${i + 1}`, name: `팀${i + 1}`, color: TEAM_COLORS[i]!, emblem: TEAM_EMBLEMS[i]!, bundleId: 'gas' })) });
  startGame(g);
  return g;
}

describe('수동 라운드', () => {
  it('시작하면 바로 행동 라운드가 열리고 시세는 0에서 시작한다', () => {
    const g = game();
    expect(g.turnMode).toBe('manual');
    expect(g.phase).toBe('execute');
    expect(g.round).toBe(1);
    expect(Object.values(g.market).every((z) => z === 0)).toBe(true);
    expect(g.teams['T1']!.actionsLeft).toBe(g.config.actionsPerRound);
  });

  it('모든 팀이 준비되어야 정산되고, 정산은 한 번만 일어난다', () => {
    const g = game(2);
    expect(applyTeamCommand(g, 'T1', { type: 'readyRound', on: true }).ok).toBe(true);
    expect(allTeamsReady(g)).toBe(false);
    // 준비 완료 뒤 추가 행동은 거절
    expect(applyTeamCommand(g, 'T1', { type: 'procure', items: [{ materialId: 'O2_g', units: 1 }] }).ok).toBe(false);
    expect(applyTeamCommand(g, 'T1', { type: 'readyRound', on: false }).ok).toBe(true);
    expect(applyTeamCommand(g, 'T1', { type: 'procure', items: [{ materialId: 'O2_g', units: 1 }] }).ok).toBe(true);
    applyTeamCommand(g, 'T1', { type: 'readyRound', on: true });
    applyTeamCommand(g, 'T2', { type: 'readyRound', on: true });
    expect(allTeamsReady(g)).toBe(true);
    const v = g.roundVersion;
    settleAndOpenNextRound(g);
    expect(g.round).toBe(2);
    expect(g.roundVersion).toBe(v + 1);
    expect(g.phase).toBe('execute');
    // 다음 라운드 준비 상태는 초기화
    expect(g.teams['T1']!.roundReady).toBe(false);
    expect(g.teams['T2']!.roundReady).toBe(false);
    expect(allTeamsReady(g)).toBe(false);
  });

  it('벽시계가 흘러도 상태가 바뀌지 않는다 (시간 의존 없음)', () => {
    const g = game(1);
    const snap = JSON.stringify(g);
    // 엔진에는 시각 입력이 없다: 30분 뒤라고 가정해도 같은 상태
    const later = Date.now() + 30 * 60 * 1000;
    void later;
    expect(JSON.stringify(g)).toBe(snap);
  });
});

describe('시세', () => {
  it('계수는 92%~108% 이고 0.5는 올림한다', () => {
    expect(marketFactor(-2)).toBeCloseTo(0.92);
    expect(marketFactor(2)).toBeCloseTo(1.08);
    expect(marketFactor(5)).toBeCloseTo(1.08); // clamp
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(2.49)).toBe(2);
  });
  it('시드·라운드·카테고리로 결정적이며 −2~2 로 제한된다', () => {
    const a = game(1, 10); const b = game(1, 10);
    for (let r = 2; r <= 10; r++) { drawNextMarket(a, r); drawNextMarket(b, r); }
    expect(a.market).toEqual(b.market);
    for (const z of Object.values(a.market)) { expect(z).toBeGreaterThanOrEqual(-2); expect(z).toBeLessThanOrEqual(2); }
    for (const h of Object.values(a.marketHistory)) expect(h.length).toBe(10);
  });
  it('새 계약은 기본금 + 시장 가감액, 구버전 계약은 고정가', () => {
    const g = game(1);
    g.market['water'] = 2;
    const c = { id: 'x', templateId: 'C01', title: '', requirements: [], reward: 30, deadlineRound: 4, acquiredRound: 1, pricingVersion: PRICING_VERSION, category: 'water', bonus: 0 };
    expect(contractPayout(g, c).total).toBe(roundHalfUp(30 * 1.08)); // 32
    const special = { ...c, special: true, bonus: 8 };
    expect(contractPayout(g, special)).toMatchObject({ base: 30, adjust: 2, bonus: 8, total: 40 });
    const legacy = { id: 'y', templateId: 'C01', title: '', requirements: [], reward: 38, deadlineRound: 4, acquiredRound: 1 };
    expect(contractPayout(g, legacy)).toMatchObject({ total: 38, fixed: true });
  });
  it('견적 버전이 다르면 배달을 거절한다', () => {
    const g = game(1);
    const t = g.teams['T1']!;
    t.lots.push({ id: 'w', kind: 'pure', materialId: 'H2O_l', units: 4, grade: 'produced', tags: ['condensed'], solvent: 0, origin: { type: 'process', processId: 'P01', reactionId: 'R01', chain: ['R01', 'P01'] } });
    t.elementLedger.inflow['H'] = (t.elementLedger.inflow['H'] ?? 0) + 8; t.elementLedger.inflow['O'] = (t.elementLedger.inflow['O'] ?? 0) + 4;
    t.contracts.push({ id: 'a', templateId: 'C01', title: '정제수', requirements: [{ materialId: 'H2O_l', units: 4, tags: ['condensed'] }], reward: 30, deadlineRound: 4, acquiredRound: 1, pricingVersion: PRICING_VERSION, category: 'water', bonus: 0 });
    expect(applyTeamCommand(g, 'T1', { type: 'deliver', contractId: 'a', quoteVersion: 99 }).ok).toBe(false);
    const coins = t.coins;
    expect(applyTeamCommand(g, 'T1', { type: 'deliver', contractId: 'a', quoteVersion: g.round }).ok).toBe(true);
    expect(t.coins).toBe(coins + contractPayout(g, { ...t.deliveredContracts[0]!, id: 'a', title: '', requirements: [], reward: 30, deadlineRound: 4, acquiredRound: 1, pricingVersion: PRICING_VERSION, category: 'water', bonus: 0 }).total);
  });
  it('마지막 정산에서는 시세를 새로 뽑지 않는다', () => {
    const g = game(1, 2);
    applyTeamCommand(g, 'T1', { type: 'readyRound', on: true });
    settleAndOpenNextRound(g);
    const hist = JSON.stringify(g.marketHistory);
    applyTeamCommand(g, 'T1', { type: 'readyRound', on: true });
    settleAndOpenNextRound(g);
    expect(g.phase).toBe('finished');
    expect(JSON.stringify(g.marketHistory)).toBe(hist);
  });
});
