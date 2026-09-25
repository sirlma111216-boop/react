import type { CommandResult, ContractInstance, GameState, Lot, ReactionDefinition, RunningProcess, TeamCommand, TeamState } from '../types';
import { REACTIONS } from '../chemistry/reactions';
import { MATERIALS } from '../chemistry/materials';
import { applyProcess, lotComponents, makeMixtureLot, makePureLot, PROCESSES } from '../chemistry/processes';
import { EQUIPMENT } from '../chemistry/equipment';
import { addElements, addWater } from './ledger';
import { equipmentPrice, hasEquipment, makeIdGen, priceOf, pushLog, reactionSlots, receiveExternal } from './state';

const idGen = makeIdGen('L');

const fail = (error: string): CommandResult => ({ ok: false, error });

export function availableCoins(team: TeamState): number {
  return team.coins - team.bid;
}

export function reactionEnergy(state: GameState, r: ReactionDefinition): number {
  return state.config.reactionEnergy[r.id] ?? r.energy;
}
export function reactionTime(state: GameState, r: ReactionDefinition, team: TeamState): number {
  const base = state.config.reactionTime[r.id] ?? r.time;
  if (r.catalystEquipment && r.timeWithCatalyst !== undefined && hasEquipment(team, r.catalystEquipment)) return Math.min(base, r.timeWithCatalyst);
  return base;
}
export function processEnergy(team: TeamState, pid: string): number {
  const p = PROCESSES[pid]!;
  if (pid === 'P01' && hasEquipment(team, 'U03')) return 0;
  return p.energy;
}
export function processFee(team: TeamState, pid: string): number {
  const p = PROCESSES[pid]!;
  if (pid === 'P02' && hasEquipment(team, 'U04')) return 0;
  return p.fee;
}

/** 반응에 쓸 수 있는 로트 후보를 원료 슬롯별로 찾는다 (구매 로트 우선). */
export function pickReactantLots(team: TeamState, r: ReactionDefinition, scale: number): { ok: true; picks: { slot: number; lotId: string; units: number }[]; dissolveWater: number } | { ok: false; error: string; missing: { materialId: string; units: number }[] } {
  const picks: { slot: number; lotId: string; units: number }[] = [];
  const used: Record<string, number> = {};
  const missing: { materialId: string; units: number }[] = [];
  let dissolveWater = 0;
  r.reactants.forEach((spec, slot) => {
    let need = spec.coef * r.batchMultiplier * scale;
    const order = { purchased: 0, recovered: 1, produced: 2, contract: 3 } as const;
    const candidates = team.lots
      .filter((l) => l.kind === 'pure' && spec.accepts.includes(l.materialId!) && l.units - (used[l.id] ?? 0) > 0)
      .sort((a, b) => order[a.grade] - order[b.grade] || spec.accepts.indexOf(a.materialId!) - spec.accepts.indexOf(b.materialId!));
    for (const lot of candidates) {
      if (need <= 0) break;
      const avail = lot.units - (used[lot.id] ?? 0);
      const take = Math.min(avail, need);
      picks.push({ slot, lotId: lot.id, units: take });
      used[lot.id] = (used[lot.id] ?? 0) + take;
      if (spec.dissolve && MATERIALS[lot.materialId!]!.phase === 's') dissolveWater += take;
      need -= take;
    }
    if (need > 0) missing.push({ materialId: spec.accepts[0]!, units: need });
  });
  if (missing.length) return { ok: false, error: `원료 부족: ${missing.map((m) => `${MATERIALS[m.materialId]!.displayName} ${m.units}칸`).join(', ')}`, missing };
  return { ok: true, picks, dissolveWater };
}

