import type { Lot, ProcessDefinition } from '../types';
import { MATERIALS } from './materials';

/**
 * 정리하기(가공) 4종. time 0 = 실행 즉시 완료 (기다림 없음).
 * 학생 화면에서는 "정리하기"로 부르며, 분리·정제의 추상 공정이다.
 */
export const PROCESSES: Record<string, ProcessDefinition> = {
  P01: { id: 'P01', name: '응축하기', energy: 1, fee: 0, time: 0, description: '수증기를 식혀 물로 만들고, 섞여 있던 기체는 따로 모은다. 기체가 두 종류 이상 섞여 있으면 나누지 않는다.' },
  P02: { id: 'P02', name: '거르기', energy: 0, fee: 2, time: 0, description: '섞인 것에서 녹지 않은 고체만 건져 낸다. 물에 녹은 것은 여액(남은 용액)으로 남는다.' },
  P03: { id: 'P03', name: '결정 만들기', energy: 2, fee: 1, time: 0, description: '소금물(염화나트륨 수용액)에서 물을 날려 소금 결정을 얻는다. 물은 회수수로 돌아간다.' },
  P04: { id: 'P04', name: '정제하기', energy: 2, fee: 2, time: 0, requiredEquipment: 'U07', description: '암모니아·에탄올·에스터 혼합물에서 제품만 골라내고 남은 재료는 되돌려 받는다. 정제 장비가 필요하다.' },
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
const nameOf = (id: string) => MATERIALS[id]?.displayName ?? id;

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
    if (!steam) return { ok: false, error: '응축할 수증기가 없습니다.' };
    const gases = comps.filter((c) => c.materialId !== 'H2O_g' && MATERIALS[c.materialId]?.phase === 'g');
    const others = comps.filter((c) => c.materialId !== 'H2O_g' && MATERIALS[c.materialId]?.phase !== 'g');
    if (others.length) return { ok: false, error: '기체가 아닌 것이 섞여 있어 응축할 수 없습니다.' };
    const outputs: Lot[] = [makePureLot('H2O_l', steam.units, 'produced', ['condensed'], originFor(), 0, idGen())];
    if (gases.length === 1) outputs.push(makePureLot(gases[0]!.materialId, gases[0]!.units, 'produced', ['gasCollected'], originFor(), 0, idGen()));
    else if (gases.length > 1) outputs.push(makeMixtureLot(gases, ['gasMixture'], originFor(), 0, idGen()));
    return { ok: true, outputs, solventReleased: 0, summary: `물 ${steam.units}개${gases.length ? ` + ${gases.map((g) => nameOf(g.materialId)).join('/')} 따로 모음` : ''}` };
  }

  if (processId === 'P02') {
    if (lot.kind !== 'mixture') return { ok: false, error: '거르기는 섞인 것에만 할 수 있습니다.' };
    const solids = comps.filter((c) => MATERIALS[c.materialId]?.phase === 's');
    const rest = comps.filter((c) => MATERIALS[c.materialId]?.phase !== 's');
    if (solids.length !== 1) return { ok: false, error: solids.length === 0 ? '건져 낼 고체가 없습니다.' : '고체가 두 종류 이상이면 거르기로 나눌 수 없습니다.' };
    if (rest.some((c) => MATERIALS[c.materialId]?.phase === 'g')) return { ok: false, error: '기체가 섞여 있으면 먼저 기체를 모아야 합니다.' };
    const outputs: Lot[] = [makePureLot(solids[0]!.materialId, solids[0]!.units, 'produced', ['filtered'], originFor(), 0, idGen())];
    if (rest.length === 1) {
      const r = rest[0]!;
      const isWater = r.materialId === 'H2O_l';
      outputs.push(makePureLot(r.materialId, r.units, 'recovered', [isWater ? 'solutionWater' : 'filtrate'], originFor(), isWater ? 0 : lot.solvent, idGen()));
    } else if (rest.length > 1) {
      outputs.push(makeMixtureLot(rest, ['filtrate'], originFor(), lot.solvent, idGen()));
    }
    const released = rest.length === 1 && rest[0]!.materialId === 'H2O_l' ? lot.solvent : rest.length === 0 ? lot.solvent : 0;
    return { ok: true, outputs, solventReleased: released, summary: `${nameOf(solids[0]!.materialId)} ${solids[0]!.units}개 건져 냄` };
  }

  if (processId === 'P03') {
    if (lot.kind !== 'pure' || lot.materialId !== 'NaCl_aq') return { ok: false, error: '결정 만들기는 소금물(염화나트륨 수용액)에만 할 수 있습니다.' };
    return {
      ok: true,
      outputs: [makePureLot('NaCl_s', lot.units, 'produced', ['crystallized'], originFor(), 0, idGen())],
      solventReleased: lot.solvent,
      summary: `소금 결정 ${lot.units}개`,
    };
  }

  if (processId === 'P04') {
    if (fromReaction === 'R20' && lot.kind === 'mixture') {
      const nh3 = comps.find((c) => c.materialId === 'NH3_g');
      if (!nh3) return { ok: false, error: '암모니아가 없습니다.' };
      const outputs = [makePureLot('NH3_g', nh3.units, 'produced', ['refined'], originFor(), 0, idGen())];
      for (const c of comps) if (c.materialId !== 'NH3_g') outputs.push(makePureLot(c.materialId, c.units, 'recovered', ['recovered'], originFor(), 0, idGen()));
      return { ok: true, outputs, solventReleased: 0, summary: `암모니아 ${nh3.units}개 골라냄, 남은 재료 되돌림` };
    }
    if (fromReaction === 'R21' && lot.kind === 'pure' && lot.materialId === 'ethanol_aq') {
      return {
        ok: true,
        outputs: [makePureLot('ethanol_l', lot.units, 'produced', ['refined'], originFor(), 0, idGen())],
        solventReleased: lot.solvent,
        summary: `에탄올 ${lot.units}개 정제 (완전 무수 등급은 아님)`,
      };
    }
    if (fromReaction === 'R22' && lot.kind === 'mixture') {
      const ester = comps.find((c) => c.materialId === 'ethylAcetate_l');
      if (!ester) return { ok: false, error: '에스터가 없습니다.' };
      const outputs = [makePureLot('ethylAcetate_l', ester.units, 'produced', ['refined'], originFor(), 0, idGen())];
      for (const c of comps) if (c.materialId !== 'ethylAcetate_l') outputs.push(makePureLot(c.materialId, c.units, 'recovered', ['recovered'], originFor(), 0, idGen()));
      return { ok: true, outputs, solventReleased: 0, summary: `아세트산에틸 ${ester.units}개 골라냄, 남은 재료 되돌림` };
    }
    return { ok: false, error: '이것은 정제하기로 나눌 수 없습니다.' };
  }
  return { ok: false, error: '알 수 없는 정리 방법입니다.' };
}

/** 로트에 적용 가능한 공정 목록 (UI 표시용) */
export function applicableProcesses(lot: Lot): string[] {
  return Object.keys(PROCESSES).filter((pid) => applyProcess(pid, lot, () => 'probe').ok);
}
