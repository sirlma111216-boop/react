import { REACTIONS } from './reactions';
import { MATERIALS } from './materials';
import { applyProcess, makeMixtureLot, makePureLot, PROCESSES } from './processes';
import { CONTRACTS } from './contracts';
import { ALL_PRESETS } from './modes';
import { SHOP_BY_MODE } from '../config/economy';
import { computeReachability, contractReachable } from '../engine/reachability';
import { computeReactionOutputs } from '../engine/commands';
import { lotElements, type ElementCount } from '../engine/ledger';
import { parseFormula, molarMassOf } from './atoms';

export interface VerifyIssue { level: 'error' | 'warn'; where: string; message: string }

function countElements(items: { materialId: string; coef: number }[], mult = 1): ElementCount {
  const out: ElementCount = {};
  for (const it of items) {
    const m = MATERIALS[it.materialId];
    if (!m) { out['__missing__'] = 1; continue; }
    for (const [el, n] of Object.entries(m.composition)) out[el] = (out[el] ?? 0) + n * it.coef * mult;
  }
  return out;
}

function sameCounts(a: ElementCount, b: ElementCount): string[] {
  const diffs: string[] = [];
  for (const el of new Set([...Object.keys(a), ...Object.keys(b)])) if ((a[el] ?? 0) !== (b[el] ?? 0)) diffs.push(`${el}: ${a[el] ?? 0} vs ${b[el] ?? 0}`);
  return diffs;
}