/** 반응 시작 시 생성될 산출 로트를 계산한다 (순수 함수). */
export function computeReactionOutputs(r: ReactionDefinition, scale: number, inputSolvent: number, dissolveWater: number, gen: () => string = idGen): { outputs: Lot[]; solventOut: number } {
  // 원료 투입은 coef × batchMultiplier × scale, 스트림 산출은 배치(scale 1) 기준 정의값 × scale
  const stoich = r.batchMultiplier * scale;
  const mult = scale;
  const listed = new Set(r.outputs.flatMap((s) => s.products.map((p) => p.materialId)));
  // 스트림에 없는 생성물은 물이어야 하며 수용액 스트림의 용매로 합산한다
  let mergedWater = 0;
  for (const p of r.products) if (!listed.has(p.materialId)) {
    if (p.materialId !== 'H2O_l') throw new Error(`${r.id}: 스트림에 없는 생성물 ${p.materialId}`);
    mergedWater += p.coef * stoich;
  }
  const totalSolvent = inputSolvent + dissolveWater + mergedWater;
  const aqueousStreams = r.outputs.filter((s) => s.solvent !== undefined || s.products.some((p) => MATERIALS[p.materialId]!.phase === 'aq'));
  const outputs: Lot[] = [];
  let assigned = false;
  for (const s of r.outputs) {
    const origin = { type: 'reaction' as const, reactionId: r.id, chain: [r.id] };
    const isAq = aqueousStreams.includes(s);
    const solvent = isAq && !assigned ? totalSolvent : 0;
    if (isAq && !assigned) assigned = true;
    if (s.mixture) outputs.push(makeMixtureLot(s.products.map((p) => ({ materialId: p.materialId, units: p.coef * mult })), s.tags, origin, solvent, gen()));
    else {
      const p = s.products[0]!;
      outputs.push(makePureLot(p.materialId, p.coef * mult, s.grade ?? 'produced', s.tags, origin, solvent, gen()));
    }
  }
  if (!assigned && totalSolvent > 0) {
    // 수용액 스트림이 없는데 용매가 들어왔다면(예: 고체 용해) 회수수로 돌려보낸다
    return { outputs, solventOut: totalSolvent };
  }
  return { outputs, solventOut: 0 };
}

function consumePicks(team: TeamState, picks: { lotId: string; units: number }[]): number {
  let solvent = 0;
  for (const p of picks) {
    const lot = team.lots.find((l) => l.id === p.lotId)!;
    const solvTake = lot.units > 0 ? Math.floor((lot.solvent * p.units) / lot.units) : 0;
    lot.units -= p.units;
    lot.solvent -= solvTake;
    solvent += solvTake;
  }
  team.lots = team.lots.filter((l) => l.units > 0 || l.solvent > 0);
  return solvent;
}

function summarizeInputs(team: TeamState, picks: { lotId: string; units: number }[], before: Lot[]): string {
  const agg: Record<string, number> = {};
  for (const p of picks) {
    const lot = before.find((l) => l.id === p.lotId)!;
    agg[lot.materialId!] = (agg[lot.materialId!] ?? 0) + p.units;
  }
  void team;
  return Object.entries(agg).map(([m, u]) => `${MATERIALS[m]!.formula} ${u}칸`).join(' + ');
}

export function canActNow(state: GameState): boolean {
  return state.phase === 'execute';
}

export function contractSatisfiable(team: TeamState, c: ContractInstance): { ok: boolean; missing: string[] } {
  const used: Record<string, number> = {};
  const missing: string[] = [];
  for (const req of c.requirements) {
    let need = req.units;
    for (const lot of team.lots) {
      if (need <= 0) break;
      if (lot.kind !== 'pure' || lot.materialId !== req.materialId || lot.grade === 'purchased') continue;
      if (!lot.tags.some((t) => req.tags.includes(t))) continue;
      const avail = lot.units - (used[lot.id] ?? 0);
      const take = Math.min(avail, need);
      if (take > 0) { used[lot.id] = (used[lot.id] ?? 0) + take; need -= take; }
    }
    if (need > 0) missing.push(`${MATERIALS[req.materialId]!.displayName} ${need}칸 (${req.tags.map(tagLabel).join('/')})`);
  }
  return { ok: missing.length === 0, missing };
}

