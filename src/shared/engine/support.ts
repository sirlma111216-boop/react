import type { CommandResult, GameState, ReactionDefinition, SupportBundle, SupportConfig, SupportGrant, SupportItem, SupportKind, TeamState } from '../types';
import { REACTIONS } from '../chemistry/reactions';
import { CONTRACTS } from '../chemistry/contracts';
import { MATERIALS } from '../chemistry/materials';
import { subRng, type Rng } from './rng';
import { hasEquipment, isV3, makeIdGen, priceOf, pushLog, receiveExternal, supportBasisMc } from './state';
import type { ReachabilityMap } from './reachability';
import { materialValue } from './value';

/**
 * 길드 연구지원품 (V3). 매 라운드 처음 팀마다 세 묶음(완성 소재 · 공정 재료 · 기초 원료)이 공방으로 배송된다.
 * 담당자가 1묶음을 통째로 반송하고 나머지 2묶음만 실제 재고로 받는다. 낱개 골라 담기·재추첨·되돌리기는 없다.
 * 내용은 서버가 (시드, 라운드, 팀)으로 만들어 저장하므로 새로고침·재접속·기기 변경으로 바뀌지 않는다.
 * 공정성: 같은 라운드 같은 종류 묶음은 팀과 무관한 공통 가치 예산 ±tolerance 안에서 고른다(비슷한 가치, 다른 내용).
 */

export const SUPPORT_KINDS: SupportKind[] = ['finished', 'process', 'basic'];
export const SUPPORT_KIND_LABEL: Record<SupportKind, string> = { finished: '완성 소재 상자', process: '공정 재료 상자', basic: '기초 원료 상자' };

const lotGen = makeIdGen('S');

export const DEFAULT_SUPPORT: SupportConfig = {
  finishedUnits: 1, processUnits: [2, 3], basicUnits: [8, 10], tolerance: 0.15,
  weight: { finished: 1, process: 1.25, basic: 1 }, finishedExclude: ['ethylAcetate_l', 'NH4Cl_s'],
};

function cfg(state: GameState): SupportConfig {
  return state.config.support ?? DEFAULT_SUPPORT;
}

export function supportPending(state: GameState, team: TeamState): boolean {
  return isV3(state) && !!team.support && team.support.status === 'pending' && team.support.round === state.round;
}

/** 팀이 지금 쓸 수 있는 활성 반응 (필수 장비를 가진 것만) */
function usableReactions(state: GameState, team: TeamState | null): ReactionDefinition[] {
  return state.activeReactions.map((id) => REACTIONS[id]!).filter((r) => !(r.requiredEquipment ?? []).some((e) => !team || !hasEquipment(team, e)));
}

/** 활성 계약 조건 가운데 지원품 완성 소재를 허용하는 것 */
function supportRequirements(state: GameState): { materialId: string; tag: string; unitValue: number; units: number }[] {
  const out: { materialId: string; tag: string; unitValue: number; units: number }[] = [];
  for (const cid of state.activeContracts) {
    const t = CONTRACTS[cid]!;
    const total = t.requirements.reduce((a, r) => a + r.units, 0);
    const reward = state.config.contractRewards[cid] ?? t.reward;
    for (const r of t.requirements) if (r.allowSupport) out.push({ materialId: r.materialId, tag: r.tags[0]!, unitValue: reward / Math.max(1, total), units: r.units });
  }
  return out;
}

/**
 * 물질을 계약 납품까지 연결하는 데 드는 최소 라운드 (반응 경로 + 납품). 계약으로 이어지지 않는 dead-end 는 Infinity.
 * 직접 원료(경로 입력)면 그 경로의 라운드, 중간물이면 한 단계 앞 반응 시간을 더한다 (최대 3단계).
 */
