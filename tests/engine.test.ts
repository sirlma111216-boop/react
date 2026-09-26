import { describe, it, expect } from 'vitest';
import { createGame, TEAM_COLORS, TEAM_EMBLEMS, teamAsset } from '../src/shared/engine/state';
import { startGame, beginExecute, settleRound, beginPlan } from '../src/shared/engine/phases';
import { applyTeamCommand, contractSatisfiable } from '../src/shared/engine/commands';
import { verifyTeamLedger } from '../src/shared/engine/ledger';
import { contractPayout } from '../src/shared/engine/market';
import type { GameState } from '../src/shared/types';
import { runGame } from '../src/sim/runner';

function game(mode: 'classic' | 'extended' | 'industrial' = 'classic', n = 2, rounds = 10): GameState {
  const g = createGame({ seed: 'test-seed', mode, roundsTotal: rounds, turnMode: 'timed', teams: Array.from({ length: n }, (_, i) => ({ id: `T${i + 1}`, name: `팀${i + 1}`, color: TEAM_COLORS[i]!, emblem: TEAM_EMBLEMS[i]!, bundleId: 'gas' })) });
  return g;
}

describe('경기 흐름', () => {
  it('시작 묶음 지급 후 1라운드 계획 단계가 되고 제안이 생성된다', () => {
    const g = game();
    applyTeamCommand(g, 'T1', { type: 'chooseBundle', bundleId: 'carbonate' });
    startGame(g);
    expect(g.round).toBe(1);
    expect(g.phase).toBe('plan');
    const t = g.teams['T1']!;
    expect(t.coins).toBe(g.config.startCoins + 2);
    expect(t.lots.some((l) => l.materialId === 'NaHCO3_s' && l.units === 4)).toBe(true);
    expect(t.offers.length).toBe(g.config.offersPerRound);
    // 첫 제안 중 하나는 3라운드 안에 끝낼 수 있는 짧은 계약
    expect(t.offers.some((o) => o.deadlineRound <= 6)).toBe(true);
    expect(t.energy).toBe(g.config.startEnergy); // 첫 라운드는 중복 지급 없음
  });

  it('기체 공방: 물 합성 → 응축 → 정제수 납품 (3라운드)', () => {
    const g = game('classic', 1);
    startGame(g);
    const t = g.teams['T1']!;
    const water = t.offers.find((o) => o.templateId === 'C01');
    // 제안에 C01 이 없으면 강제로 주입 (테스트 목적)
    if (!water) t.offers.push({ id: 'forced', templateId: 'C01', title: '냉각 장치용 정제수', requirements: [{ materialId: 'H2O_l', units: 4, tags: ['condensed', 'refined'] }], reward: 30, deadlineRound: 6, acquiredRound: 1 });
    expect(applyTeamCommand(g, 'T1', { type: 'takeContract', offerId: (water ?? t.offers[t.offers.length - 1]!).id }).ok).toBe(true);
    // 계획 단계에는 실행 불가
    expect(applyTeamCommand(g, 'T1', { type: 'react', reactionId: 'R01', scale: 2 }).ok).toBe(false);
    beginExecute(g);
    const e0 = t.energy;
    expect(applyTeamCommand(g, 'T1', { type: 'react', reactionId: 'R01', scale: 2 }).ok).toBe(true);
    expect(t.energy).toBe(e0 - 2);
    expect(t.lots.find((l) => l.materialId === 'H2_g')).toBeUndefined();
    expect(t.actionsLeft).toBe(g.config.actionsPerRound - 1);
    settleRound(g);
    expect(t.lots.find((l) => l.materialId === 'H2O_g')?.units).toBe(4);
    beginPlan(g); beginExecute(g);
    const steam = t.lots.find((l) => l.materialId === 'H2O_g')!;
    expect(applyTeamCommand(g, 'T1', { type: 'process', processId: 'P01', lotId: steam.id }).ok).toBe(true);
    // 정리하기는 즉시 완료: 같은 재료를 다시 정리할 수 없다
    expect(applyTeamCommand(g, 'T1', { type: 'process', processId: 'P01', lotId: steam.id }).ok).toBe(false);
    expect(t.lots.find((l) => l.materialId === 'H2O_l' && l.tags.includes('condensed'))?.units).toBe(4);
    settleRound(g);
    const liquid = t.lots.find((l) => l.materialId === 'H2O_l' && l.tags.includes('condensed'))!;
    expect(liquid.units).toBe(4);
    beginPlan(g); beginExecute(g);
    const c = t.contracts[0]!;
    expect(contractSatisfiable(t, c).ok).toBe(true);
    const coins = t.coins;
    const expected = contractPayout(g, c).total;
    expect(applyTeamCommand(g, 'T1', { type: 'deliver', contractId: c.id }).ok).toBe(true);
    expect(t.coins).toBe(coins + expected);
    expect(t.delivered).toBe(1);
    expect(t.firstDeliveryRound).toBe(3);
    expect(verifyTeamLedger(t).ok).toBe(true);
  });

  it('구매한 물질은 그대로 납품할 수 없다 (provenance)', () => {
    const g = game('classic', 1);
    startGame(g);
    const t = g.teams['T1']!;
    t.offers.push({ id: 'c4', templateId: 'C04', title: '충전재', requirements: [{ materialId: 'CaCO3_s', units: 2, tags: ['filtered'] }], reward: 30, deadlineRound: 9, acquiredRound: 1 });
    applyTeamCommand(g, 'T1', { type: 'takeContract', offerId: 'c4' });
    beginExecute(g);
    expect(applyTeamCommand(g, 'T1', { type: 'procure', items: [{ materialId: 'CaCO3_s', units: 2 }] }).ok).toBe(true);
    const r = applyTeamCommand(g, 'T1', { type: 'deliver', contractId: t.contracts[0]!.id });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('배달할 수 없어요');
  });

  it('조달 한도·할당량·코인·행동권을 검증한다', () => {
    const g = game('classic', 1);
    startGame(g); beginExecute(g);
    expect(applyTeamCommand(g, 'T1', { type: 'procure', items: [{ materialId: 'H2_g', units: 5 }] }).ok).toBe(false);
    expect(applyTeamCommand(g, 'T1', { type: 'procure', items: [{ materialId: 'H2_g', units: 2 }, { materialId: 'O2_g', units: 2 }, { materialId: 'Mg_s', units: 2 }, { materialId: 'CaO_s', units: 1 }] }).ok).toBe(false);
    expect(applyTeamCommand(g, 'T1', { type: 'procure', items: [{ materialId: 'Zn_s', units: 1 }] }).ok).toBe(false); // 클래식에 없음
    expect(applyTeamCommand(g, 'T1', { type: 'procure', items: [{ materialId: 'H2_g', units: 4 }] }).ok).toBe(true);
    expect(applyTeamCommand(g, 'T1', { type: 'procure', items: [{ materialId: 'H2_g', units: 1 }] }).ok).toBe(false); // 라운드 할당량
    expect(applyTeamCommand(g, 'T1', { type: 'buyEnergy', bundles: 1 }).ok).toBe(true);
    expect(applyTeamCommand(g, 'T1', { type: 'buyEnergy', bundles: 1 }).ok).toBe(true); // 3번째 행동
    expect(applyTeamCommand(g, 'T1', { type: 'buyEnergy', bundles: 1 }).ok).toBe(false); // 행동 횟수 소진
  });

  it('설비는 즉시 적용되고 진행 중 공정은 소급되지 않는다', () => {
    const g = game('classic', 1);
    startGame(g); beginExecute(g);
    const t = g.teams['T1']!;
    applyTeamCommand(g, 'T1', { type: 'react', reactionId: 'R01', scale: 1 });
    const proc = t.processes[0]!;
    expect(applyTeamCommand(g, 'T1', { type: 'equip', equipmentId: 'U01' }).ok).toBe(true);
    expect(proc.completesRound).toBe(1);
    expect(t.equipment[0]!.paid).toBe(g.config.equipmentPrices['U01']);
    expect(applyTeamCommand(g, 'T1', { type: 'equip', equipmentId: 'U01' }).ok).toBe(false);
    expect(teamAsset(g, t)).toBe(t.coins + Math.floor(g.config.equipmentPrices['U01']! * 0.5));
  });

  it('열회수는 지정 발열 반응에만, 라운드당 상한', () => {
    const g = game('classic', 1);
    startGame(g); beginExecute(g);
    const t = g.teams['T1']!;
    t.equipment.push({ id: 'U02', paid: 10, leased: false, round: 1 });
    t.equipment.push({ id: 'U01', paid: 14, leased: false, round: 1 });
    t.lots.push({ id: 'x', kind: 'pure', materialId: 'H2_g', units: 8, grade: 'purchased', tags: ['purchased'], solvent: 0, origin: { type: 'purchase', chain: [] } });
    t.lots.push({ id: 'y', kind: 'pure', materialId: 'O2_g', units: 8, grade: 'purchased', tags: ['purchased'], solvent: 0, origin: { type: 'purchase', chain: [] } });
    t.elementLedger.inflow['H'] = (t.elementLedger.inflow['H'] ?? 0) + 16; t.elementLedger.inflow['O'] = (t.elementLedger.inflow['O'] ?? 0) + 16;
    t.actionsLeft = 3; t.energy = 6;
    applyTeamCommand(g, 'T1', { type: 'react', reactionId: 'R01', scale: 1 });
    applyTeamCommand(g, 'T1', { type: 'react', reactionId: 'R01', scale: 1 });
    applyTeamCommand(g, 'T1', { type: 'react', reactionId: 'R01', scale: 1 });
    const before = t.energy;
    settleRound(g);
    expect(t.energy).toBe(before + 2); // 3회 완료지만 상한 2
    expect(verifyTeamLedger(t).ok).toBe(true);
  });

  it('입찰: 예약금·슬롯 예약·동률 우선순위·승자만 지불', () => {
    const g = game('classic', 3, 10);
    startGame(g);
    while (g.round < 3) { beginExecute(g); settleRound(g); beginPlan(g); }
    expect(g.auctions.length).toBe(1);
    const a = g.auctions[0]!;
    for (const id of ['T1', 'T2', 'T3']) expect(applyTeamCommand(g, id, { type: 'bid', amount: 4 }).ok).toBe(true);
    expect(applyTeamCommand(g, 'T1', { type: 'bid', amount: 7 }).ok).toBe(false);
    const t1 = g.teams['T1']!;
    // 예약금은 다른 구매에 쓸 수 없다
    beginExecute(g);
    t1.coins = 5;
    expect(applyTeamCommand(g, 'T1', { type: 'procure', items: [{ materialId: 'H2_g', units: 1 }] }).ok).toBe(false);
    t1.coins = 40;
    const coinsBefore = { T1: g.teams['T1']!.coins, T2: g.teams['T2']!.coins, T3: g.teams['T3']!.coins };
    settleRound(g);
    expect(a.resolved).toBe(true);
    expect(a.winnerId).toBe(a.priorityOrder[0]); // 동률 → 시드 우선순위
    for (const id of ['T1', 'T2', 'T3'] as const) {
      expect(g.teams[id]!.coins).toBe(coinsBefore[id] - (a.winnerId === id ? 4 : 0));
      expect(g.teams[id]!.bid).toBe(0);
    }
    expect(g.teams[a.winnerId!]!.contracts.some((c) => c.special)).toBe(true);
  });

  it('같은 물질을 두 계약에 중복 납품할 수 없다', () => {
    const g = game('classic', 1);
    startGame(g);
    const t = g.teams['T1']!;
    t.lots.push({ id: 'w', kind: 'pure', materialId: 'H2O_l', units: 4, grade: 'produced', tags: ['condensed'], solvent: 0, origin: { type: 'process', processId: 'P01', reactionId: 'R01', chain: ['R01', 'P01'] } });
    t.elementLedger.inflow['H'] = (t.elementLedger.inflow['H'] ?? 0) + 8; t.elementLedger.inflow['O'] = (t.elementLedger.inflow['O'] ?? 0) + 4;
    const mk = (id: string) => ({ id, templateId: 'C01', title: '정제수', requirements: [{ materialId: 'H2O_l', units: 4, tags: ['condensed'] }], reward: 30, deadlineRound: 9, acquiredRound: 1 });
    t.contracts.push(mk('a'), mk('b'));
    beginExecute(g);
    expect(applyTeamCommand(g, 'T1', { type: 'deliver', contractId: 'a' }).ok).toBe(true);
    expect(applyTeamCommand(g, 'T1', { type: 'deliver', contractId: 'b' }).ok).toBe(false);
    expect(verifyTeamLedger(t).ok).toBe(true);
  });

  it('마지막 정산 뒤 자동 납품·최종 자산·순위, 종료 후 행동 불가', () => {
    const g = game('classic', 2, 2);
    startGame(g);
    const t = g.teams['T1']!;
    t.lots.push({ id: 'w', kind: 'pure', materialId: 'H2O_l', units: 4, grade: 'produced', tags: ['condensed'], solvent: 0, origin: { type: 'process', processId: 'P01', reactionId: 'R01', chain: ['R01', 'P01'] } });
    t.elementLedger.inflow['H'] = (t.elementLedger.inflow['H'] ?? 0) + 8; t.elementLedger.inflow['O'] = (t.elementLedger.inflow['O'] ?? 0) + 4;
    t.contracts.push({ id: 'a', templateId: 'C01', title: '정제수', requirements: [{ materialId: 'H2O_l', units: 4, tags: ['condensed'] }], reward: 30, deadlineRound: 2, acquiredRound: 1 });
    beginExecute(g); settleRound(g); beginPlan(g); beginExecute(g); settleRound(g);
    expect(g.phase).toBe('finished');
    expect(t.delivered).toBe(1);
    expect(g.results![0]!.teamId).toBe('T1');
    expect(g.results![0]!.rank).toBe(1);
    expect(applyTeamCommand(g, 'T1', { type: 'procure', items: [{ materialId: 'H2_g', units: 1 }] }).ok).toBe(false);
  });
});

describe('헤드리스 경기', () => {
  it('세 모드가 예외 없이 완주하고 원장이 맞는다', () => {
    for (const mode of ['classic', 'extended', 'industrial'] as const) {
      const out = runGame({ seed: `unit-${mode}`, mode, rounds: 10, teams: [{ bot: 'planner', bundleId: 'gas', leaseId: 'U07' }, { bot: 'random', bundleId: 'carbonate', leaseId: 'U06' }, { bot: 'bidder', bundleId: 'material', leaseId: 'U05' }] });
      expect(out.errors, mode).toEqual([]);
      expect(out.ledgerOk).toBe(true);
      expect(out.teams.length).toBe(3);
    }
  });
  it('같은 시드는 같은 결과를 낸다 (재현성)', () => {
    const spec = { seed: 'repro', mode: 'extended' as const, rounds: 6, teams: [{ bot: 'planner' as const, bundleId: 'gas' }, { bot: 'quickcash' as const, bundleId: 'material' }] };
    const a = runGame(spec);
    const b = runGame(spec);
    expect(a.teams.map((t) => t.asset)).toEqual(b.teams.map((t) => t.asset));
  });
});
