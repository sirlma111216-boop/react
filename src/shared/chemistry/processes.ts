import type { Lot, ProcessDefinition } from '../types';
import { MATERIALS } from './materials';

export const PROCESSES: Record<string, ProcessDefinition> = {
  P01: { id: 'P01', name: '응축·기체 회수', energy: 1, fee: 0, time: 1, description: '수증기를 액체 물로 응축하고, 남는 비응축 기체를 별도 회수한다. 기체 성분이 여럿이면 임의로 분리하지 않는다.' },
  P02: { id: 'P02', name: '고체 회수(여과·세척·건조)', energy: 0, fee: 2, time: 1, description: '불용성 고체만 회수한다. 여액과 공정 용수는 원장에 남는다.' },
  P03: { id: 'P03', name: '염 결정화', energy: 2, fee: 1, time: 1, description: '지정 단일 염 용액(NaCl)만 결정화한다. 용매는 회수수로 돌아간다.' },
  P04: { id: 'P04', name: '산업 정제', energy: 2, fee: 2, time: 1, requiredEquipment: 'U07', description: 'R20/R21/R22 생성물의 검증된 분리 recipe. 미반응물을 회수한다.' },
};

let lotCounter = 0;
export function newLotId(prefix = 'L'): string {
  lotCounter += 1;
  return `${prefix}${Date.now().toString(36)}${lotCounter.toString(36)}`;
}

export function makePureLot(materialId: string, units: number, grade: Lot['grade'], tags: string[], origin: Lot['origin'], solvent = 0, id?: string): Lot {
  return { id: id ?? newLotId(), kind: 'pure', materialId, units, grade, tags, solvent, origin };
}

export function makeMixtureLot(components: { materialId: string; units: number }[], tags: string[], origin: Lot['origin'], solvent = 0, id?: string): Lot {
  const units = components.reduce((a, c) => a + c.units, 0);
  return { id: id ?? newLotId(), kind: 'mixture', components, units, grade: 'produced', tags, solvent, origin };
}

export function lotComponents(lot: Lot): { materialId: string; units: number }[] {
  if (lot.kind === 'pure') return [{ materialId: lot.materialId!, units: lot.units }];
  return lot.components ?? [];
}

export interface ProcessOutcome {
  ok: true;
  outputs: Lot[];
  /** 용매 원장으로 돌아가는 공정 용수 칸 */
  solventReleased: number;
  summary: string;
}
export interface ProcessError { ok: false; error: string }

const chainOf = (lot: Lot, pid: string) => [...lot.origin.chain, pid];

/**
 * 공정을 로트에 적용한 결과를 계산한다 (순수 함수, 상태 변경 없음).
 * 정의되지 않은 조합은 '이 공방에서 지원하지 않는 공정'으로 거절한다.
 */
