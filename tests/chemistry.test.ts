import { describe, it, expect } from 'vitest';
import { verifyChemistry } from '../src/shared/chemistry/verify';
import { parseFormula, molarMassOf, massRatio } from '../src/shared/chemistry/atoms';
import { MATERIALS } from '../src/shared/chemistry/materials';
import { REACTIONS } from '../src/shared/chemistry/reactions';
import { applyProcess, makeMixtureLot, makePureLot } from '../src/shared/chemistry/processes';
import { computeReactionOutputs } from '../src/shared/engine/commands';
import { lotElements } from '../src/shared/engine/ledger';

describe('화학식·원자량', () => {
  it('괄호와 계수를 파싱한다', () => {
    expect(parseFormula('Ca(OH)2')).toEqual({ Ca: 1, O: 2, H: 2 });
    expect(parseFormula('CH3COOC2H5')).toEqual({ C: 4, H: 8, O: 2 });
    expect(parseFormula('NaHCO3')).toEqual({ Na: 1, H: 1, C: 1, O: 3 });
  });
  it('물의 질량비는 H:O = 1:8 (교육용 원자량)', () => {
    const r = massRatio(parseFormula('H2O'));
    const h = r.find((x) => x.element === 'H')!.mass;
    const o = r.find((x) => x.element === 'O')!.mass;
    expect(o / h).toBe(8);
    expect(molarMassOf(parseFormula('H2O'))).toBe(18);
  });
  it('이온성 결정은 이온 구성이 전하 0 으로 맞는다', () => {
    expect(MATERIALS['CaCl2_s']!.ions!.map((i) => i.count)).toEqual([1, 2]);
    expect(MATERIALS['NaCl_s']!.structureClass).toBe('ionic');
    expect(MATERIALS['H2O_l']!.structureClass).toBe('molecular');
    expect(MATERIALS['O2_g']!.compositionClass).toBe('element');
  });
  it('상태별 재고가 구별된다 (HCl(g)≠HCl(aq), 물≠수증기)', () => {
    expect(MATERIALS['HCl_g']!.id).not.toBe(MATERIALS['HCl_aq']!.id);
    expect(MATERIALS['H2O_g']!.phase).toBe('g');
    expect(MATERIALS['H2O_l']!.phase).toBe('l');
  });
});

describe('반응 골격 전체 검증', () => {
  it('원소·전하·스트림·공정·도달 가능성에 오류가 없다', () => {
    const { issues, checked } = verifyChemistry();
    const errors = issues.filter((i) => i.level === 'error');
    expect(errors).toEqual([]);
    expect(checked.reactions).toBe(22);
    expect(checked.contracts).toBe(14);
  });
  it('배율 2 에서도 원소가 보존된다', () => {
    for (const r of Object.values(REACTIONS)) {
      const inputSolvent = r.reactants.reduce((a, s) => a + (MATERIALS[s.accepts[0]!]!.phase === 'aq' ? s.coef * r.batchMultiplier * 2 : 0), 0);
      const dissolve = r.reactants.reduce((a, s) => a + (s.dissolve && MATERIALS[s.accepts[0]!]!.phase === 's' ? s.coef * r.batchMultiplier * 2 : 0), 0);
      const { outputs, solventOut } = computeReactionOutputs(r, 2, inputSolvent, dissolve, () => 'x');
      const inEl: Record<string, number> = {};
      for (const s of r.reactants) for (const [el, n] of Object.entries(MATERIALS[s.accepts[0]!]!.composition)) inEl[el] = (inEl[el] ?? 0) + n * s.coef * r.batchMultiplier * 2;
      inEl['H'] = (inEl['H'] ?? 0) + 2 * (inputSolvent + dissolve);
      inEl['O'] = (inEl['O'] ?? 0) + inputSolvent + dissolve;
      const outEl: Record<string, number> = {};
      for (const lot of outputs) lotElements(lot, outEl);
      outEl['H'] = (outEl['H'] ?? 0) + 2 * solventOut;
      outEl['O'] = (outEl['O'] ?? 0) + solventOut;
      expect(outEl, r.id).toEqual(inEl);
    }
  });
  it('부분 전환(R20)은 촉매와 무관하게 같은 양을 만들고 남은 원료를 보존한다', () => {
    const r = REACTIONS['R20']!;
    const { outputs } = computeReactionOutputs(r, 1, 0, 0, () => 'x');
    expect(outputs).toHaveLength(1);
    const comps = outputs[0]!.components!;
    expect(comps.find((c) => c.materialId === 'NH3_g')!.units).toBe(2);
    expect(comps.find((c) => c.materialId === 'N2_g')!.units).toBe(1);
    expect(comps.find((c) => c.materialId === 'H2_g')!.units).toBe(3);
    // 촉매는 시간만 줄인다
    expect(r.timeWithCatalyst).toBeLessThan(r.time);
    expect(r.extentModel.type).toBe('partial');
  });
  it('기체 부피비는 기체 종에만 표시한다', () => {
    expect(REACTIONS['R01']!.gasVolumeRatio?.ratio).toBe('2 : 1 : 2');
    expect(REACTIONS['R07']!.gasVolumeRatio).toBeUndefined();
    expect(REACTIONS['R08']!.gasVolumeRatio).toBeUndefined();
  });
});