/** 원소·전하·질량·기체 조건·촉매·분리 원장·도달 가능성을 검사한다. */
export function verifyChemistry(): { issues: VerifyIssue[]; checked: Record<string, number> } {
  const issues: VerifyIssue[] = [];
  const checked: Record<string, number> = { materials: 0, reactions: 0, streams: 0, processes: 0, contracts: 0, presets: 0 };
  const err = (where: string, message: string) => issues.push({ level: 'error', where, message });

  for (const m of Object.values(MATERIALS)) {
    checked.materials!++;
    try {
      const comp = parseFormula(m.formula);
      const mm = molarMassOf(comp);
      if (Math.abs(mm - m.molarMass) > 1e-6) err(m.id, `몰질량 불일치 ${mm} vs ${m.molarMass}`);
      if (m.compositionClass === 'element' && Object.keys(comp).length !== 1) err(m.id, '홑원소 물질이 여러 원소를 가짐');
      if (m.compositionClass === 'compound' && Object.keys(comp).length < 2) err(m.id, '화합물이 한 원소만 가짐');
      if (m.ions) {
        const q = m.ions.reduce((a, i) => a + i.charge * i.count, 0);
        if (q !== m.charge) err(m.id, `이온 전하 합 ${q} ≠ ${m.charge}`);
        if (m.structureClass !== 'ionic' && m.id !== 'HCl_aq') err(m.id, '이온 구성이 있는데 이온성이 아님');
      }
    } catch (e) { err(m.id, String(e)); }
  }

  for (const r of Object.values(REACTIONS)) {
    checked.reactions!++;
    const left: ElementCount = {};
    for (const s of r.reactants) for (const alt of s.accepts) {
      const m = MATERIALS[alt];
      if (!m) { err(r.id, `원료 물질 없음 ${alt}`); continue; }
      const first = MATERIALS[s.accepts[0]!]!;
      // 대체 원료는 같은 화학식 단위여야 한다 (상태만 다름)
      if (JSON.stringify(first.composition) !== JSON.stringify(m.composition)) err(r.id, `대체 원료 조성 불일치 ${alt}`);
    }
    for (const s of r.reactants) { const m = MATERIALS[s.accepts[0]!]!; for (const [el, n] of Object.entries(m.composition)) left[el] = (left[el] ?? 0) + n * s.coef; }
    const right = countElements(r.products);
    const d = sameCounts(left, right);
    if (d.length) err(r.id, `원소 보존 실패: ${d.join(', ')}`);
    const qL = r.reactants.reduce((a, s) => a + (MATERIALS[s.accepts[0]!]?.charge ?? 0) * s.coef, 0);
    const qR = r.products.reduce((a, p) => a + (MATERIALS[p.materialId]?.charge ?? 0) * p.coef, 0);
    if (qL !== qR) err(r.id, `전하 보존 실패 ${qL} vs ${qR}`);

    // 배치 스트림 검사: 부분 전환 포함, 배치 투입 원소 == 스트림 원소 (+ 용매로 합산된 물)
    const mult = r.batchMultiplier;
    const inputSolvent = r.reactants.reduce((a, s) => a + (MATERIALS[s.accepts[0]!]!.phase === 'aq' ? s.coef * mult : 0), 0);
    const dissolveWater = r.reactants.reduce((a, s) => a + (s.dissolve && MATERIALS[s.accepts[0]!]!.phase === 's' ? s.coef * mult : 0), 0);
    let outs: ReturnType<typeof computeReactionOutputs> | null = null;
    try { outs = computeReactionOutputs(r, 1, inputSolvent, dissolveWater, () => 'v'); } catch (e) { err(r.id, String(e)); }
    if (outs) {
      checked.streams! += outs.outputs.length;
      const inEl: ElementCount = {};
      for (const s of r.reactants) { const m = MATERIALS[s.accepts[0]!]!; for (const [el, n] of Object.entries(m.composition)) inEl[el] = (inEl[el] ?? 0) + n * s.coef * mult; }
      inEl['H'] = (inEl['H'] ?? 0) + 2 * (inputSolvent + dissolveWater);
      inEl['O'] = (inEl['O'] ?? 0) + (inputSolvent + dissolveWater);
      const outEl: ElementCount = {};
      for (const lot of outs.outputs) lotElements(lot, outEl);
      outEl['H'] = (outEl['H'] ?? 0) + 2 * outs.solventOut;
      outEl['O'] = (outEl['O'] ?? 0) + outs.solventOut;
      const dd = sameCounts(inEl, outEl);
      if (dd.length) err(r.id, `배치 스트림 원소 보존 실패: ${dd.join(', ')}`);
      // 정의된 stream.solvent 와 계산값 비교
      for (const s of r.outputs) if (s.solvent !== undefined) {
        const lot = outs.outputs[r.outputs.indexOf(s)]!;
        if (lot.solvent !== s.solvent * mult) issues.push({ level: 'warn', where: r.id, message: `스트림 용매 정의 ${s.solvent * mult} vs 계산 ${lot.solvent}` });
      }
      // 공정 적용 후 보존
      for (const lot of outs.outputs) for (const pid of Object.keys(PROCESSES)) {
        const res = applyProcess(pid, lot, () => 'p');
        if (!res.ok) continue;
        checked.processes!++;
        const before = lotElements(lot, {});
        const after: ElementCount = {};
        for (const o of res.outputs) lotElements(o, after);
        after['H'] = (after['H'] ?? 0) + 2 * res.solventReleased;
        after['O'] = (after['O'] ?? 0) + res.solventReleased;
        const pd = sameCounts(before, after);
        if (pd.length) err(`${r.id}/${pid}`, `공정 원소 보존 실패: ${pd.join(', ')}`);
        if (res.outputs.some((o) => o.grade === 'purchased')) err(`${r.id}/${pid}`, '공정 산출이 구매 등급');
      }
    }
    if (r.extentModel.type === 'partial') {
      if (r.batchMultiplier < 2) err(r.id, '부분 전환 반응의 배치 배수는 2 이상이어야 한다');
      if (!r.outputs.some((s) => s.mixture)) err(r.id, '부분 전환은 혼합물 스트림을 남겨야 한다');
    }
    if (r.gasVolumeRatio) {
      const species = [...r.reactants.map((s) => s.accepts[0]!), ...r.products.map((p) => p.materialId)];
      const gases = species.filter((id) => MATERIALS[id]!.phase === 'g');
      if (gases.length < 2) err(r.id, '기체 부피비를 표시하기에 기체 종이 부족');
      const labelCount = r.gasVolumeRatio.label.split(':').length;
      const ratioCount = r.gasVolumeRatio.ratio.split(':').length;
      if (labelCount !== ratioCount) err(r.id, '기체 부피비 라벨/비율 개수 불일치');
    }
    if (r.catalystEquipment) {
      if (r.timeWithCatalyst === undefined || r.timeWithCatalyst >= r.time) err(r.id, '촉매 시간 단축이 정의되지 않음');
    }
    if (r.heatRecoverable && !r.exothermic) err(r.id, '흡열 반응에 열회수 허용');
  }

  for (const c of Object.values(CONTRACTS)) {
    checked.contracts!++;
    for (const req of c.requirements) {
      if (!MATERIALS[req.materialId]) err(c.id, `물질 없음 ${req.materialId}`);
      if (req.tags.includes('purchased')) err(c.id, '구매 태그로 납품 허용');
    }
  }

  for (const p of ALL_PRESETS) {
    checked.presets!++;
    const map = computeReachability(p.reactions, SHOP_BY_MODE[p.mode]!, p.equipment);
    for (const cid of p.contracts) if (!contractReachable(map, CONTRACTS[cid]!)) err(p.id, `도달 불가능 계약 ${cid}`);
    for (const rid of p.reactions) if (!REACTIONS[rid]!.modes.includes(p.mode)) err(p.id, `모드에 맞지 않는 반응 ${rid}`);
    const dead = p.reactions.filter((rid) => !REACTIONS[rid]!.reactants.every((s) => s.accepts.some((m) => map.producible.has(m))));
    if (dead.length) err(p.id, `원료를 구할 수 없는 죽은 카드 ${dead.join(',')}`);
  }

  // 혼합물은 단일 분자로 표시되지 않는다: probe
  const mix = makeMixtureLot([{ materialId: 'CaCO3_s', units: 1 }, { materialId: 'NaCl_aq', units: 2 }], ['suspension'], { type: 'reaction', reactionId: 'R07', chain: ['R07'] }, 2, 'x');
  if (mix.kind !== 'mixture') err('mixture', '혼합물 로트 생성 실패');
  const pure = makePureLot('H2O_l', 1, 'purchased', ['purchased'], { type: 'purchase', chain: [] });
  if (pure.tags.includes('condensed')) err('purchase', '구매 물이 응축 이력을 가짐');

  return { issues, checked };
}
