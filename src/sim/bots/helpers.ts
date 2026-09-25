import type { ContractInstance, GameState, TeamState } from '../../shared/types';
import { REACTIONS } from '../../shared/chemistry/reactions';
import { EQUIPMENT } from '../../shared/chemistry/equipment';
import { PROCESSES, applicableProcesses } from '../../shared/chemistry/processes';
import { MATERIALS } from '../../shared/chemistry/materials';
import { contractSatisfiable, pickReactantLots, processEnergy, processFee, reactionEnergy, availableCoins } from '../../shared/engine/commands';
import { hasEquipment, priceOf, reactionSlots, equipmentPrice } from '../../shared/engine/state';
import { routesFor, type ReachabilityMap, type Route } from '../../shared/engine/reachability';

/** 봇은 플레이어와 같은 정보만 본다: 자기 팀 상태 + 공개 정보. */
export interface BotView {
  state: GameState;
  team: TeamState;
  map: ReachabilityMap;
}

export function stockOf(team: TeamState, materialId: string): number {
  let n = 0;
  for (const l of team.lots) if (l.kind === 'pure' && l.materialId === materialId) n += l.units;
  return n;
}

export function deliverableUnits(team: TeamState, materialId: string, tags: string[]): number {
  let n = 0;
  for (const l of team.lots) if (l.kind === 'pure' && l.materialId === materialId && l.grade !== 'purchased' && l.tags.some((t) => tags.includes(t))) n += l.units;
  return n;
}

/** 진행 중 공정이 완료되면 얻게 될 물질(태그 포함) */
export function pendingUnits(team: TeamState, materialId: string, tags: string[]): number {
  let n = 0;
  for (const p of team.processes) for (const o of p.outputs) if (o.kind === 'pure' && o.materialId === materialId && o.tags.some((t) => tags.includes(t))) n += o.units;
  return n;
}

export interface FeasibleReaction { reactionId: string; scale: 1 | 2; energy: number }

export function feasibleReactions(v: BotView): FeasibleReaction[] {
  const { state, team } = v;
  const out: FeasibleReaction[] = [];
  const running = team.processes.filter((p) => p.kind === 'reaction').length;
  if (running >= reactionSlots(state, team)) return out;
  for (const rid of state.activeReactions) {
    const r = REACTIONS[rid]!;
    if (r.requiredEquipment?.some((e) => !hasEquipment(team, e))) continue;
    for (const scale of [2, 1] as const) {
      const energy = reactionEnergy(state, r) * scale;
      if (team.energy < energy) continue;
      if (!pickReactantLots(team, r, scale).ok) continue;
      out.push({ reactionId: rid, scale, energy });
      break;
    }
  }
  return out;
}

export interface FeasibleProcess { processId: string; lotId: string; energy: number; fee: number }

export function feasibleProcesses(v: BotView): FeasibleProcess[] {
  const { state, team } = v;
  const out: FeasibleProcess[] = [];
  if (team.processes.filter((p) => p.kind === 'process').length >= state.config.processSlots) return out;
  for (const lot of team.lots) {
    for (const pid of applicableProcesses(lot)) {
      const pdef = PROCESSES[pid]!;
      if (pdef.requiredEquipment && !hasEquipment(team, pdef.requiredEquipment)) continue;
      const energy = processEnergy(team, pid);
      const fee = processFee(team, pid);
      if (team.energy < energy || fee > availableCoins(team)) continue;
      out.push({ processId: pid, lotId: lot.id, energy, fee });
    }
  }
  return out;
}

export function deliverable(team: TeamState): ContractInstance[] {
  return team.contracts.filter((c) => contractSatisfiable(team, c).ok);
}

export interface Plan {
  contract: ContractInstance;
  routes: { req: { materialId: string; units: number; tags: string[] }; route: Route; batches: number }[];
  shopping: { materialId: string; units: number }[];
  cost: number;
  energy: number;
  rounds: number;
  feasible: boolean;
  missingEquipment: string[];
}