describe('가공 공정', () => {
  const origin = { type: 'reaction' as const, reactionId: 'R04', chain: ['R04'] };
  it('응축은 수증기만 물로 만들고 비응축 기체를 따로 회수한다', () => {
    const lot = makeMixtureLot([{ materialId: 'CO2_g', units: 1 }, { materialId: 'H2O_g', units: 2 }], ['gasMixture'], origin, 0, 'm');
    const res = applyProcess('P01', lot, () => 'o');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const water = res.outputs.find((o) => o.materialId === 'H2O_l')!;
    expect(water.units).toBe(2);
    expect(water.tags).toContain('condensed');
    const co2 = res.outputs.find((o) => o.materialId === 'CO2_g')!;
    expect(co2.tags).toContain('gasCollected');
  });
  it('여과는 불용성 고체만 회수하고 용해된 염은 여액에 남긴다', () => {
    const lot = makeMixtureLot([{ materialId: 'CaCO3_s', units: 1 }, { materialId: 'NaCl_aq', units: 2 }], ['suspension'], { type: 'reaction', reactionId: 'R07', chain: ['R07'] }, 2, 'm');
    const res = applyProcess('P02', lot, () => 'o');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const solid = res.outputs.find((o) => o.materialId === 'CaCO3_s')!;
    expect(solid.tags).toContain('filtered');
    const filtrate = res.outputs.find((o) => o.materialId === 'NaCl_aq')!;
    expect(filtrate.solvent).toBe(2);
    expect(filtrate.grade).toBe('recovered');
    // 여액을 그대로 결정 소금으로 얻을 수 없고 결정화가 따로 필요하다
    const cr = applyProcess('P03', filtrate, () => 'c');
    expect(cr.ok && cr.outputs[0]!.materialId === 'NaCl_s' && cr.solventReleased === 2).toBe(true);
  });
  it('정의되지 않은 조합은 지원하지 않는 공정으로 거절한다', () => {
    const lot = makePureLot('Mg_s', 2, 'purchased', ['purchased'], { type: 'purchase', chain: [] });
    expect(applyProcess('P01', lot).ok).toBe(false);
    expect(applyProcess('P02', lot).ok).toBe(false);
    expect(applyProcess('P03', lot).ok).toBe(false);
    expect(applyProcess('P04', lot).ok).toBe(false);
  });
  it('구매한 물은 응축 이력을 갖지 않는다', () => {
    const lot = makePureLot('H2O_l', 4, 'purchased', ['purchased'], { type: 'purchase', chain: [] });
    expect(lot.tags).not.toContain('condensed');
  });
});
