import type { ContractTemplate, GameState, Lot, ReactionDefinition } from '../types';
import { REACTIONS } from '../chemistry/reactions';
import { MATERIALS } from '../chemistry/materials';
import { applyProcess, PROCESSES } from '../chemistry/processes';
import { CONTRACTS } from '../chemistry/contracts';
import { computeReactionOutputs } from './commands';

/** 반응 배치 1회로 얻는 (물질,태그) 산출 경로 */
export interface Route {
  reactionId: string;
  /** 순서대로 적용할 공정 (없으면 빈 배열) */
  processIds: string[];
  /** 배치(scale 1)당 목표 물질 칸 수 */
  yieldPerBatch: number;
  /** 배치당 필요한 원료 (대표 물질 기준) */
  inputsPerBatch: { materialId: string; units: number; alternatives: string[] }[];
  /** 완료까지 최소 라운드 수 (반응 시간 + 공정 수 + 납품 1) */
  rounds: number;
  requiredEquipment: string[];
}

export interface ReachabilityMap {
  /** key = materialId|tag */
  routes: Map<string, Route[]>;
  /** 어떤 방법으로든 만들 수 있는 물질 */
  producible: Set<string>;
}

function batchOutputs(r: ReactionDefinition): Lot[] {
  const inputSolvent = r.reactants.reduce((a, s) => a + (MATERIALS[s.accepts[0]!]!.phase === 'aq' ? s.coef * r.batchMultiplier : 0), 0);
  const dissolveWater = r.reactants.reduce((a, s) => a + (s.dissolve && MATERIALS[s.accepts[0]!]!.phase === 's' ? s.coef * r.batchMultiplier : 0), 0);
  return computeReactionOutputs(r, 1, inputSolvent, dissolveWater, () => `probe-${r.id}`).outputs;
}

const MAX_PROCESS_DEPTH = 2;

/**
 * 원료→중간물→계약 그래프 폐포. 상점 물질에서 출발해 활성 반응·공정(최대 2단계)으로 도달 가능한 (물질,태그)를 계산한다.
 * 이 필터는 계약 제안의 도달 가능성만 판단하며 최적 경로를 대신 선택하지 않는다.
 */
export function computeReachability(activeReactions: string[], shopMaterials: string[], availableEquipment: string[]): ReachabilityMap {
  const producible = new Set<string>(shopMaterials);
  const routes = new Map<string, Route[]>();
  let added = 0;
  const addRoute = (mat: string, tag: string, route: Route) => {
    const key = `${mat}|${tag}`;
    const list = routes.get(key) ?? [];
    if (!list.some((x) => x.reactionId === route.reactionId && x.processIds.join() === route.processIds.join())) { list.push(route); added++; }
    routes.set(key, list);
    if (!producible.has(mat)) { producible.add(mat); added++; }
  };
  let guard = 0;
  let before = -1;
  while (added !== before && guard++ < 20) {
    before = added;
    for (const rid of activeReactions) {
      const r = REACTIONS[rid];
      if (!r) continue;
      if (r.requiredEquipment?.some((e) => !availableEquipment.includes(e))) continue;
      const feasible = r.reactants.every((s) => s.accepts.some((m) => producible.has(m)));
      if (!feasible) continue;
      const inputs = r.reactants.map((s) => ({ materialId: s.accepts.find((m) => producible.has(m)) ?? s.accepts[0]!, units: s.coef * r.batchMultiplier, alternatives: s.accepts }));
      const baseEquip = r.requiredEquipment ?? [];
      const visit = (lot: Lot, chain: string[], equip: string[]) => {
        if (lot.kind === 'pure') {
          for (const tag of lot.tags) addRoute(lot.materialId!, tag, { reactionId: rid, processIds: chain, yieldPerBatch: lot.units, inputsPerBatch: inputs, rounds: r.time + chain.reduce((a, pid) => a + PROCESSES[pid]!.time, 0) + 1, requiredEquipment: equip });
          if (lot.grade !== 'purchased') producible.add(lot.materialId!);
        }
        if (chain.length >= MAX_PROCESS_DEPTH) return;
        for (const pid of Object.keys(PROCESSES)) {
          const pdef = PROCESSES[pid]!;
          if (pdef.requiredEquipment && !availableEquipment.includes(pdef.requiredEquipment)) continue;
          const res = applyProcess(pid, lot, () => 'probe');
          if (!res.ok) continue;
          for (const o of res.outputs) visit(o, [...chain, pid], pdef.requiredEquipment ? [...equip, pdef.requiredEquipment] : equip);
        }
      };
      for (const lot of batchOutputs(r)) visit(lot, [], baseEquip);
    }
  }
  return { routes, producible };
}

export function routesFor(map: ReachabilityMap, materialId: string, tags: string[]): Route[] {
  const out: Route[] = [];
  for (const t of tags) for (const r of map.routes.get(`${materialId}|${t}`) ?? []) if (!out.includes(r)) out.push(r);
  return out;
}

export function contractReachable(map: ReachabilityMap, c: ContractTemplate): boolean {
  return c.requirements.every((req) => routesFor(map, req.materialId, req.tags).length > 0);
}

/** 계약 완료에 필요한 최소 라운드(가장 빠른 경로 기준, 납품 라운드 포함) */
export function contractMinRounds(map: ReachabilityMap, c: ContractTemplate): number {
  let worst = 0;
  for (const req of c.requirements) {
    const rs = routesFor(map, req.materialId, req.tags);
    if (!rs.length) return Infinity;
    worst = Math.max(worst, Math.min(...rs.map((r) => r.rounds)));
  }
  return worst;
}

export function reachabilityForState(state: GameState): ReachabilityMap {
  return computeReachability(state.activeReactions, state.shopMaterials, state.activeEquipment);
}

/** 도감·검증용: 모드에서 모든 활성 계약이 합법 경로를 갖는지 */
export function unreachableContracts(activeReactions: string[], shop: string[], equipment: string[], contracts: string[]): string[] {
  const map = computeReachability(activeReactions, shop, equipment);
  return contracts.filter((cid) => !contractReachable(map, CONTRACTS[cid]!));
}

export function describeRoute(r: Route): string {
  const rx = REACTIONS[r.reactionId]!;
  const p = r.processIds.length ? ' → ' + r.processIds.map((pid) => PROCESSES[pid]!.name).join(' → ') : '';
  return `${rx.name}${p} (배치당 ${r.yieldPerBatch}칸)`;
}

export const materialName = (id: string) => MATERIALS[id]?.displayName ?? id;