function roundsToUse(map: ReachabilityMap, usable: ReactionDefinition[], materialId: string, contractMats: Set<string>): number {
  let best = Number.POSITIVE_INFINITY;
  const direct = (m: string): number => {
    let b = Number.POSITIVE_INFINITY;
    for (const [key, routes] of map.routes) {
      const mat = key.split('|')[0]!;
      if (!contractMats.has(mat)) continue;
      for (const r of routes) if (r.inputsPerBatch.some((i) => i.alternatives.includes(m))) b = Math.min(b, r.rounds);
    }
    return b;
  };
  best = direct(materialId);
  if (Number.isFinite(best)) return best;
  // 중간물: m 을 쓰는 반응의 산출이 다른 경로의 원료가 되는가
  const frontier: { m: string; extra: number }[] = [{ m: materialId, extra: 0 }];
  const seen = new Set<string>([materialId]);
  for (let depth = 0; depth < 3 && frontier.length; depth++) {
    const next: { m: string; extra: number }[] = [];
    for (const f of frontier) {
      for (const r of usable) {
        if (!r.reactants.some((s) => s.accepts.includes(f.m))) continue;
        for (const st of r.outputs) for (const p of st.products) {
          if (seen.has(p.materialId)) continue;
          seen.add(p.materialId);
          const d = direct(p.materialId);
          if (Number.isFinite(d)) best = Math.min(best, d + r.time + f.extra);
          next.push({ m: p.materialId, extra: f.extra + r.time });
        }
      }
    }
    frontier.splice(0, frontier.length, ...next);
  }
  return best;
}

interface Pools {
  basic: Set<string>;
  process: Set<string>;
  finished: { materialId: string; tag: string; value: number }[];
  usable: ReactionDefinition[];
  contractReactions: Set<string>;
}

/** 지원품 풀: 모드·시나리오에서 활성인 반응/계약만, 남은 라운드 안에 쓸 수 있는 물질만 */
export function supportPools(state: GameState, team: TeamState | null, map: ReachabilityMap, remaining: number): Pools {
  const c = cfg(state);
  const usable = usableReactions(state, team);
  const reqs = supportRequirements(state);
  const contractMats = new Set(state.activeContracts.flatMap((cid) => CONTRACTS[cid]!.requirements.map((r) => r.materialId)));
  const consumed = new Set<string>();
  for (const r of usable) for (const s of r.reactants) for (const a of s.accepts) consumed.add(a);
  const timely = (m: string) => roundsToUse(map, usable, m, contractMats) <= remaining;
  const cheap = (m: string) => state.shopMaterials.includes(m) && (state.config.prices[m] ?? 9) <= 2;
  const basic = new Set<string>();
  const process = new Set<string>();
  for (const m of consumed) {
    if (!MATERIALS[m]) continue;
    // 이 모드에서 살 수도 만들 수도 없는 상태(예: 클래식의 염화칼슘 수용액)는 주지 않는다
    if (!state.shopMaterials.includes(m) && !map.producible.has(m)) continue;
    if (!timely(m)) continue;
    if (cheap(m)) basic.add(m);
    else process.add(m);
  }
  const contractReactions = new Set<string>();
  for (const [key, routes] of map.routes) if (contractMats.has(key.split('|')[0]!)) for (const r of routes) contractReactions.add(r.reactionId);
  const finished: Pools['finished'] = [];
  for (const r of reqs) {
    if (c.finishedExclude.includes(r.materialId) || r.units < 2) continue;
    if (!map.producible.has(r.materialId)) continue;
    if (finished.some((f) => f.materialId === r.materialId)) {
      const f = finished.find((x) => x.materialId === r.materialId)!;
      f.value = Math.max(f.value, r.unitValue * 0.5);
      continue;
    }
    finished.push({ materialId: r.materialId, tag: r.tag, value: r.unitValue * 0.5 });
  }
  return { basic, process, finished, usable, contractReactions };
}

/** 원료의 활용가치: 상점에서 다시 사는 값(상점 물질) 또는 유도한 기준 가치(만들어야 하는 물질) */
export function replacementValue(state: GameState, materialId: string): number {
  return state.shopMaterials.includes(materialId) ? state.config.prices[materialId] ?? materialValue(state, materialId) : materialValue(state, materialId);
}

function itemsValue(state: GameState, kind: SupportKind, items: SupportItem[], pools: Pools): number {
  const w = cfg(state).weight[kind];
  let v = 0;
  for (const it of items) {
    if (kind === 'finished') v += (pools.finished.find((f) => f.materialId === it.materialId)?.value ?? materialValue(state, it.materialId)) * it.units;
    else v += replacementValue(state, it.materialId) * it.units;
  }
  return Math.round(v * w * 10) / 10;
}

