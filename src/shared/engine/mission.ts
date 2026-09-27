import type { ContractInstance, ContractRequirement, Lot, TeamState } from '../types';
import { REACTIONS } from '../chemistry/reactions';
import { PROCESSES, applyProcess, applicableProcesses, lotComponents } from '../chemistry/processes';
import { lotUsableFor } from './commands';
import { routesFor, type ReachabilityMap, type Route } from './reachability';

/**
 * 공방 의뢰 보드용 진행 계산 (서버 상태만 읽는 순수 함수).
 * 정직하게 구분한다:
 *  - 준비됨: 지금 실제로 납품할 수 있는 상태·등급·출처의 재고 (집중 의뢰부터 가상 배정)
 *  - 정리 필요: 창고에 있지만 정리(응축·거르기 등)해야 쓸 수 있는 양
 *  - 작업 중: 진행 중 반응의 예상 산출 — 준비됨에 더하지 않는다
 *  - 아직 필요: 준비됨으로 채워지지 않은 잔량
 * 가상 배정은 실제 예약·소비가 아니다. 같은 재고가 두 의뢰에 걸치면 '다른 의뢰와 공용'으로 표시한다.
 */
export interface ReqProgress {
  index: number;
  materialId: string;
  tags: string[];
  need: number;
  ready: number;
  readyGross: number;
  supportReady: number;
  sharedWith: string | null;
  needsSorting: number;
  sortProcess: string | null;
  inProgress: number;
  inProgressRound: number | null;
  stillNeeded: number;
  routes: Route[];
}

export interface MissionProgress {
  contract: ContractInstance;
  reqs: ReqProgress[];
  shippable: boolean;
}

/** 로트를 정리하면(최대 2단계) 이 조건에 쓸 수 있는 칸 수와 첫 정리 방법 */
export function sortingYield(lot: Lot, req: ContractRequirement): { units: number; processId: string | null } {
  if (lotUsableFor(lot, req)) return { units: 0, processId: null };
  for (const pid of applicableProcesses(lot)) {
    const res = applyProcess(pid, lot, () => 'probe');
    if (!res.ok) continue;
    const direct = res.outputs.filter((o) => lotUsableFor(o, req)).reduce((a, o) => a + o.units, 0);
    if (direct > 0) return { units: direct, processId: pid };
    for (const o of res.outputs) for (const pid2 of applicableProcesses(o)) {
      const r2 = applyProcess(pid2, o, () => 'probe');
      if (!r2.ok) continue;
      const u = r2.outputs.filter((x) => lotUsableFor(x, req)).reduce((a, x) => a + x.units, 0);
      if (u > 0) return { units: u, processId: pid };
    }
  }
  return { units: 0, processId: null };
}

/** 로트가 완성되면 이 조건에 보탤 수 있는 칸 (바로 쓰거나 정리 후) */
function eventualUnits(lot: Lot, req: ContractRequirement): number {
  if (lotUsableFor(lot, req)) return lot.units;
  return sortingYield(lot, req).units;
}