export const tagLabel = (t: string): string => ({ purchased: '구매', reaction: '생산', condensed: '응축', gasCollected: '기체 회수', filtered: '고체 회수', filtrate: '여액', crystallized: '결정화', refined: '정제', recovered: '회수', solutionWater: '회수수', gasMixture: '기체 혼합물', suspension: '현탁액', liquidMixture: '액체 혼합물', partial: '부분 전환' } as Record<string, string>)[t] ?? t;

export function deliverContract(state: GameState, team: TeamState, c: ContractInstance): CommandResult {
  const check = contractSatisfiable(team, c);
  if (!check.ok) return fail(`납품 조건 부족: ${check.missing.join(', ')}`);
  for (const req of c.requirements) {
    let need = req.units;
    for (const lot of team.lots) {
      if (need <= 0) break;
      if (lot.kind !== 'pure' || lot.materialId !== req.materialId || lot.grade === 'purchased') continue;
      if (!lot.tags.some((t) => req.tags.includes(t))) continue;
      const take = Math.min(lot.units, need);
      const solvTake = lot.units > 0 ? Math.floor((lot.solvent * take) / lot.units) : 0;
      lot.units -= take;
      lot.solvent -= solvTake;
      addElements(team.elementLedger.outflow, req.materialId, take);
      if (solvTake) addWater(team.elementLedger.outflow, solvTake);
      need -= take;
    }
  }
  team.lots = team.lots.filter((l) => l.units > 0 || l.solvent > 0);
  let reward = c.reward;
  if (state.transportBonusRound === state.round && !team.deliveredContracts.some((d) => d.round === state.round)) reward += 2;
  team.coins += reward;
  team.revenue += reward;
  team.delivered += 1;
  team.deliveredContracts.push({ round: state.round, templateId: c.templateId, reward, special: !!c.special });
  if (team.firstDeliveryRound === null) team.firstDeliveryRound = state.round;
  team.contracts = team.contracts.filter((x) => x.id !== c.id);
  pushLog(state, 'deliver', `${team.name}: ${c.title} 납품 +${reward}코인`, team.id);
  return { ok: true, consumedAction: true };
}

/**
 * 팀 명령을 검증하고 적용한다. 서버·시뮬레이터·연습 모드가 같은 함수를 사용한다.
 * 조작 담당자 검증은 호출자(서버)가 수행한다.
 */
export function applyTeamCommand(state: GameState, teamId: string, cmd: TeamCommand): CommandResult {
  const team = state.teams[teamId];
  if (!team) return fail('팀을 찾을 수 없습니다.');
  const cfg = state.config;
  const res = applyInner(state, team, cmd);
  if (res.ok) state.version += 1;
  void cfg;
  return res;
}