/** 계수 비율을 유지하며 합계 total 칸으로 나눈다 (각 항목 최소 1칸) */
function scaleRatio(parts: { materialId: string; coef: number }[], total: number): SupportItem[] {
  const sum = parts.reduce((a, p) => a + p.coef, 0);
  const raw = parts.map((p) => ({ materialId: p.materialId, x: (p.coef / sum) * total }));
  const items = raw.map((r) => ({ materialId: r.materialId, units: Math.max(1, Math.floor(r.x)), tags: [] as string[] }));
  let left = total - items.reduce((a, i) => a + i.units, 0);
  const order = raw.map((r, i) => ({ i, frac: r.x - Math.floor(r.x) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; left > 0 && k < order.length * 3; k++) { items[order[k % order.length]!.i]!.units++; left--; }
  while (left < 0) { const big = items.reduce((a, b) => (b.units > a.units ? b : a)); if (big.units <= 1) break; big.units--; left++; }
  return items.filter((i) => i.units > 0);
}

/** 한 종류 묶음의 후보들 (결정적 목록). 팀과 무관한 예산 계산과 팀별 추첨에 모두 쓴다. */
function candidates(state: GameState, kind: SupportKind, pools: Pools): { items: SupportItem[]; recipe?: string }[] {
  const c = cfg(state);
  const out: { items: SupportItem[]; recipe?: string }[] = [];
  if (kind === 'finished') {
    for (const f of pools.finished) out.push({ items: [{ materialId: f.materialId, units: c.finishedUnits, tags: [f.tag] }] });
    return out;
  }
  const [lo, hi] = kind === 'basic' ? c.basicUnits : c.processUnits;
  const partsOf = (r: ReactionDefinition) => {
    const parts: { materialId: string; coef: number }[] = [];
    let complete = true;
    for (const s of r.reactants) {
      const pick = s.accepts.find((a) => (kind === 'basic' ? pools.basic.has(a) : pools.process.has(a) || (pools.basic.has(a) && (state.config.prices[a] ?? 1) >= 2)));
      if (pick && !parts.some((p) => p.materialId === pick)) parts.push({ materialId: pick, coef: s.coef * r.batchMultiplier });
      if (!pick) complete = false;
    }
    return { parts, complete };
  };
  // 기초 원료 상자는 그 자체로 한 반응을 돌릴 수 있는 완전한 조합을 우선한다 (없을 때만 일부 조합)
  const recipes = pools.usable.map((r) => ({ r, ...partsOf(r) })).filter((x) => x.parts.length);
  const useRecipes = kind === 'basic' && recipes.some((x) => x.complete) ? recipes.filter((x) => x.complete) : recipes;
  for (const { r, parts } of useRecipes) {
    if (kind === 'process' && !parts.some((p) => pools.process.has(p.materialId))) continue;
    for (let total = lo; total <= hi; total++) {
      const items = scaleRatio(parts, total);
      if (items.reduce((a, i) => a + i.units, 0) !== total) continue;
      out.push({ items, recipe: r.id });
      // 기초 원료는 2~3종 조합을 권장: 다른 반응의 기초 원료 1~2칸을 곁들인 변형
      if (kind === 'basic' && items.length === 1 && total >= lo + 1) {
        for (const extra of pools.basic) {
          if (extra === items[0]!.materialId) continue;
          for (const add of [1, 2]) {
            if (total - add < 1) continue;
            out.push({ items: [{ ...items[0]!, units: total - add }, { materialId: extra, units: add, tags: [] }], recipe: r.id });
          }
        }
      } else if (kind === 'basic' && items.length === 2 && total >= lo + 1) {
        for (const extra of pools.basic) {
          if (items.some((i) => i.materialId === extra)) continue;
          const scaled = scaleRatio(parts, total - 1);
          if (scaled.reduce((a, i) => a + i.units, 0) === total - 1) out.push({ items: [...scaled, { materialId: extra, units: 1, tags: [] }], recipe: r.id });
        }
      }
    }
  }
  return out;
}

/**
 * 같은 라운드 모든 팀에 공통인 종류별 가치 예산.
 * 라운드마다 (시드, 라운드, 종류)로 후보 하나의 가치를 기준으로 삼아, 라운드마다 다른 계열이 오되 한 라운드 안에서는 가치가 비슷하게 한다.
 */
export function supportBudget(state: GameState, map: ReachabilityMap, round: number): Record<SupportKind, number> {
  const remaining = state.roundsTotal - round + 1;
  const pools = supportPools(state, null, map, remaining);
  const loose = pools.basic.size + pools.process.size === 0 ? supportPools(state, null, map, 99) : pools;
  const out = {} as Record<SupportKind, number>;
  for (const k of SUPPORT_KINDS) {
    const values = candidates(state, k, loose).map((c) => itemsValue(state, k, c.items, loose));
    out[k] = values.length ? subRng(state.seed, 'support-budget', round, k).pick(values) : 0;
  }
  return out;
}

/** 두 묶음을 받았을 때 합법 생산 경로가 생기는가 (부족분은 한 번의 구매로 채울 수 있어야 한다) */
export function pairHasPath(state: GameState, team: TeamState, items: SupportItem[], pools: Pools, strict: boolean): boolean {
  const stock: Record<string, number> = {};
  for (const l of team.lots) if (l.kind === 'pure') stock[l.materialId!] = (stock[l.materialId!] ?? 0) + l.units;
  for (const it of items) stock[it.materialId] = (stock[it.materialId] ?? 0) + it.units;
  const supplied = new Set(items.map((i) => i.materialId));
  const cfgE = state.config;
  for (const r of pools.usable) {
    if (!r.reactants.some((s) => s.accepts.some((a) => supplied.has(a)))) continue;
    if (strict && !pools.contractReactions.has(r.id)) continue;
    if (team.energy < (cfgE.reactionEnergy[r.id] ?? r.energy)) continue;
    let cost = 0; let kinds = 0; let total = 0; let ok = true;
    for (const s of r.reactants) {
      const need = s.coef * r.batchMultiplier;
      const have = s.accepts.reduce((a, alt) => a + (stock[alt] ?? 0), 0);
      const short = need - have;
      if (short <= 0) continue;
      const shop = s.accepts.find((a) => state.shopMaterials.includes(a));
      if (!shop || short > cfgE.procureMaxPerKindPerRound) { ok = false; break; }
      cost += priceOf(state, shop) * short; kinds++; total += short;
    }
    if (!ok || kinds > cfgE.procureMaxKinds || total > cfgE.procureMaxTotal || cost > team.coins) continue;
    return true;
  }
  return false;
}

/** 서버가 라운드 시작에 팀별 지원품을 만든다 (시드·라운드·팀 결정적). */
export function generateSupport(state: GameState, team: TeamState, map: ReachabilityMap, budget?: Record<SupportKind, number>): SupportGrant {
  const c = cfg(state);
  const round = state.round;
  const remaining = state.roundsTotal - round + 1;
  let pools = supportPools(state, team, map, remaining);
  // 후반이라 남은 라운드 안에 쓸 물질이 없으면 시간 제약을 풀고 다시 (빈 상자를 보내지 않는다)
  if (pools.basic.size === 0 || pools.process.size === 0) pools = supportPools(state, team, map, 99);
  const bud = budget ?? supportBudget(state, map, round);
  const strict = round === 1;
  let best: { bundles: SupportBundle[]; score: number } | null = null;
  for (let attempt = 0; attempt < 24; attempt++) {
    const rng = subRng(state.seed, 'support', round, team.id, attempt);
    const bundles = SUPPORT_KINDS.map((k) => drawBundle(state, k, pools, bud[k], c.tolerance, rng));
    if (bundles.some((b) => !b.items.length)) continue;
    const pairs: [number, number][] = [[0, 1], [0, 2], [1, 2]];
    const okPairs = pairs.filter(([a, b]) => pairHasPath(state, team, [...bundles[a]!.items, ...bundles[b]!.items], pools, strict)).length;
    const devi = bundles.reduce((acc, b) => acc + Math.abs(b.value - bud[b.kind]) / Math.max(1, bud[b.kind]), 0);
    const score = okPairs * 10 - devi;
    if (!best || score > best.score) best = { bundles, score };
    if (okPairs === 3 && bundles.every((b) => Math.abs(b.value - bud[b.kind]) <= bud[b.kind] * c.tolerance + 0.05)) break;
  }
  const bundles = best?.bundles ?? SUPPORT_KINDS.map((k) => ({ kind: k, items: [], value: 0 }));
  return { grantId: `S${round}-${team.id}`, round, bundles, status: 'pending', returnedIndex: null, resolvedBy: null, budget: bud };
}

function drawBundle(state: GameState, kind: SupportKind, pools: Pools, budget: number, tol: number, rng: Rng): SupportBundle {
  const cands = candidates(state, kind, pools).map((c) => ({ ...c, value: itemsValue(state, kind, c.items, pools) }));
  if (!cands.length) return { kind, items: [], value: 0 };
  const within = cands.filter((c) => Math.abs(c.value - budget) <= budget * tol + 0.05);
  const pool = within.length ? within : [...cands].sort((a, b) => Math.abs(a.value - budget) - Math.abs(b.value - budget)).slice(0, 3);
  const pick = rng.pick(pool);
  return { kind, items: pick.items.map((i) => ({ ...i, tags: [...i.tags] })), value: pick.value, recipe: pick.recipe };
}

/** 담당자(또는 교사 대리)가 1묶음을 반송하고 나머지 2묶음을 받는다. 정확히 1회. */
export function chooseSupport(state: GameState, team: TeamState, grantId: string, returnIndex: number, by: 'operator' | 'teacher'): CommandResult {
  const g = team.support;
  if (!g || g.round !== state.round) return { ok: false, error: '이번 라운드 지원품이 없어요.' };
  if (g.status !== 'pending') return { ok: false, error: g.status === 'received' ? '이미 이번 라운드 지원품을 받았어요.' : '이번 라운드 지원품은 수령을 포기했어요.' };
  if (grantId !== g.grantId) return { ok: false, error: '지원품 정보가 바뀌었어요. 화면을 새로 확인해 주세요.' };
  const idx = Math.floor(Number(returnIndex));
  if (!(idx >= 0 && idx < g.bundles.length)) return { ok: false, error: '반송할 묶음을 하나 고르세요.' };
  let kept = 0;
  g.bundles.forEach((b, i) => {
    if (i === idx) return;
    kept += b.value;
    for (const it of b.items) receiveExternal(team, it.materialId, it.units, 'support', lotGen, { tags: it.tags, basisMc: supportBasisMc(state, it.materialId, it.units) });
  });
  g.status = 'received';
  g.returnedIndex = idx;
  g.resolvedBy = by;
  (team.supportHistory ??= []).push({ round: state.round, grantId: g.grantId, status: 'received', returnedKind: g.bundles[idx]!.kind, keptValue: Math.round(kept * 10) / 10, resolvedBy: by });
  // 반송품은 외부 반출 기록만 남긴다 (재고에 잠깐 넣었다 빼지 않는다)
  pushLog(state, 'support', `${team.name}: 연구지원품 수령 · ${SUPPORT_KIND_LABEL[g.bundles[idx]!.kind]} 반송${by === 'teacher' ? ' (교사 대리 선택)' : ''}`, team.id);
  return { ok: true, consumedAction: false };
}

/** 이번 라운드 지원품 수령 포기 (교사 건너뛰기·조기 종료·라운드 마무리 시 미선택). 몰래 추첨하지 않는다. */
export function forfeitSupport(state: GameState, team: TeamState, reason: string): boolean {
  const g = team.support;
  if (!g || g.status !== 'pending') return false;
  g.status = 'forfeited';
  g.resolvedBy = 'forfeit';
  (team.supportHistory ??= []).push({ round: g.round, grantId: g.grantId, status: 'forfeited', returnedKind: null, keptValue: 0, resolvedBy: 'forfeit' });
  pushLog(state, 'support', `${team.name}: 이번 라운드 연구지원품 수령 포기 (${reason})`, team.id);
  return true;
}

/** 표시·로그용 한 줄 요약 */
export function bundleText(b: SupportBundle): string {
  return b.items.map((i) => `${MATERIALS[i.materialId]?.displayName ?? i.materialId} ${i.units}개`).join(' + ');
}