export function applyProcess(processId: string, lot: Lot, idGen: () => string = newLotId): ProcessOutcome | ProcessError {
  const comps = lotComponents(lot);
  const fromReaction = lot.origin.reactionId;
  const originFor = (): Lot['origin'] => ({ type: 'process', processId, reactionId: fromReaction, chain: chainOf(lot, processId) });

  if (processId === 'P01') {
    const steam = comps.find((c) => c.materialId === 'H2O_g');
    if (!steam) return { ok: false, error: '응축할 수증기가 없는 로트입니다.' };
    const gases = comps.filter((c) => c.materialId !== 'H2O_g' && MATERIALS[c.materialId]?.phase === 'g');
    const others = comps.filter((c) => c.materialId !== 'H2O_g' && MATERIALS[c.materialId]?.phase !== 'g');
    if (others.length) return { ok: false, error: '기체 스트림이 아닌 로트는 응축 공정을 지원하지 않습니다.' };
    const outputs: Lot[] = [makePureLot('H2O_l', steam.units, 'produced', ['condensed'], originFor(), 0, idGen())];
    if (gases.length === 1) outputs.push(makePureLot(gases[0]!.materialId, gases[0]!.units, 'produced', ['gasCollected'], originFor(), 0, idGen()));
    else if (gases.length > 1) outputs.push(makeMixtureLot(gases, ['gasMixture'], originFor(), 0, idGen()));
    return { ok: true, outputs, solventReleased: 0, summary: `물 ${steam.units}칸 응축${gases.length ? ` + 기체 ${gases.map((g) => MATERIALS[g.materialId]!.formula).join('/')} 회수` : ''}` };
  }

  if (processId === 'P02') {
    if (lot.kind !== 'mixture') return { ok: false, error: '고체 회수는 혼합물(현탁액) 로트에만 적용됩니다.' };
    const solids = comps.filter((c) => MATERIALS[c.materialId]?.phase === 's');
    const rest = comps.filter((c) => MATERIALS[c.materialId]?.phase !== 's');
    if (solids.length !== 1) return { ok: false, error: solids.length === 0 ? '회수할 불용성 고체가 없습니다.' : '고체가 두 종류 이상인 혼합물의 분리는 지원하지 않습니다.' };
    if (rest.some((c) => MATERIALS[c.materialId]?.phase === 'g')) return { ok: false, error: '기체가 섞인 로트는 먼저 기체 회수가 필요합니다.' };
    const outputs: Lot[] = [makePureLot(solids[0]!.materialId, solids[0]!.units, 'produced', ['filtered'], originFor(), 0, idGen())];
    if (rest.length === 1) {
      const r = rest[0]!;
      const isWater = r.materialId === 'H2O_l';
      outputs.push(makePureLot(r.materialId, r.units, 'recovered', [isWater ? 'solutionWater' : 'filtrate'], originFor(), isWater ? 0 : lot.solvent, idGen()));
    } else if (rest.length > 1) {
      outputs.push(makeMixtureLot(rest, ['filtrate'], originFor(), lot.solvent, idGen()));
    }
    const released = rest.length === 1 && rest[0]!.materialId === 'H2O_l' ? lot.solvent : rest.length === 0 ? lot.solvent : 0;
    return { ok: true, outputs, solventReleased: released, summary: `${MATERIALS[solids[0]!.materialId]!.displayName} ${solids[0]!.units}칸 회수` };
  }

  if (processId === 'P03') {
    if (lot.kind !== 'pure' || lot.materialId !== 'NaCl_aq') return { ok: false, error: '결정화는 염화나트륨 단일 용액에만 적용됩니다.' };
    return {
      ok: true,
      outputs: [makePureLot('NaCl_s', lot.units, 'produced', ['crystallized'], originFor(), 0, idGen())],
      solventReleased: lot.solvent,
      summary: `염화나트륨 결정 ${lot.units}칸`,
    };
  }

  if (processId === 'P04') {
    if (fromReaction === 'R20' && lot.kind === 'mixture') {
      const nh3 = comps.find((c) => c.materialId === 'NH3_g');
      if (!nh3) return { ok: false, error: '암모니아가 없는 로트입니다.' };
      const outputs = [makePureLot('NH3_g', nh3.units, 'produced', ['refined'], originFor(), 0, idGen())];
      for (const c of comps) if (c.materialId !== 'NH3_g') outputs.push(makePureLot(c.materialId, c.units, 'recovered', ['recovered'], originFor(), 0, idGen()));
      return { ok: true, outputs, solventReleased: 0, summary: `암모니아 ${nh3.units}칸 분리, 미반응 원료 회수` };
    }
    if (fromReaction === 'R21' && lot.kind === 'pure' && lot.materialId === 'ethanol_aq') {
      return {
        ok: true,
        outputs: [makePureLot('ethanol_l', lot.units, 'produced', ['refined'], originFor(), 0, idGen())],
        solventReleased: lot.solvent,
        summary: `에탄올 ${lot.units}칸 정제 (완전 무수 등급을 뜻하지 않음)`,
      };
    }
    if (fromReaction === 'R22' && lot.kind === 'mixture') {
      const ester = comps.find((c) => c.materialId === 'ethylAcetate_l');
      if (!ester) return { ok: false, error: '에스터가 없는 로트입니다.' };
      const outputs = [makePureLot('ethylAcetate_l', ester.units, 'produced', ['refined'], originFor(), 0, idGen())];
      for (const c of comps) if (c.materialId !== 'ethylAcetate_l') outputs.push(makePureLot(c.materialId, c.units, 'recovered', ['recovered'], originFor(), 0, idGen()));
      return { ok: true, outputs, solventReleased: 0, summary: `아세트산에틸 ${ester.units}칸 분리, 미반응물 회수` };
    }
    return { ok: false, error: '이 로트에 대한 산업 정제 recipe 가 정의되어 있지 않습니다.' };
  }
  return { ok: false, error: '알 수 없는 공정입니다.' };
}

/** 로트에 적용 가능한 공정 목록 (UI 표시용) */
export function applicableProcesses(lot: Lot): string[] {
  return Object.keys(PROCESSES).filter((pid) => applyProcess(pid, lot, () => 'probe').ok);
}