function applyInner(state: GameState, team: TeamState, cmd: TeamCommand): CommandResult {
  const cfg = state.config;
  const phase = state.phase;

  switch (cmd.type) {
    case 'memo': {
      team.memo = String(cmd.text).slice(0, 200);
      return { ok: true };
    }
    case 'pin': {
      if (phase === 'finished') return fail('경기가 끝났습니다.');
      team.pins = team.pins.filter((p) => !(p.playerId === cmd.playerId && p.target === cmd.target));
      team.pins.push({ playerId: cmd.playerId, target: String(cmd.target).slice(0, 40), label: String(cmd.label).slice(0, 40), at: Date.now() });
      if (team.pins.length > 12) team.pins.splice(0, team.pins.length - 12);
      return { ok: true };
    }
    case 'chooseBundle': {
      if (phase !== 'setup') return fail('시작 묶음은 경기 시작 전에만 고를 수 있습니다.');
      if (!cfg.bundles.some((b) => b.id === cmd.bundleId)) return fail('없는 시작 묶음입니다.');
      team.bundleId = cmd.bundleId;
      return { ok: true };
    }
    case 'chooseLease': {
      if (phase !== 'setup') return fail('임대 설비는 경기 시작 전에만 고를 수 있습니다.');
      if (state.mode !== 'industrial') return fail('산업 공방에서만 임대할 수 있습니다.');
      const e = EQUIPMENT[cmd.equipmentId];
      if (!e?.leasable || !state.activeEquipment.includes(e.id)) return fail('임대할 수 없는 설비입니다.');
      team.leaseId = e.id;
      return { ok: true };
    }
    case 'takeContract': {
      if (phase !== 'plan' && phase !== 'execute') return fail('계약은 계획·실행 단계에 확보합니다.');
      const offer = team.offers.find((o) => o.id === cmd.offerId);
      if (!offer) return fail('이미 사라진 제안입니다.');
      if (team.contracts.length >= cfg.contractLimit) return fail(`계약은 ${cfg.contractLimit}건까지만 보유할 수 있습니다.`);
      if (team.bid > 0 && team.contracts.length >= cfg.contractLimit - 1) return fail('입찰로 계약 슬롯 하나가 예약되어 있습니다.');
      if (team.lastCancelRound === state.round && team.contracts.length > 0) return fail('이번 라운드에 취소한 뒤에는 다음 라운드부터 새 계약을 확보할 수 있습니다.');
      const limit = offer.templateId === 'C06' ? cfg.byproductTemplateLimit : cfg.sameTemplateLimit;
      if ((team.templateCounts[offer.templateId] ?? 0) >= limit) return fail('같은 유형의 계약은 더 확보할 수 없습니다.');
      team.offers = team.offers.filter((o) => o.id !== offer.id);
      team.contracts.push({ ...offer, acquiredRound: state.round });
      team.templateCounts[offer.templateId] = (team.templateCounts[offer.templateId] ?? 0) + 1;
      pushLog(state, 'contract', `${team.name}: ${offer.title} 확보`, team.id);
      return { ok: true };
    }
    case 'cancelContract': {
      if (phase !== 'plan') return fail('계약 취소는 계획 단계에만 가능합니다.');
      const c = team.contracts.find((x) => x.id === cmd.contractId);
      if (!c) return fail('없는 계약입니다.');
      if (c.special) return fail('낙찰 계약은 취소할 수 없습니다.');
      team.contracts = team.contracts.filter((x) => x.id !== c.id);
      team.templateCounts[c.templateId] = Math.max(0, (team.templateCounts[c.templateId] ?? 1) - 1);
      team.lastCancelRound = state.round;
      pushLog(state, 'contract', `${team.name}: ${c.title} 취소`, team.id);
      return { ok: true };
    }
    case 'bid': {
      if (phase !== 'plan' && phase !== 'execute') return fail('입찰은 계획·실행 단계에만 가능합니다.');
      const auction = state.auctions.find((a) => a.round === state.round && !a.resolved);
      if (!auction) return fail('이번 라운드에는 공개 입찰이 없습니다.');
      const amount = Math.floor(Number(cmd.amount));
      if (!Number.isFinite(amount) || amount < 0 || amount > cfg.auctionMaxBid) return fail(`입찰액은 0~${cfg.auctionMaxBid}코인입니다.`);
      if (amount > 0 && team.contracts.length >= cfg.contractLimit) return fail('계약 슬롯이 가득 차서 입찰할 수 없습니다.');
      if (amount > team.coins) return fail('보유 코인보다 큰 금액은 입찰할 수 없습니다.');
      team.bid = amount;
      auction.bids[team.id] = amount;
      return { ok: true };
    }
    default:
      break;
  }

  if (phase !== 'execute') return fail('실행 단계에만 행동할 수 있습니다.');
  if (team.actionsLeft <= 0) return fail('이번 라운드의 행동권을 모두 사용했습니다.');

  switch (cmd.type) {
    case 'procure': {
      const items = (cmd.items ?? []).filter((i) => Number.isInteger(i.units) && i.units > 0);
      if (!items.length) return fail('구매할 원료를 고르세요.');
      const kinds = new Set(items.map((i) => i.materialId));
      if (kinds.size !== items.length) return fail('같은 원료가 중복되었습니다.');
      if (kinds.size > cfg.procureMaxKinds) return fail(`한 번에 ${cfg.procureMaxKinds}종까지 살 수 있습니다.`);
      const total = items.reduce((a, i) => a + i.units, 0);
      if (total > cfg.procureMaxTotal) return fail(`한 번에 합계 ${cfg.procureMaxTotal}칸까지 살 수 있습니다.`);
      let cost = 0;
      for (const i of items) {
        if (!state.shopMaterials.includes(i.materialId)) return fail('이 공방에서 팔지 않는 원료입니다.');
        if (i.units > cfg.procureMaxPerKindPerRound) return fail(`한 종류는 라운드당 ${cfg.procureMaxPerKindPerRound}칸까지입니다.`);
        if ((team.purchasesThisRound[i.materialId] ?? 0) + i.units > cfg.procureMaxPerKindPerRound) return fail(`${MATERIALS[i.materialId]!.displayName}의 이번 라운드 할당량을 넘습니다.`);
        cost += priceOf(state, i.materialId) * i.units;
      }
      if (cost > availableCoins(team)) return fail(`코인이 부족합니다 (필요 ${cost}, 사용 가능 ${availableCoins(team)}).`);
      team.coins -= cost;
      for (const i of items) {
        receiveExternal(team, i.materialId, i.units, 'purchase', idGen);
        team.purchasesThisRound[i.materialId] = (team.purchasesThisRound[i.materialId] ?? 0) + i.units;
      }
      team.actionsLeft -= 1;
      pushLog(state, 'procure', `${team.name}: 원료 구매 −${cost}코인`, team.id);
      return { ok: true, consumedAction: true };
    }
    case 'buyEnergy': {
      const n = Math.floor(Number(cmd.bundles));
      if (!(n >= 1 && n <= cfg.energyBundleMax)) return fail(`에너지는 1~${cfg.energyBundleMax}묶음까지 살 수 있습니다.`);
      const cost = n * cfg.energyBundleCost;
      if (cost > availableCoins(team)) return fail('코인이 부족합니다.');
      if (team.energy >= cfg.energyCap) return fail('에너지 저장고가 가득 찼습니다.');
      team.coins -= cost;
      team.energy = Math.min(cfg.energyCap, team.energy + n * cfg.energyBundleAmount);
      team.actionsLeft -= 1;
      pushLog(state, 'procure', `${team.name}: 에너지 충전 −${cost}코인`, team.id);
      return { ok: true, consumedAction: true };
    }
    case 'react': {
      const r = REACTIONS[cmd.reactionId];
      if (!r || !state.activeReactions.includes(r.id)) return fail('이 공방에서 쓸 수 없는 반응입니다.');
      const scale = cmd.scale === 2 ? 2 : 1;
      if (r.requiredEquipment?.some((e) => !hasEquipment(team, e))) return fail(`필요 설비: ${r.requiredEquipment.map((e) => EQUIPMENT[e]!.name).join(', ')}`);
      const running = team.processes.filter((p) => p.kind === 'reaction').length;
      if (running >= reactionSlots(state, team)) return fail('빈 반응 슬롯이 없습니다.');
      const energy = reactionEnergy(state, r) * scale;
      if (team.energy < energy) return fail(`에너지 부족 (필요 ${energy}, 보유 ${team.energy}).`);
      const pick = pickReactantLots(team, r, scale);
      if (!pick.ok) return fail(pick.error);
      const before = team.lots.map((l) => ({ ...l }));
      const inputSolvent = consumePicks(team, pick.picks);
      if (pick.dissolveWater) {
        team.solventLedger.inflow += pick.dissolveWater;
        addWater(team.elementLedger.inflow, pick.dissolveWater);
      }
      const { outputs, solventOut } = computeReactionOutputs(r, scale, inputSolvent, pick.dissolveWater, idGen);
      team.energy -= energy;
      const time = reactionTime(state, r, team);
      const proc: RunningProcess = {
        id: idGen(), kind: 'reaction', defId: r.id, scale, startedRound: state.round, completesRound: state.round + time - 1,
        outputs, inputSummary: summarizeInputs(team, pick.picks, before), heatRecoverable: r.heatRecoverable, energySpent: energy, feePaid: 0, solventReleased: solventOut,
      };
      team.processes.push(proc);
      team.actionsLeft -= 1;
      team.reactionUse[r.id] = (team.reactionUse[r.id] ?? 0) + 1;
      pushLog(state, 'react', `${team.name}: ${r.name} ×${scale} 시작`, team.id);
      return { ok: true, consumedAction: true };
    }
    case 'process': {
      const pdef = PROCESSES[cmd.processId];
      if (!pdef) return fail('알 수 없는 공정입니다.');
      if (pdef.requiredEquipment && !hasEquipment(team, pdef.requiredEquipment)) return fail(`필요 설비: ${EQUIPMENT[pdef.requiredEquipment]!.name}`);
      const running = team.processes.filter((p) => p.kind === 'process').length;
      if (running >= cfg.processSlots) return fail('가공대가 사용 중입니다.');
      const lot = team.lots.find((l) => l.id === cmd.lotId);
      if (!lot) return fail('없는 로트입니다.');
      const energy = processEnergy(team, pdef.id);
      const fee = processFee(team, pdef.id);
      if (team.energy < energy) return fail(`에너지 부족 (필요 ${energy}).`);
      if (fee > availableCoins(team)) return fail(`수수료 ${fee}코인이 부족합니다.`);
      const res = applyProcess(pdef.id, lot, idGen);
      if (!res.ok) return fail(res.error);
      team.lots = team.lots.filter((l) => l.id !== lot.id);
      team.energy -= energy;
      team.coins -= fee;
      const proc: RunningProcess = {
        id: idGen(), kind: 'process', defId: pdef.id, scale: 1, startedRound: state.round, completesRound: state.round + pdef.time - 1,
        outputs: res.outputs, inputSummary: lotComponents(lot).map((c) => `${MATERIALS[c.materialId]!.formula} ${c.units}칸`).join(' + '), heatRecoverable: false, energySpent: energy, feePaid: fee, solventReleased: res.solventReleased,
      };
      team.processes.push(proc);
      team.actionsLeft -= 1;
      pushLog(state, 'process', `${team.name}: ${pdef.name} 시작`, team.id);
      return { ok: true, consumedAction: true };
    }
    case 'deliver': {
      const c = team.contracts.find((x) => x.id === cmd.contractId);
      if (!c) return fail('보유하지 않은 계약입니다.');
      const r = deliverContract(state, team, c);
      if (r.ok) team.actionsLeft -= 1;
      return r;
    }
    case 'equip': {
      const e = EQUIPMENT[cmd.equipmentId];
      if (!e || !state.activeEquipment.includes(e.id)) return fail('이 공방에서 쓸 수 없는 설비입니다.');
      if (hasEquipment(team, e.id)) return fail('이미 설치한 설비입니다.');
      const price = equipmentPrice(state, e.id);
      if (price > availableCoins(team)) return fail(`코인이 부족합니다 (가격 ${price}).`);
      team.coins -= price;
      team.equipment.push({ id: e.id, paid: price, leased: false, round: state.round });
      team.actionsLeft -= 1;
      pushLog(state, 'equip', `${team.name}: ${e.name} 설치 −${price}코인`, team.id);
      return { ok: true, consumedAction: true };
    }
    default:
      return fail('알 수 없는 명령입니다.');
  }
}
