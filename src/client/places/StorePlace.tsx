import { useMemo, useState } from 'react';
import type { ClientView } from '../../shared/protocol';
import type { TeamCommand } from '../../shared/types';
import { MATERIALS } from '../../shared/chemistry/materials';
import { EQUIPMENT } from '../../shared/chemistry/equipment';
import { REACTIONS } from '../../shared/chemistry/reactions';
import { routesFor } from '../../shared/engine/reachability';
import { Scene, Npc } from '../components/Scene';
import { AssetImage, CoinIcon, EnergyIcon, Mat } from '../components/common';
import { mapFor, unmetRequirements } from '../components/Coach';
import { previewProps, type Place } from '../lib/places';
import { reactionStatus } from '../components/ReactionCard';

type Send = (cmd: TeamCommand, sfx?: string) => Promise<boolean>;
type Filter = 'rec' | 'all' | 'mat' | 'equip';

function EquipmentFallback() {
  return <svg className="eq-img" viewBox="0 0 64 64" aria-hidden><rect x="14" y="16" width="36" height="36" rx="8" fill="#1F6F78" /><circle cx="32" cy="34" r="9" fill="#F5F0E6" /></svg>;
}

/** 상점: 재료와 장비를 하나의 진열 그리드에서 산다. 거래 패널은 하나, 재료와 장비는 별도 결제. */
export function StorePlace({ view, send, focusId, canAct, goTo, highlight }: { view: ClientView; send: Send; focusId: string | null; canAct: boolean; goTo: (p: Place) => void; highlight: string | null }) {
  const g = view.game!;
  const t = g.myTeam!;
  const cfg = g.config;
  const map = mapFor(view);
  const [filter, setFilter] = useState<Filter>('rec');
  const [basket, setBasket] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [arrived, setArrived] = useState<string | null>(null);
  const focus = t.contracts.find((c) => c.id === focusId) ?? t.contracts[0] ?? null;
  const avail = t.coins - t.bid;

  /** 집중 의뢰에 부족한 재료 (가장 짧은 경로 기준) */
  const needed = useMemo(() => {
    const need: Record<string, number> = {};
    if (!focus) return need;
    const stock: Record<string, number> = {};
    for (const l of t.lots) if (l.kind === 'pure') stock[l.materialId!] = (stock[l.materialId!] ?? 0) + l.units;
    for (const req of unmetRequirements(t, focus.requirements)) {
      const rs = routesFor(map, req.materialId, req.tags).filter((r) => g.activeReactions.includes(r.reactionId)).sort((a, b) => a.rounds - b.rounds);
      const r = rs[0];
      if (!r) continue;
      const batches = Math.ceil(req.units / r.yieldPerBatch);
      for (const inp of r.inputsPerBatch) {
        const have = inp.alternatives.reduce((a, alt) => a + (stock[alt] ?? 0), 0);
        const buy = Math.max(0, inp.units * batches - have);
        const shopMat = inp.alternatives.find((alt) => g.shopMaterials.includes(alt));
        if (buy > 0 && shopMat) need[shopMat] = (need[shopMat] ?? 0) + buy;
      }
    }
    return need;
  }, [focus, t, map, g]);
  const usefulEquip = useMemo(() => {
    const set = new Set<string>();
    if (highlight?.startsWith('equip:')) set.add(highlight.slice(6));
    for (const rid of g.activeReactions) { const r = REACTIONS[rid]!; const st = reactionStatus(t, rid, g); if (st.reason === '장비 필요') for (const e of r.requiredEquipment ?? []) set.add(e); }
    if (t.processes.filter((p) => p.kind === 'reaction').length >= 2 + (t.equipment.some((e) => e.id === 'U01') ? 1 : 0)) set.add('U01');
    if (t.energy < 3) set.add('U02');
    return set;
  }, [g, t, highlight]);

  const items = Object.entries(basket).filter(([, u]) => u > 0).map(([materialId, units]) => ({ materialId, units }));
  const total = items.reduce((a, i) => a + i.units, 0);
  const cost = items.reduce((a, i) => a + (g.prices[i.materialId] ?? 0) * i.units, 0);
  const change = (m: string, d: number) => {
    setBasket((c) => {
      const cur = c[m] ?? 0;
      const roomKind = cfg.procureMaxPerKindPerRound - (t.purchasesThisRound[m] ?? 0);
      const kinds = Object.entries(c).filter(([k, u]) => u > 0 && k !== m).length;
      let next = Math.max(0, Math.min(cur + d, roomKind));
      if (d > 0 && cur === 0 && kinds >= cfg.procureMaxKinds) next = 0;
      if (d > 0 && total + d > cfg.procureMaxTotal) next = cur;
      return { ...c, [m]: next };
    });
  };
  const fillNeeded = () => {
    const b: Record<string, number> = {};
    let tot = 0; let kinds = 0;
    for (const [m, u] of Object.entries(needed)) {
      if (kinds >= cfg.procureMaxKinds) break;
      const roomKind = cfg.procureMaxPerKindPerRound - (t.purchasesThisRound[m] ?? 0);
      const q = Math.min(u, roomKind, cfg.procureMaxTotal - tot);
      if (q <= 0) continue;
      b[m] = q; tot += q; kinds++;
    }
    setBasket(b);
  };
  const buyReason = !canAct ? `이번 차례: ${view.players.find((p) => p.id === t.operatorId)?.nick ?? '다른 팀원'}` : t.actionsLeft <= 0 ? '행동이 남지 않았어요' : items.length === 0 ? '바구니가 비었어요' : cost > avail ? `코인 부족 (${cost - avail} 더 필요)` : '';
  const buy = async () => {
    if (await send({ type: 'procure', items }, 'sfx-supply')) { setBasket({}); setArrived('재료'); setTimeout(() => setArrived(null), 2200); }
  };
  const buyEquip = async (id: string) => {
    if (await send({ type: 'equip', equipmentId: id }, 'sfx-achievement')) { setArrived(EQUIPMENT[id]!.name); setTimeout(() => setArrived(null), 2200); }
  };
  const equipReason = (id: string) => {
    const owned = t.equipment.find((e) => e.id === id);
    const price = EQUIPMENT[id]!.price;
    if (owned) return owned.leased ? '빌려 쓰는 중' : '이미 설치됨';
    if (!canAct) return `이번 차례: ${view.players.find((p) => p.id === t.operatorId)?.nick ?? '다른 팀원'}`;
    if (t.actionsLeft <= 0) return '행동 부족';
    if (price > avail) return `코인 부족 (${price - avail} 더 필요)`;
    return '';
  };
  const placement = (id: string) => id === 'U01' ? '작업대 3번 자리에 반응기가 생겨요' : ['U02', 'U03', 'U04', 'U08', 'U09', 'U10'].includes(id) ? '작업대 옆 장비 선반에 놓여요' : '작업대 오른쪽 장치 자리에 설치돼요';

  const products = [
    ...g.shopMaterials.map((m) => ({ kind: 'mat' as const, id: m, rec: (needed[m] ?? 0) > 0 })),
    ...g.activeEquipment.map((e) => ({ kind: 'equip' as const, id: e, rec: usefulEquip.has(e) && !t.equipment.some((x) => x.id === e) })),
  ];
  // 추천할 것이 없으면(받은 주문이 없을 때 등) 빈 진열대 대신 전체 상품을 보여 준다
  const hasRec = products.some((p) => p.rec);
  const eff: Filter = filter === 'rec' && !hasRec ? 'all' : filter;
  const shown = products.filter((p) => eff === 'all' || (eff === 'mat' && p.kind === 'mat') || (eff === 'equip' && p.kind === 'equip') || (eff === 'rec' && p.rec));
  const line = Object.keys(needed).length ? `"${focus?.title}"에 필요한 재료를 추천해 뒀어요. 한 번에 ${cfg.procureMaxKinds}종류, ${cfg.procureMaxTotal}개까지예요.` : '필요한 재료와 장비를 고르세요. 구경은 공짜예요.';

  return (
    <Scene place="store">
      <div className="place-grid store-grid">
        <div className="npc-col"><Npc place="store" line={line} /></div>
        <div className="place-main">
          <div className="filters" role="tablist">
            {(['rec', 'all', 'mat', 'equip'] as Filter[]).map((f) => <button key={f} role="tab" aria-selected={filter === f} className={`chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>{{ rec: '추천', all: '전체', mat: '재료', equip: '장비' }[f]}</button>)}
            {filter === 'rec' && !hasRec && <span className="small filter-note">주문을 받으면 필요한 재료를 추천해 드려요. 지금은 전체 상품이에요.</span>}
          </div>
          <div className="product-grid">
            {shown.map((p) => p.kind === 'mat' ? (
              <div key={p.id} className={`product ${selected === p.id ? 'sel' : ''} ${p.rec ? 'rec' : ''}`}>
                <button className="product-head" onClick={() => setSelected(selected === p.id ? null : p.id)}>
                  <span className="product-ico" aria-hidden>{MATERIALS[p.id]!.phase === 'g' ? '🫧' : MATERIALS[p.id]!.phase === 's' ? '🧱' : '🧪'}</span>
                  <Mat id={p.id} />
                  <span className="tag tag-copper"><CoinIcon size={12} /> {g.prices[p.id]}/개</span>
                  {p.rec && <span className="tag tag-amber">{needed[p.id]}개 필요</span>}
                </button>
                <div className="stepper"><button onClick={() => change(p.id, -1)} aria-label="빼기">−</button><span>{basket[p.id] ?? 0}</span><button onClick={() => change(p.id, 1)} aria-label="더하기" disabled={(cfg.procureMaxPerKindPerRound - (t.purchasesThisRound[p.id] ?? 0)) <= 0}>+</button></div>
                {selected === p.id && <p className="small muted product-desc">{MATERIALS[p.id]!.blurb} 이번 라운드 {cfg.procureMaxPerKindPerRound - (t.purchasesThisRound[p.id] ?? 0)}개 더 살 수 있어요.</p>}
              </div>
            ) : (
              <div key={p.id} className={`product equip ${selected === p.id ? 'sel' : ''} ${p.rec ? 'rec' : ''}`}>
                <button className="product-head" onClick={() => setSelected(selected === p.id ? null : p.id)}>
                  <AssetImage id={EQUIPMENT[p.id]!.imageId} alt="" className="eq-img" fallback={<EquipmentFallback />} />
                  <b>{EQUIPMENT[p.id]!.name}</b>
                  <span className="tag tag-copper"><CoinIcon size={12} /> {EQUIPMENT[p.id]!.price}</span>
                  {t.equipment.some((e) => e.id === p.id) && <span className="tag tag-teal">설치됨</span>}
                  {p.rec && !t.equipment.some((e) => e.id === p.id) && <span className="tag tag-amber">지금 유용</span>}
                </button>
                {selected === p.id && <p className="small product-desc">{EQUIPMENT[p.id]!.effect}<br /><span className="muted">{placement(p.id)}</span></p>}
                <div className="row-between">
                  <span className="small muted">{equipReason(p.id)}</span>
                  <button className="btn btn-sm btn-primary" disabled={!!equipReason(p.id)} {...previewProps({ coins: -EQUIPMENT[p.id]!.price, actions: -1, label: EQUIPMENT[p.id]!.name })} onClick={() => buyEquip(p.id)}>장비 구입 · {EQUIPMENT[p.id]!.price}코인 / 행동 1</button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <aside className="place-side">
          <section className="panel trade">
            <div className="panel-title">거래 카운터</div>
            {items.length === 0 ? <p className="muted small">재료를 담으면 여기에 보여요.{Object.keys(needed).length ? <> <button className="btn btn-sm btn-ghost" onClick={fillNeeded}>부족한 재료 담기</button></> : null}</p> : (
              <ul className="basket">{items.map((i) => <li key={i.materialId}><span>{MATERIALS[i.materialId]!.displayName} ×{i.units}</span><span>{(g.prices[i.materialId] ?? 0) * i.units}코인</span></li>)}</ul>
            )}
            <div className="row-between"><span className="small">모두 {total}개</span><b>{cost}코인</b></div>
            <button className="btn btn-primary btn-block" disabled={!!buyReason} {...previewProps({ coins: -cost, actions: -1 })} onClick={buy}>재료 구입 · {cost}코인 / 행동 1</button>
            {buyReason && <p className="small muted">{buyReason}</p>}
            {items.length > 0 && <button className="btn btn-sm btn-ghost" onClick={() => setBasket({})}>바구니 비우기</button>}
            <div className="divider" />
            <div className="small"><b>에너지 충전</b> — {cfg.energyBundleCost}코인에 <EnergyIcon size={12} /> {cfg.energyBundleAmount} (행동 1)</div>
            <div className="row">{[1, 2].slice(0, cfg.energyBundleMax).map((n) => <button key={n} className="btn btn-sm btn-ghost" disabled={!canAct || t.actionsLeft <= 0 || avail < n * cfg.energyBundleCost || t.energy >= cfg.energyCap} {...previewProps({ coins: -n * cfg.energyBundleCost, energy: n * cfg.energyBundleAmount, actions: -1 })} onClick={() => send({ type: 'buyEnergy', bundles: n }, 'sfx-supply')}>{n}묶음 {n * cfg.energyBundleCost}코인</button>)}</div>
            {arrived && <div className="arrival" role="status"><span className="parcel" aria-hidden>📦</span> {arrived}이(가) 공방에 도착했어요 <button className="btn btn-sm btn-copper" onClick={() => goTo('workshop')}>공방으로 →</button></div>}
          </section>
        </aside>
      </div>
    </Scene>
  );
}
