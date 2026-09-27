import { MATERIALS } from '../chemistry/materials';
import { REACTIONS } from '../chemistry/reactions';

/**
 * 물질별 기준 회수가치(코인)를 가격표와 반응 골격에서 유도한다.
 * - 상점 물질: 상점 기본가.
 * - 만들어지는 물질: 가장 싼 경로의 (투입 원료 가치 + 에너지 비용) ÷ 배치 산출 칸 수. 여러 경로 중 최솟값.
 * 이 값은 잉여 재고 매입의 상한 기준과 연구지원품 추정가치에만 쓰인다. 계약 보상·상점 가격을 바꾸지 않는다.
 */
export function deriveMaterialValues(prices: Record<string, number>, energyUnitCost: number): Record<string, number> {
  const v: Record<string, number> = {};
  for (const id of Object.keys(MATERIALS)) v[id] = prices[id] ?? Number.POSITIVE_INFINITY;
  for (let pass = 0; pass < 12; pass++) {
    let changed = false;
    for (const r of Object.values(REACTIONS)) {
      let cost = 0;
      let ok = true;
      for (const s of r.reactants) {
        const best = Math.min(...s.accepts.map((a) => v[a] ?? Number.POSITIVE_INFINITY));
        if (!Number.isFinite(best)) { ok = false; break; }
        cost += best * s.coef * r.batchMultiplier;
      }
      if (!ok) continue;
      cost += r.energy * energyUnitCost;
      const units = r.outputs.reduce((a, st) => a + st.products.reduce((b, p) => b + p.coef, 0), 0);
      if (units <= 0) continue;
      const per = cost / units;
      for (const st of r.outputs) for (const p of st.products) {
        if (per < (v[p.materialId] ?? Number.POSITIVE_INFINITY) - 1e-9) { v[p.materialId] = per; changed = true; }
      }
    }
    // 가공으로 얻는 순물질 (응축·결정·정제): 원래 물질 가치를 그대로 잇는다
    const link = (from: string, to: string) => { if ((v[from] ?? Infinity) < (v[to] ?? Infinity) - 1e-9) { v[to] = v[from]!; changed = true; } };
    link('H2O_g', 'H2O_l');
    link('NaCl_aq', 'NaCl_s');
    link('ethanol_aq', 'ethanol_l');
    if (!changed) break;
  }
  const out: Record<string, number> = {};
  for (const [id, x] of Object.entries(v)) out[id] = Number.isFinite(x) ? Math.max(0.1, Math.round(x * 10) / 10) : 1;
  return out;
}
