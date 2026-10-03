import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createGame, TEAM_COLORS, TEAM_EMBLEMS, teamAsset, receiveExternal, makeIdGen } from '../src/shared/engine/state';
import { startGame, settleAndOpenNextRound, settleRound, cachedReachability } from '../src/shared/engine/phases';
import { applyTeamCommand, contractSatisfiable } from '../src/shared/engine/commands';
import { verifyTeamLedger } from '../src/shared/engine/ledger';
import { verifyValueLedger, heldBasis, MC } from '../src/shared/engine/value';
import { chooseSupport, forfeitSupport, generateSupport, pairHasPath, supportPools, supportPending, SUPPORT_KINDS } from '../src/shared/engine/support';
import { buybackShortfall, gameCapOf, quoteBuyback } from '../src/shared/engine/buyback';
import { cardRelation, missionProgress } from '../src/shared/engine/mission';
import { projectGame } from '../src/shared/projection';
import { SHOP_BY_MODE } from '../src/shared/config/economy';
import { REACTIONS } from '../src/shared/chemistry/reactions';
import { MODES } from '../src/shared/chemistry/modes';
import { MATERIALS } from '../src/shared/chemistry/materials';
import { ART_ASSETS, ART_IDS, MATERIAL_ART, mixtureArtId } from '../src/shared/assets/objectArt';
import type { ContractInstance, GameState, ModeId, TeamState } from '../src/shared/types';

const lotGen = makeIdGen('X');

function v3(mode: ModeId = 'classic', n = 2, rounds = 10, seed = 'v3-seed', presetId?: string): GameState {
  const g = createGame({ seed, mode, presetId, roundsTotal: rounds, teams: Array.from({ length: n }, (_, i) => ({ id: `T${i + 1}`, name: `팀${i + 1}`, color: TEAM_COLORS[i]!, emblem: TEAM_EMBLEMS[i]! })) });
  startGame(g);
  return g;
}
const pick = (g: GameState, teamId: string, returnIndex = 0) => applyTeamCommand(g, teamId, { type: 'chooseSupport', grantId: g.teams[teamId]!.support!.grantId, returnIndex });
const pickAll = (g: GameState, idx = 0) => { for (const id of g.teamOrder) if (supportPending(g, g.teams[id]!)) expect(pick(g, id, idx).ok).toBe(true); };
const stock = (t: TeamState, m: string) => t.lots.filter((l) => l.kind === 'pure' && l.materialId === m).reduce((a, l) => a + l.units, 0);
const ledgersOk = (t: TeamState) => { expect(verifyTeamLedger(t).ok).toBe(true); expect(verifyValueLedger(t).ok, verifyValueLedger(t).detail).toBe(true); };