/** 계약 하나를 완성하기 위한 계획: 경로 선택 → 부족 원료 산출 → 비용·라운드 추정 */
export function planForContract(v: BotView, c: ContractInstance): Plan {
  const { state, team, map } = v;
  const routes: Plan['routes'] = [];
  const shopping: Record<string, number> = {};
  let energy = 0;
  let rounds = 1;
  const missingEquipment: string[] = [];
  const virtualStock: Record<string, number> = {};
  for (const l of team.lots) if (l.kind === 'pure') virtualStock[l.materialId!] = (virtualStock[l.materialId!] ?? 0) + l.units;
  for (const req of c.requirements) {
    const have = deliverableUnits(team, req.materialId, req.tags) + pendingUnits(team, req.materialId, req.tags);
    const need = req.units - have;
    if (need <= 0) continue;
    const candidates = routesFor(map, req.materialId, req.tags).filter((r) => state.activeReactions.includes(r.reactionId));
    if (!candidates.length) return { contract: c, routes, shopping: [], cost: Infinity, energy, rounds: Infinity, feasible: false, missingEquipment };
    // 보유 설비로 가능한 경로 우선, 그다음 라운드 짧은 순, 원가 낮은 순
    const scored = candidates.map((r) => {
      const missing = r.requiredEquipment.filter((e) => !hasEquipment(team, e));
      const batches = Math.ceil(need / r.yieldPerBatch);
      let cost = 0;
      for (const inp of r.inputsPerBatch) {
        const stock = inp.alternatives.reduce((a, alt) => a + (virtualStock[alt] ?? 0), 0);
        const buy = Math.max(0, inp.units * batches - stock);
        const shopMat = inp.alternatives.find((alt) => state.shopMaterials.includes(alt));
        if (buy > 0 && !shopMat) cost += 999;
        else if (buy > 0) cost += priceOf(state, shopMat!) * buy;
      }
      cost += missing.reduce((a, e) => a + equipmentPrice(state, e), 0);
      const rx = REACTIONS[r.reactionId]!;
      const en = reactionEnergy(state, rx) * batches + r.processIds.reduce((a, pid) => a + PROCESSES[pid]!.energy, 0);
      return { r, missing, batches, cost, en };
    }).sort((a, b) => a.missing.length - b.missing.length || a.cost - b.cost || a.r.rounds - b.r.rounds);
    const best = scored[0]!;
    missingEquipment.push(...best.missing);
    routes.push({ req, route: best.r, batches: best.batches });
    energy += best.en;
    rounds = Math.max(rounds, best.r.rounds + Math.max(0, Math.ceil(best.batches / 2) - 1));
    for (const inp of best.r.inputsPerBatch) {
      let needUnits = inp.units * best.batches;
      for (const alt of inp.alternatives) {
        const take = Math.min(virtualStock[alt] ?? 0, needUnits);
        virtualStock[alt] = (virtualStock[alt] ?? 0) - take;
        needUnits -= take;
      }
      if (needUnits > 0) {
        const shopMat = inp.alternatives.find((alt) => state.shopMaterials.includes(alt));
        if (!shopMat) return { contract: c, routes, shopping: [], cost: Infinity, energy, rounds: Infinity, feasible: false, missingEquipment };
        shopping[shopMat] = (shopping[shopMat] ?? 0) + needUnits;
      }
    }
  }
  const list = Object.entries(shopping).map(([materialId, units]) => ({ materialId, units }));
  const cost = list.reduce((a, i) => a + priceOf(state, i.materialId) * i.units, 0) + missingEquipment.reduce((a, e) => a + equipmentPrice(state, e), 0);
  const remaining = c.deadlineRound - state.round + 1;
  const feasible = cost <= availableCoins(team) + 4 && rounds <= remaining && list.every((i) => i.units <= state.config.procureMaxPerKindPerRound * 2);
  return { contract: c, routes, shopping: list, cost, energy, rounds, feasible, missingEquipment };
}

/** 계획의 다음 조달 명령 (한 번의 조달 제한을 지킨다) */
export function nextProcureItems(v: BotView, plan: Plan): { materialId: string; units: number }[] {
  const { state, team } = v;
  const cfg = state.config;
  const items: { materialId: string; units: number }[] = [];
  let total = 0;
  let coins = availableCoins(team);
  for (const s of plan.shopping) {
    if (items.length >= cfg.procureMaxKinds) break;
    const already = team.purchasesThisRound[s.materialId] ?? 0;
    const room = Math.min(cfg.procureMaxPerKindPerRound - already, cfg.procureMaxTotal - total);
    if (room <= 0) continue;
    const price = priceOf(state, s.materialId);
    const units = Math.min(s.units, room, Math.floor(coins / price));
    if (units <= 0) continue;
    items.push({ materialId: s.materialId, units });
    total += units;
    coins -= units * price;
  }
  return items;
}

/** 계획에 따라 지금 실행할 반응 (원료가 있는 것) */
export function nextReaction(v: BotView, plan: Plan): FeasibleReaction | null {
  const fr = feasibleReactions(v);
  for (const step of plan.routes) {
    const f = fr.find((x) => x.reactionId === step.route.reactionId);
    if (f) {
      const rx = REACTIONS[f.reactionId]!;
      const needBatches = step.batches;
      const scale: 1 | 2 = needBatches >= 2 && f.scale === 2 ? 2 : 1;
      return { reactionId: f.reactionId, scale, energy: reactionEnergy(v.state, rx) * scale };
    }
  }
  return null;
}

/** 계획에 필요한 공정 (해당 반응 산출 로트에 대해) */
export function nextProcess(v: BotView, plan: Plan): FeasibleProcess | null {
  const fp = feasibleProcesses(v);
  for (const step of plan.routes) {
    if (!step.route.processIds.length) continue;
    for (const f of fp) {
      const lot = v.team.lots.find((l) => l.id === f.lotId)!;
      if (lot.origin.reactionId === step.route.reactionId && step.route.processIds.includes(f.processId)) {
        // 체인 순서: 이미 거친 공정 다음 것
        const nextPid = step.route.processIds[lot.origin.chain.filter((c) => c.startsWith('P')).length];
        if (nextPid === f.processId) return f;
      }
    }
  }
  return null;
}

export function affordableEquipment(v: BotView): string[] {
  return v.state.activeEquipment.filter((e) => !hasEquipment(v.team, e) && equipmentPrice(v.state, e) <= availableCoins(v.team) && EQUIPMENT[e]);
}

export function materialLabel(id: string): string {
  return MATERIALS[id]?.displayName ?? id;
}