export function missionProgress(team: TeamState, contracts: ContractInstance[], map: ReachabilityMap, activeReactions: string[], focusId: string | null): MissionProgress[] {
  const ordered = [...contracts].sort((a, b) => (a.id === focusId ? -1 : b.id === focusId ? 1 : 0));
  const used: Record<string, number> = {};
  const claimedBy: Record<string, string> = {};
  const out: MissionProgress[] = [];
  for (const c of ordered) {
    const reqs: ReqProgress[] = c.requirements.map((req, index) => {
      let gross = 0;
      let ready = 0;
      let supportReady = 0;
      let sharedWith: string | null = null;
      let need = req.units;
      // 직접 만든 것 → 지원품 순으로 (서버 납품 순서와 같다)
      const lots = [...team.lots].sort((a, b) => Number(a.grade === 'support') - Number(b.grade === 'support'));
      for (const lot of lots) {
        if (!lotUsableFor(lot, req)) continue;
        gross += lot.units;
        const avail = lot.units - (used[lot.id] ?? 0);
        if (avail < lot.units && claimedBy[lot.id]) sharedWith = claimedBy[lot.id]!;
        const take = Math.max(0, Math.min(avail, need));
        if (take > 0) {
          used[lot.id] = (used[lot.id] ?? 0) + take;
          claimedBy[lot.id] ??= c.title;
          ready += take;
          need -= take;
          if (lot.grade === 'support') supportReady += take;
        }
      }
      let needsSorting = 0;
      let sortProcess: string | null = null;
      for (const lot of team.lots) {
        const s = sortingYield(lot, req);
        if (s.units > 0) { needsSorting += s.units; sortProcess ??= s.processId; }
      }
      let inProgress = 0;
      let inProgressRound: number | null = null;
      for (const p of team.processes) {
        const u = p.outputs.reduce((a, o) => a + eventualUnits(o, req), 0);
        if (u > 0) { inProgress += u; inProgressRound = inProgressRound === null ? p.completesRound : Math.min(inProgressRound, p.completesRound); }
      }
      const routes = routesFor(map, req.materialId, req.tags).filter((r) => activeReactions.includes(r.reactionId)).sort((a, b) => a.rounds - b.rounds || a.processIds.length - b.processIds.length);
      return { index, materialId: req.materialId, tags: req.tags, need: req.units, ready, readyGross: gross, supportReady, sharedWith, needsSorting, sortProcess, inProgress, inProgressRound, stillNeeded: Math.max(0, req.units - ready), routes };
    });
    out.push({ contract: c, reqs, shippable: reqs.every((r) => r.stillNeeded === 0) });
  }
  // 두 번째 의뢰가 같은 재고를 원하면 첫 의뢰에도 공용 표시
  for (const m of out) for (const r of m.reqs) {
    if (r.sharedWith) continue;
    const other = out.find((o) => o !== m && o.reqs.some((x) => x.materialId === r.materialId && x.sharedWith === m.contract.title));
    if (other) r.sharedWith = other.contract.title;
  }
  return out.sort((a, b) => contracts.indexOf(a.contract) - contracts.indexOf(b.contract));
}

/** 한 조건을 위해 거쳐야 할 물질들 (경로 원료와 그 원료를 만드는 경로의 원료, 최대 3단계) */
function upstreamMaterials(map: ReachabilityMap, req: ContractRequirement, activeReactions: string[]): Map<string, number> {
  const depthOf = new Map<string, number>();
  let frontier = routesFor(map, req.materialId, req.tags).filter((r) => activeReactions.includes(r.reactionId)).flatMap((r) => r.inputsPerBatch.flatMap((i) => i.alternatives));
  for (let d = 1; d <= 3 && frontier.length; d++) {
    const next: string[] = [];
    for (const m of frontier) {
      if (depthOf.has(m)) continue;
      depthOf.set(m, d);
      for (const [key, routes] of map.routes) {
        if (key.split('|')[0] !== m) continue;
        for (const r of routes) if (activeReactions.includes(r.reactionId)) next.push(...r.inputsPerBatch.flatMap((i) => i.alternatives));
      }
    }
    frontier = next;
  }
  return depthOf;
}

export type CardRelation = { kind: 'direct' } | { kind: 'intermediate'; materialId: string } | null;

/**
 * 만들기 카드와 의뢰 조건의 관계를 검증된 반응·가공 그래프로 판정한다.
 * direct: 이 반응(과 뒤이은 정리)이 조건 물질을 만든다. intermediate: 이 반응의 산출이 조건 경로의 원료(다음 단계 재료)다.
 * 원소가 같다는 이유만으로는 관계로 보지 않는다.
 */
export function cardRelation(map: ReachabilityMap, reactionId: string, req: ContractRequirement, activeReactions: string[]): CardRelation {
  if (routesFor(map, req.materialId, req.tags).some((r) => r.reactionId === reactionId)) return { kind: 'direct' };
  const r = REACTIONS[reactionId];
  if (!r) return null;
  const up = upstreamMaterials(map, req, activeReactions);
  let best: { m: string; d: number } | null = null;
  for (const st of r.outputs) for (const p of st.products) {
    const d = up.get(p.materialId);
    if (d !== undefined && (!best || d < best.d)) best = { m: p.materialId, d };
  }
  return best ? { kind: 'intermediate', materialId: best.m } : null;
}

/** 경로를 읽기 쉬운 단계 이름으로: "수증기 만들기 → 응축하기" */
export function routeSteps(route: Route): string {
  const r = REACTIONS[route.reactionId];
  return [r?.name ?? route.reactionId, ...route.processIds.map((p) => PROCESSES[p]?.name ?? p)].join(' → ');
}

/** 창고 로트가 '섞여 있거나 응축이 필요한' 정리 대상인가 */
export function needsSorting(lot: Lot): boolean {
  return lot.kind === 'mixture' || (lot.kind === 'pure' && lot.materialId === 'H2O_g');
}

export { lotComponents };