describe('V3 시작과 연구지원품', () => {
  it('새 경기는 시작 코인 24, 고정 시작 묶음 없이 1라운드 지원품 3묶음으로 시작한다', () => {
    const g = v3();
    const t = g.teams['T1']!;
    expect(g.rules).toBe(3);
    expect(t.coins).toBe(24);
    expect(t.lots.length).toBe(0);
    expect(t.support?.status).toBe('pending');
    expect(t.support!.bundles.map((b) => b.kind)).toEqual(['finished', 'process', 'basic']);
    const b = t.support!.bundles;
    expect(b[0]!.items.reduce((a, i) => a + i.units, 0)).toBe(1);
    const pu = b[1]!.items.reduce((a, i) => a + i.units, 0);
    const [plo, phi] = g.config.support!.processUnits;
    expect(pu).toBeGreaterThanOrEqual(plo); expect(pu).toBeLessThanOrEqual(phi);
    const bu = b[2]!.items.reduce((a, i) => a + i.units, 0);
    expect(bu).toBeGreaterThanOrEqual(g.config.support!.basicUnits[0]); expect(bu).toBeLessThanOrEqual(g.config.support!.basicUnits[1]);
    expect(g.buybackGameCap).toBe(20);
  });

  it('구버전(rules 2) 경기는 지원품·매입 없이 고정 시작 묶음을 그대로 쓴다', () => {
    const g = createGame({ seed: 'old', mode: 'classic', rules: 2, teams: [{ id: 'T1', name: 'a', color: '#000', emblem: 'circle', bundleId: 'gas' }] });
    startGame(g);
    const t = g.teams['T1']!;
    expect(t.support ?? null).toBeNull();
    expect(stock(t, 'H2_g')).toBe(4);
    expect(applyTeamCommand(g, 'T1', { type: 'sellSurplus', items: [{ lotId: t.lots[0]!.id, units: 1 }] }).ok).toBe(false);
  });

  it('지원품을 고르기 전에는 경제 행동·입찰·준비 완료가 잠기고, 의뢰 받기는 가능하다', () => {
    const g = v3();
    const t = g.teams['T1']!;
    expect(applyTeamCommand(g, 'T1', { type: 'procure', items: [{ materialId: 'O2_g', units: 1 }] }).ok).toBe(false);
    expect(applyTeamCommand(g, 'T1', { type: 'readyRound', on: true }).ok).toBe(false);
    expect(applyTeamCommand(g, 'T1', { type: 'takeContract', offerId: t.offers[0]!.id }).ok).toBe(true);
    expect(pick(g, 'T1').ok).toBe(true);
    expect(applyTeamCommand(g, 'T1', { type: 'procure', items: [{ materialId: 'O2_g', units: 1 }] }).ok).toBe(true);
  });

  it('2묶음만 입고, 반송 묶음은 재고에 들어오지 않고, 입고는 정확히 1회', () => {
    const g = v3();
    const t = g.teams['T1']!;
    const bundles = t.support!.bundles;
    const expected: Record<string, number> = {};
    bundles.forEach((b, i) => { if (i !== 1) for (const it of b.items) expected[it.materialId] = (expected[it.materialId] ?? 0) + it.units; });
    expect(pick(g, 'T1', 1).ok).toBe(true);
    const got: Record<string, number> = {};
    for (const l of t.lots) got[l.materialId!] = (got[l.materialId!] ?? 0) + l.units;
    expect(got).toEqual(expected);
    expect(t.lots.every((l) => l.grade === 'support' && l.origin.type === 'support')).toBe(true);
    expect(pick(g, 'T1', 0).ok).toBe(false); // 두 번째 확정 불가
    expect(t.supportHistory!.length).toBe(1);
    expect(t.supportHistory![0]!.returnedKind).toBe(bundles[1]!.kind);
    ledgersOk(t);
  });

  it('grantId 가 다르면 거절, 반송 위치가 범위를 벗어나면 거절', () => {
    const g = v3();
    expect(applyTeamCommand(g, 'T1', { type: 'chooseSupport', grantId: 'S9-T1', returnIndex: 0 }).ok).toBe(false);
    expect(applyTeamCommand(g, 'T1', { type: 'chooseSupport', grantId: g.teams['T1']!.support!.grantId, returnIndex: 3 }).ok).toBe(false);
  });

  it('재접속·재생성해도 내용이 바뀌지 않는다 (시드·라운드·팀 결정적) — 팀원은 같은 묶음을 본다', () => {
    const g = v3();
    const t = g.teams['T1']!;
    const again = generateSupport(g, t, cachedReachability(g), t.support!.budget);
    expect(again.bundles).toEqual(t.support!.bundles);
    const a = projectGame(g, 'T1').myTeam!.support;
    const b = projectGame(g, 'T1').myTeam!.support;
    expect(a).toEqual(b);
    // 다른 팀의 지원품은 보이지 않는다
    expect(JSON.stringify(projectGame(g, 'T2'))).not.toContain(t.support!.grantId);
  });

  it('반송품·미확정 지원품은 매각할 수 없다', () => {
    const g = v3();
    const t = g.teams['T1']!;
    expect(applyTeamCommand(g, 'T1', { type: 'sellSurplus', items: [{ lotId: 'nope', units: 1 }] }).ok).toBe(false);
    pick(g, 'T1', 2);
    // 반송한 기초 원료 상자의 재료 중 다른 묶음에 없는 것은 창고에 없다
    const returned = t.support!.bundles[2]!.items.map((i) => i.materialId).filter((m) => !t.support!.bundles.slice(0, 2).some((b) => b.items.some((i) => i.materialId === m)));
    for (const m of returned) expect(stock(t, m)).toBe(0);
  });

  it('선택 전에 라운드가 마무리되면(교사 건너뛰기 등) 수령 포기로 기록되고 나중에 고를 수 없다', () => {
    const g = v3('classic', 2);
    const t2 = g.teams['T2']!;
    pick(g, 'T1');
    const grant = t2.support!.grantId;
    settleRound(g); // 경합: 선택 중 라운드가 넘어감
    expect(t2.supportHistory!.at(-1)!.status).toBe('forfeited');
    expect(t2.lots.length).toBe(0);
    expect(applyTeamCommand(g, 'T2', { type: 'chooseSupport', grantId: grant, returnIndex: 0 }).ok).toBe(false);
  });

  it('교사 대리 선택은 기록되고, 강제 진행은 수령 포기로 남는다', () => {
    const g = v3('classic', 2);
    const t1 = g.teams['T1']!;
    expect(chooseSupport(g, t1, t1.support!.grantId, 0, 'teacher').ok).toBe(true);
    expect(t1.support!.resolvedBy).toBe('teacher');
    expect(t1.supportHistory![0]!.resolvedBy).toBe('teacher');
    const t2 = g.teams['T2']!;
    expect(forfeitSupport(g, t2, '교사 진행')).toBe(true);
    expect(t2.support!.status).toBe('forfeited');
    expect(forfeitSupport(g, t2, '다시')).toBe(false);
  });

  it('모든 모드·프리셋·시드에서 1라운드 어떤 2묶음을 골라도 계약으로 이어지는 합법 생산 경로가 있다', () => {
    let checked = 0;
    for (const mode of ['classic', 'extended', 'industrial'] as ModeId[]) for (const preset of MODES[mode].presets) for (let s = 0; s < 12; s++) {
      const g = v3(mode, 3, 10, `r1-${mode}-${s}`, preset.id);
      const map = cachedReachability(g);
      for (const t of Object.values(g.teams)) {
        const pools = supportPools(g, t, map, g.roundsTotal);
        const b = t.support!.bundles;
        for (const [x, y] of [[0, 1], [0, 2], [1, 2]] as const) {
          expect(pairHasPath(g, t, [...b[x]!.items, ...b[y]!.items], pools, true), `${mode}/${preset.id}/${s}/${t.id} ${x}${y}`).toBe(true);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it('마지막 라운드에도 빈 상자 없이 도착하고, 모드에서 쓰지 않는 물질은 주지 않는다', () => {
    for (const mode of ['classic', 'extended', 'industrial'] as ModeId[]) {
      const g = v3(mode, 2, 4, `last-${mode}`);
      for (let r = 1; r <= 4; r++) {
        for (const t of Object.values(g.teams)) {
          expect(t.support!.round).toBe(g.round);
          for (const b of t.support!.bundles) {
            expect(b.items.length, `${mode} R${r} ${b.kind}`).toBeGreaterThan(0);
            for (const it of b.items) {
              const inShop = SHOP_BY_MODE[mode]!.includes(it.materialId);
              // 활성 반응·가공으로 만들 수 있는 물질 (예: 소금 결정은 침전 → 결정 만들기)
              const producedHere = cachedReachability(g).producible.has(it.materialId) && g.activeReactions.some((rid) => REACTIONS[rid]!.reactants.some((x) => x.accepts.includes(it.materialId)) || REACTIONS[rid]!.outputs.length > 0);
              expect(inShop || producedHere, `${mode} ${it.materialId}`).toBe(true);
            }
          }
        }
        if (r < 4) { pickAll(g); for (const id of g.teamOrder) applyTeamCommand(g, id, { type: 'readyRound', on: true }); settleAndOpenNextRound(g); }
      }
    }
  });

  it('같은 라운드 같은 종류 묶음은 공통 예산 근처의 가치다 (비슷한 가치, 다른 내용)', () => {
    const g = v3('extended', 6, 10, 'fair');
    const tol = g.config.support!.tolerance;
    for (const k of SUPPORT_KINDS) {
      const budget = g.teams['T1']!.support!.budget[k];
      const within = Object.values(g.teams).filter((t) => Math.abs(t.support!.bundles.find((b) => b.kind === k)!.value - budget) <= budget * tol + 0.05).length;
      expect(within, k).toBeGreaterThanOrEqual(5);
    }
  });

  it('지원 완성 소재는 allowSupport 조건에만 보탤 수 있다 (무작정 구매 물질 납품 금지 유지)', () => {
    const g = v3();
    const t = g.teams['T1']!;
    pick(g, 'T1');
    receiveExternal(t, 'MgO_s', 2, 'support', lotGen, { tags: ['reaction'], basisMc: 7600 });
    const ok: ContractInstance = { id: 'a', templateId: 'C03', title: '세라믹', requirements: [{ materialId: 'MgO_s', units: 2, tags: ['reaction'], allowSupport: true }], reward: 26, deadlineRound: 9, acquiredRound: 1 };
    const no: ContractInstance = { ...ok, id: 'b', requirements: [{ materialId: 'MgO_s', units: 2, tags: ['reaction'] }] };
    expect(contractSatisfiable(t, ok).ok).toBe(true);
    expect(contractSatisfiable(t, no).ok).toBe(false);
    t.contracts.push(ok);
    expect(applyTeamCommand(g, 'T1', { type: 'deliver', contractId: 'a' }).ok).toBe(true);
    expect(t.deliveredSupportUnits).toBe(2);
    ledgersOk(t);
  });
});

describe('V3 잉여 재고 매입', () => {
  function ready(): { g: GameState; t: TeamState } {
    const g = v3('classic', 2);
    pickAll(g);
    return { g, t: g.teams['T1']! };
  }

  it('구입가보다 낮게만 회수된다 (저가 재판매)', () => {
    const { g, t } = ready();
    const before = t.coins;
    applyTeamCommand(g, 'T1', { type: 'procure', items: [{ materialId: 'Mg_s', units: 4 }] });
    const lot = t.lots.find((l) => l.grade === 'purchased' && l.materialId === 'Mg_s')!;
    const q = quoteBuyback(g, t, [{ lotId: lot.id, units: 4 }]);
    expect(q.coins).toBe(3); // 4×3×0.3 = 3.6 → 3
    expect(applyTeamCommand(g, 'T1', { type: 'sellSurplus', items: [{ lotId: lot.id, units: 4 }], expectCoins: 3 }).ok).toBe(true);
    expect(t.coins).toBe(before - 12 + 3);
    ledgersOk(t);
  });

  it('할인 구매 후 매입: 실제 지불액이 원가 상한이 된다', () => {
    const { g, t } = ready();
    g.priceAdjust['Mg_s'] = -1;
    applyTeamCommand(g, 'T1', { type: 'procure', items: [{ materialId: 'Mg_s', units: 4 }] });
    const lot = t.lots.find((l) => l.grade === 'purchased' && l.materialId === 'Mg_s')!;
    expect(lot.basis).toBe(4 * 2 * MC);
    expect(quoteBuyback(g, t, [{ lotId: lot.id, units: 4 }]).coins).toBe(2); // 8×0.3 = 2.4
  });

  it('로트 병합·분할로 원가 풀이 늘지 않는다', () => {
    const { g, t } = ready();
    applyTeamCommand(g, 'T1', { type: 'procure', items: [{ materialId: 'H2_g', units: 2 }] });
    applyTeamCommand(g, 'T1', { type: 'procure', items: [{ materialId: 'H2_g', units: 2 }] });
    const lot = t.lots.find((l) => l.grade === 'purchased' && l.materialId === 'H2_g')!;
    expect(lot.units).toBe(4);
    expect(lot.basis).toBe(4 * 2 * MC);
    const inflow = t.valueLedger!.inflow;
    expect(quoteBuyback(g, t, [{ lotId: lot.id, units: 1 }]).totalMc + quoteBuyback(g, t, [{ lotId: lot.id, units: 3 }]).totalMc).toBeLessThanOrEqual(quoteBuyback(g, t, [{ lotId: lot.id, units: 4 }]).totalMc);
    expect(t.valueLedger!.inflow).toBe(inflow);
    ledgersOk(t);
  });

  it('반응의 여러 부산물에 같은 원가를 복제하지 않는다 · 공정 용수는 가치를 만들지 않는다', () => {
    const { g, t } = ready();
    t.actionsLeft = 3; t.energy = 12;
    applyTeamCommand(g, 'T1', { type: 'procure', items: [{ materialId: 'NaHCO3_s', units: 2 }, { materialId: 'Na2CO3_s', units: 1 }, { materialId: 'CaCl2_s', units: 1 }] });
    const poolBefore = heldBasis(t);
    applyTeamCommand(g, 'T1', { type: 'react', reactionId: 'R06', scale: 1 }); // 탄산나트륨 + 기체 혼합물
    applyTeamCommand(g, 'T1', { type: 'react', reactionId: 'R07', scale: 1 }); // 용해수 유입, 침전 혼합물
    expect(heldBasis(t)).toBe(poolBefore);
    for (const p of t.processes) expect(p.outputs.reduce((a, o) => a + (o.basis ?? 0), 0)).toBeGreaterThanOrEqual(0);
    ledgersOk(t);
  });

  it('상한을 넘는 바구니는 거절하고 재고를 가져가지 않는다', () => {
    const { g, t } = ready();
    t.coins = 200;
    receiveExternal(t, 'Zn_s', 10, 'purchase', lotGen, { basisMc: 40 * MC });
    const lot = t.lots.find((l) => l.materialId === 'Zn_s')!;
    const q = quoteBuyback(g, t, [{ lotId: lot.id, units: 10 }]);
    expect(q.coins).toBe(12);
    const units = lot.units;
    expect(applyTeamCommand(g, 'T1', { type: 'sellSurplus', items: [{ lotId: lot.id, units: 10 }] }).ok).toBe(false);
    expect(lot.units).toBe(units);
    expect(applyTeamCommand(g, 'T1', { type: 'sellSurplus', items: [{ lotId: lot.id, units: 4 }] }).ok).toBe(true); // 4.8 → 4
    ledgersOk(t);
  });

  it('여러 브라우저에서 같은 라운드 두 번째 매각은 거절 (라운드당 1회)', () => {
    const { g, t } = ready();
    receiveExternal(t, 'Zn_s', 6, 'purchase', lotGen, { basisMc: 24 * MC });
    const lot = t.lots.find((l) => l.materialId === 'Zn_s')!;
    expect(applyTeamCommand(g, 'T1', { type: 'sellSurplus', items: [{ lotId: lot.id, units: 2 }] }).ok).toBe(true);
    expect(applyTeamCommand(g, 'T1', { type: 'sellSurplus', items: [{ lotId: lot.id, units: 2 }] }).ok).toBe(false);
  });

  it('0코인 바구니는 매각하지 않는다 (물질만 잃지 않게)', () => {
    const { g, t } = ready();
    applyTeamCommand(g, 'T1', { type: 'procure', items: [{ materialId: 'O2_g', units: 1 }] });
    const lot = t.lots.find((l) => l.grade === 'purchased' && l.materialId === 'O2_g')!;
    const r = applyTeamCommand(g, 'T1', { type: 'sellSurplus', items: [{ lotId: lot.id, units: 1 }] });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('0코인');
    expect(lot.units).toBe(1);
  });

  it('준비 완료 뒤·경기 종료 뒤에는 매각 불가, 견적이 바뀌면 거절', () => {
    const { g, t } = ready();
    receiveExternal(t, 'Zn_s', 4, 'purchase', lotGen, { basisMc: 16 * MC });
    const lot = t.lots.find((l) => l.materialId === 'Zn_s')!;
    expect(applyTeamCommand(g, 'T1', { type: 'sellSurplus', items: [{ lotId: lot.id, units: 4 }], expectCoins: 9 }).ok).toBe(false);
    applyTeamCommand(g, 'T1', { type: 'readyRound', on: true });
    expect(applyTeamCommand(g, 'T1', { type: 'sellSurplus', items: [{ lotId: lot.id, units: 4 }] }).ok).toBe(false);
    g.phase = 'finished';
    expect(applyTeamCommand(g, 'T1', { type: 'sellSurplus', items: [{ lotId: lot.id, units: 4 }] }).ok).toBe(false);
  });

  it('섞인 것은 그대로 매각할 수 없다', () => {
    const { g, t } = ready();
    t.lots.push({ id: 'mix', kind: 'mixture', components: [{ materialId: 'CO2_g', units: 1 }, { materialId: 'H2O_g', units: 1 }], units: 2, grade: 'produced', tags: ['gasMixture'], solvent: 0, origin: { type: 'reaction', reactionId: 'R06', chain: ['R06'] }, basis: 0 });
    expect(applyTeamCommand(g, 'T1', { type: 'sellSurplus', items: [{ lotId: 'mix', units: 2 }] }).ok).toBe(false);
  });

  it('의뢰에 쓸 재료를 팔면 부족해지는 수량을 미리 알려 준다', () => {
    const { t } = ready();
    receiveExternal(t, 'Mg_s', 2, 'purchase', lotGen, { basisMc: 6 * MC });
    const lot = t.lots.find((l) => l.materialId === 'Mg_s' && l.grade === 'purchased')!;
    const need = stock(t, 'Mg_s');
    expect(buybackShortfall(t, [{ lotId: lot.id, units: 2 }], { Mg_s: need })).toEqual([{ materialId: 'Mg_s', short: 2 }]);
    expect(buybackShortfall(t, [{ lotId: lot.id, units: 2 }], {})).toEqual([]);
  });

  it('사고→팔기를 반복해도 코인이 늘지 않고, 경기 누적 상한은 경기 길이에 비례해 고정된다', () => {
    const { g, t } = ready();
    t.coins = 100;
    const start = t.coins;
    for (let r = 0; r < 3; r++) {
      t.actionsLeft = 3; t.buyback!.lastRound = -1; t.purchasesThisRound = {};
      expect(applyTeamCommand(g, 'T1', { type: 'procure', items: [{ materialId: 'Mg_s', units: 4 }] }).ok).toBe(true);
      const lot = t.lots.find((l) => l.materialId === 'Mg_s' && l.grade === 'purchased')!;
      applyTeamCommand(g, 'T1', { type: 'sellSurplus', items: [{ lotId: lot.id, units: lot.units }] });
    }
    expect(t.coins).toBeLessThan(start);
    const short = v3('classic', 1, 6);
    const long = v3('classic', 1, 12);
    expect(gameCapOf(short)).toBe(12);
    expect(gameCapOf(long)).toBe(24);
    ledgersOk(t);
  });

  it('종료 때 남은 재고는 감점·자동 현금화되지 않고 잔여 재고로 요약된다', () => {
    const g = v3('classic', 1, 1);
    pickAll(g);
    const t = g.teams['T1']!;
    applyTeamCommand(g, 'T1', { type: 'readyRound', on: true });
    const coins = t.coins;
    settleAndOpenNextRound(g);
    expect(g.phase).toBe('finished');
    const r = g.results![0]!;
    expect(r.asset).toBe(teamAsset(g, t));
    expect(t.coins).toBe(coins);
    expect(r.leftover!.reduce((a, x) => a + x.units, 0)).toBe(t.lots.reduce((a, l) => a + l.units, 0));
  });
});

describe('V3 의뢰 보드', () => {
  const water = (id: string): ContractInstance => ({ id, templateId: 'C01', title: `물${id}`, requirements: [{ materialId: 'H2O_l', units: 4, tags: ['condensed', 'refined'], allowSupport: true }], reward: 30, deadlineRound: 9, acquiredRound: 1 });

  it('작업 중 산출은 준비됨에 더하지 않는다 · 수증기는 정리 필요로 따로 센다', () => {
    const g = v3();
    pickAll(g);
    const t = g.teams['T1']!;
    t.energy = 12;
    receiveExternal(t, 'H2_g', 4, 'purchase', lotGen, { basisMc: 8 * MC });
    receiveExternal(t, 'O2_g', 2, 'purchase', lotGen, { basisMc: 2 * MC });
    t.contracts.push(water('w'));
    expect(applyTeamCommand(g, 'T1', { type: 'react', reactionId: 'R01', scale: 2 }).ok).toBe(true);
    const map = cachedReachability(g);
    let p = missionProgress(t, t.contracts, map, g.activeReactions, 'w')[0]!.reqs[0]!;
    expect(p.ready).toBe(0);
    expect(p.inProgress).toBe(4);
    expect(p.stillNeeded).toBe(4);
    applyTeamCommand(g, 'T1', { type: 'readyRound', on: true }); applyTeamCommand(g, 'T2', { type: 'readyRound', on: true });
    pickAll(g); // T2 already
    settleAndOpenNextRound(g);
    pickAll(g);
    p = missionProgress(t, t.contracts, map, g.activeReactions, 'w')[0]!.reqs[0]!;
    expect(p.inProgress).toBe(0);
    expect(p.ready).toBe(0); // 수증기는 아직 납품 불가
    expect(p.needsSorting).toBe(4);
    expect(p.sortProcess).toBe('P01');
  });

  it('혼합물은 출하 가능으로 세지 않는다', () => {
    const g = v3();
    const t = g.teams['T1']!;
    t.lots.push({ id: 'mix', kind: 'mixture', components: [{ materialId: 'CaCO3_s', units: 2 }, { materialId: 'NaCl_aq', units: 4 }], units: 6, grade: 'produced', tags: ['suspension'], solvent: 4, origin: { type: 'reaction', reactionId: 'R07', chain: ['R07'] } });
    const c: ContractInstance = { id: 'p', templateId: 'C04', title: '종이', requirements: [{ materialId: 'CaCO3_s', units: 2, tags: ['filtered'], allowSupport: true }], reward: 30, deadlineRound: 9, acquiredRound: 1 };
    const m = missionProgress(t, [c], cachedReachability(g), g.activeReactions, null)[0]!;
    expect(m.shippable).toBe(false);
    expect(m.reqs[0]!.ready).toBe(0);
    expect(m.reqs[0]!.needsSorting).toBe(2);
  });

  it('같은 재고를 두 의뢰에 중복 배정하지 않고 공용으로 표시하며, 집중 의뢰를 바꾸면 배정이 바뀐다', () => {
    const g = v3();
    const t = g.teams['T1']!;
    t.lots.push({ id: 'w', kind: 'pure', materialId: 'H2O_l', units: 4, grade: 'produced', tags: ['condensed'], solvent: 0, origin: { type: 'process', processId: 'P01', reactionId: 'R01', chain: ['R01', 'P01'] } });
    const map = cachedReachability(g);
    const [a, b] = [water('a'), water('b')];
    let m = missionProgress(t, [a, b], map, g.activeReactions, 'a');
    expect(m[0]!.reqs[0]!.ready).toBe(4);
    expect(m[1]!.reqs[0]!.ready).toBe(0);
    expect(m[1]!.reqs[0]!.readyGross).toBe(4);
    expect(m[1]!.reqs[0]!.sharedWith).toBe('물a');
    expect(m[0]!.reqs[0]!.sharedWith).toBe('물b');
    m = missionProgress(t, [a, b], map, g.activeReactions, 'b');
    expect(m[0]!.reqs[0]!.ready).toBe(0);
    expect(m[1]!.reqs[0]!.ready).toBe(4);
  });

  it('지원품으로 수량이 채워지고, 재고를 매각하면 부족해진다', () => {
    const g = v3();
    pickAll(g);
    const t = g.teams['T1']!;
    receiveExternal(t, 'H2O_l', 4, 'support', lotGen, { tags: ['condensed'], basisMc: 4 * MC });
    const map = cachedReachability(g);
    expect(missionProgress(t, [water('s')], map, g.activeReactions, null)[0]!.reqs[0]!.supportReady).toBe(4);
    const lot = t.lots.find((l) => l.materialId === 'H2O_l' && l.grade === 'support')!;
    // 4칸 × 1 × 0.3 = 1.2 → 1코인
    expect(applyTeamCommand(g, 'T1', { type: 'sellSurplus', items: [{ lotId: lot.id, units: 4 }] }).ok).toBe(true);
    expect(missionProgress(t, [water('s')], map, g.activeReactions, null)[0]!.reqs[0]!.stillNeeded).toBe(4);
  });

  it('카드 강조는 검증된 경로로만: 직접 목표 / 다음 단계 재료 / 무관', () => {
    const g = v3('classic');
    const map = cachedReachability(g);
    const waterReq = { materialId: 'H2O_l', units: 4, tags: ['condensed', 'refined'] };
    const paperReq = { materialId: 'CaCO3_s', units: 2, tags: ['filtered'] };
    expect(cardRelation(map, 'R01', waterReq, g.activeReactions)).toEqual({ kind: 'direct' });
    expect(cardRelation(map, 'R08', paperReq, g.activeReactions)).toEqual({ kind: 'intermediate', materialId: 'CaOH2_s' });
    expect(cardRelation(map, 'R05', waterReq, g.activeReactions)).toBeNull();
  });
});

describe('V3 물질 아트 매핑', () => {
  it('게임의 모든 물질이 안정된 materialId 로 그림에 연결되고, 상태가 다른 물은·염화수소는 서로 다른 그림이다', () => {
    for (const id of Object.keys(MATERIALS)) {
      expect(MATERIAL_ART[id], id).toBeDefined();
      expect(ART_IDS.has(MATERIAL_ART[id]!.assetId), id).toBe(true);
    }
    expect(MATERIAL_ART['H2O_l']!.assetId).not.toBe(MATERIAL_ART['H2O_g']!.assetId);
    expect(MATERIAL_ART['HCl_aq']!.assetId).not.toBe(MATERIAL_ART['HCl_g']!.assetId);
    // 같은 그림을 나눠 쓰는 다른 상태는 배지로 구분한다
    const byAsset: Record<string, string[]> = {};
    for (const [m, a] of Object.entries(MATERIAL_ART)) (byAsset[a.assetId] ??= []).push(m);
    for (const ms of Object.values(byAsset)) if (ms.length > 1) for (const m of ms) expect(MATERIAL_ART[m]!.badge, m).toBeTruthy();
  });
  it('혼합물 베이스는 로트 태그로 고른다', () => {
    expect(mixtureArtId(['gasMixture'])).toBe('mix-gas-mixture');
    expect(mixtureArtId(['suspension'])).toBe('mix-precipitate-mixture');
    expect(mixtureArtId(['liquidMixture', 'partial'])).toBe('mix-organic-mixture');
    expect(mixtureArtId(['filtrate'])).toBe('mix-aqueous-mixture');
  });
  it('48개 자산의 게임 파일이 실제 WebP 로 존재한다', () => {
    expect(ART_ASSETS.length).toBe(48);
    for (const a of ART_ASSETS) {
      const files = a.id === 'obj-mission-board' ? [`${a.id}.webp`] : [`${a.id}.webp`, `${a.id}-s.webp`];
      for (const f of files) {
        const p = `public/assets/objects/v3/${f}`;
        expect(existsSync(p), p).toBe(true);
        const head = readFileSync(p).subarray(0, 12);
        expect(head.subarray(0, 4).toString('ascii') + head.subarray(8, 12).toString('ascii'), p).toBe('RIFFWEBP');
      }
    }
  });
});
