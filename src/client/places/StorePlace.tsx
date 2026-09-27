import { useMemo, useState } from 'react';
import type { ClientView } from '../../shared/protocol';
import type { Lot, TeamCommand } from '../../shared/types';
import { MATERIALS } from '../../shared/chemistry/materials';
import { EQUIPMENT } from '../../shared/chemistry/equipment';
import { REACTIONS } from '../../shared/chemistry/reactions';
import { routesFor } from '../../shared/engine/reachability';
import { lotTagText, tagLabel } from '../../shared/engine/commands';
import { buybackShortfall, lotSellable, quoteBuyback } from '../../shared/engine/buyback';
import { Scene, Npc } from '../components/Scene';
import { AssetImage, CoinIcon, EnergyIcon, Formula } from '../components/common';
import { MaterialArt, ObjectArt } from '../components/Art';
import { mapFor, unmetRequirements } from '../components/Coach';
import { previewProps, type Place } from '../lib/places';
import { reactionStatus } from '../components/ReactionCard';

type Send = (cmd: TeamCommand, sfx?: string) => Promise<boolean>;
type Filter = 'rec' | 'all' | 'mat' | 'equip';

function EquipmentFallback() {
  return <svg className="eq-img" viewBox="0 0 64 64" aria-hidden><rect x="14" y="16" width="36" height="36" rx="8" fill="#1F6F78" /><circle cx="32" cy="34" r="9" fill="#F5F0E6" /></svg>;
}

const coinText = (mc: number) => (mc / 1000).toFixed(1).replace(/\.0$/, '');

function lotSource(l: Lot): string {
  if (l.grade === 'purchased') return '가게에서 산 것';
  if (l.grade === 'support') return l.tags.length ? `지원품 · ${lotTagText(l)}` : '지원품';
  return l.tags.map(tagLabel).join('/') || '만든 것';
}

/** 상점: 한 공간에서 '구입 / 재고 매입'을 전환한다. 새 장소나 상품 표 두 개를 만들지 않는다. */
export function StorePlace({ view, send, focusId, canAct, goTo, highlight }: { view: ClientView; send: Send; focusId: string | null; canAct: boolean; goTo: (p: Place) => void; highlight: string | null }) {
  const g = view.game!;
  const t = g.myTeam!;
  const cfg = g.config;
  const map = mapFor(view);
  const [mode, setMode] = useState<'buy' | 'sell'>('buy');
  const [filter, setFilter] = useState<Filter>('rec');
  const [basket, setBasket] = useState<Record<string, number>>({});
  const [sellBasket, setSellBasket] = useState<Record<string, number>>({});
  const [arrived, setArrived] = useState<string | null>(null);
  const [sold, setSold] = useState<string | null>(null);
  const focus = t.contracts.find((c) => c.id === focusId) ?? t.contracts[0] ?? null;
  const avail = t.coins - t.bid;
  const supportPending = !!t.support && t.support.status === 'pending' && t.support.round === g.round;
  const opNick = view.players.find((p) => p.id === t.operatorId)?.nick ?? '다른 팀원';

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
  /** 받은 의뢰 전부에 쓰일 재료량 (매입 경고용): 납품 물질 + 부족분을 만들 경로의 원료 */
  const contractNeeds = useMemo(() => {
    const need: Record<string, number> = {};
    for (const c of t.contracts) for (const req of c.requirements) {
      need[req.materialId] = (need[req.materialId] ?? 0) + req.units;
      if (!unmetRequirements(t, [req]).length) continue;
      const r = routesFor(map, req.materialId, req.tags).filter((x) => g.activeReactions.includes(x.reactionId)).sort((a, b) => a.rounds - b.rounds)[0];
      if (!r) continue;
      const batches = Math.ceil(req.units / r.yieldPerBatch);
      for (const inp of r.inputsPerBatch) need[inp.alternatives[0]!] = (need[inp.alternatives[0]!] ?? 0) + inp.units * batches;
    }
    return need;
  }, [t, map, g.activeReactions]);
  const usefulEquip = useMemo(() => {
    const set = new Set<string>();
    if (highlight?.startsWith('equip:')) set.add(highlight.slice(6));
    for (const rid of g.activeReactions) { const r = REACTIONS[rid]!; const st = reactionStatus(t, rid, g); if (st.reason === '장비 필요') for (const e of r.requiredEquipment ?? []) set.add(e); }
    if (t.processes.filter((p) => p.kind === 'reaction').length >= (g.reactionSlots ?? 2) + (t.equipment.some((e) => e.id === 'U01') ? 1 : 0)) set.add('U01');
    if (t.energy < 3) set.add('U02');
    return set;
  }, [g, t, highlight]);

  // ---------- 구입 ----------
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
  const buyReason = !canAct ? `이번 차례: ${opNick}` : supportPending ? '먼저 공방에서 연구지원품을 고르세요' : t.actionsLeft <= 0 ? '행동이 남지 않았어요' : items.length === 0 ? '바구니가 비었어요' : cost > avail ? `코인 부족 (${cost - avail} 더 필요)` : '';
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
    if (!canAct) return `이번 차례: ${opNick}`;
    if (supportPending) return '지원품 먼저';
    if (t.actionsLeft <= 0) return '행동 부족';
    if (price > avail) return `코인 부족 (${price - avail} 더 필요)`;
    return '';
  };
  const placement = (id: string) => id === 'U01' ? '작업대 3번 자리에 반응기가 생겨요' : ['U02', 'U03', 'U04', 'U08', 'U09', 'U10'].includes(id) ? '작업대 옆 장비 선반에 놓여요' : '작업대 오른쪽 장치 자리에 설치돼요';

  const products = [
    ...g.shopMaterials.map((m) => ({ kind: 'mat' as const, id: m, rec: (needed[m] ?? 0) > 0 })),
    ...g.activeEquipment.map((e) => ({ kind: 'equip' as const, id: e, rec: usefulEquip.has(e) && !t.equipment.some((x) => x.id === e) })),
  ];
  const hasRec = products.some((p) => p.rec);
  const eff: Filter = filter === 'rec' && !hasRec ? 'all' : filter;
  const shown = products.filter((p) => eff === 'all' || (eff === 'mat' && p.kind === 'mat') || (eff === 'equip' && p.kind === 'equip') || (eff === 'rec' && p.rec));

  // ---------- 재고 매입 ----------
  const bb = g.buyback;
  const sellable = t.lots.filter(lotSellable);
  const sellItems = Object.entries(sellBasket).filter(([, u]) => u > 0).map(([lotId, units]) => ({ lotId, units }));
  const quote = quoteBuyback({ ...fakeState(g), round: g.round } as never, t, sellItems);
  const unitQuote = (l: Lot) => quoteBuyback(fakeState(g) as never, t, [{ lotId: l.id, units: 1 }]).totalMc;
  const shortfall = buybackShortfall(t, sellItems, contractNeeds);
  const changeSell = (l: Lot, d: number) => {
    setSellBasket((c) => {
      const cur = c[l.id] ?? 0;
      const next = Math.max(0, Math.min(l.units, cur + d));
      if (d > 0) {
        const q = quoteBuyback(fakeState(g) as never, t, Object.entries({ ...c, [l.id]: next }).filter(([, u]) => u > 0).map(([lotId, units]) => ({ lotId, units })));
        if (q.ok && q.coins > q.roundLeft) return c; // 한도를 넘는 칸은 담지 않는다
      }
      return { ...c, [l.id]: next };
    });
  };
  const sellReason = !bb ? '이 경기에는 재고 매입이 없어요' : !canAct ? `이번 차례: ${opNick}` : supportPending ? '먼저 공방에서 연구지원품을 고르세요' : quote.usedThisRound ? '이번 라운드에는 이미 넘겼어요 (라운드 1회)' : quote.gameLeft <= 0 ? '이번 경기 매입 한도를 모두 썼어요' : sellItems.length === 0 ? '넘길 재료를 담으세요' : quote.coins <= 0 ? '0코인이에요. 수량을 늘리거나 보관하세요' : '';
  const sell = async () => {
    const coins = quote.coins;
    if (await send({ type: 'sellSurplus', items: sellItems, expectCoins: coins }, 'sfx-supply')) { setSellBasket({}); setSold(`+${coins}코인`); setTimeout(() => setSold(null), 2500); }
  };

  const line = mode === 'sell' ? '남는 재료를 낮은 가격에 받아 드릴게요. 대신 한도가 있어요.' : Object.keys(needed).length ? `"${focus?.title}"에 필요한 재료를 추천해 뒀어요. 한 번에 ${cfg.procureMaxKinds}종류, ${cfg.procureMaxTotal}개까지예요.` : '필요한 재료와 장비를 고르세요. 구경은 공짜예요.';

  return (
    <Scene place="store">
      <div className="place-grid store-grid">
        <div className="npc-col"><Npc place="store" line={line} /></div>
        <div className="place-main">
          <div className="filters" role="tablist" aria-label="상점 거래 종류">
            <span className="seg">
              <button role="tab" aria-selected={mode === 'buy'} className={`chip ${mode === 'buy' ? 'active' : ''}`} onClick={() => setMode('buy')}>구입</button>
              {bb && <button role="tab" aria-selected={mode === 'sell'} className={`chip ${mode === 'sell' ? 'active' : ''}`} onClick={() => setMode('sell')}>재고 매입</button>}
            </span>
            {mode === 'buy' && (['rec', 'all', 'mat', 'equip'] as Filter[]).map((f) => <button key={f} className={`chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>{{ rec: '추천', all: '전체', mat: '재료', equip: '장비' }[f]}</button>)}
            {mode === 'buy' && filter === 'rec' && !hasRec && <span className="small filter-note">주문을 받으면 필요한 재료를 추천해 드려요. 지금은 전체 상품이에요.</span>}
          </div>
          {mode === 'buy' ? (
            <div className="product-grid">
              {shown.map((p) => p.kind === 'mat' ? (
                <div key={p.id} className={`product ${p.rec ? 'rec' : ''}`}>
                  <div className="product-head">
                    <MaterialArt materialId={p.id} size={64} showPhase />
                    <span className="product-title"><b>{MATERIALS[p.id]!.displayName}</b> <Formula id={p.id} /></span>
                    <span className="row"><span className="tag tag-copper"><CoinIcon size={12} /> {g.prices[p.id]}/개</span>{p.rec && <span className="tag tag-amber">{needed[p.id]}개 필요</span>}</span>
                  </div>
                  <p className="product-desc">{MATERIALS[p.id]!.blurb}</p>
                  <div className="product-foot">
                    <div className="stepper"><button onClick={() => change(p.id, -1)} aria-label={`${MATERIALS[p.id]!.displayName} 빼기`}>−</button><span>{basket[p.id] ?? 0}</span><button onClick={() => change(p.id, 1)} aria-label={`${MATERIALS[p.id]!.displayName} 더하기`} disabled={(cfg.procureMaxPerKindPerRound - (t.purchasesThisRound[p.id] ?? 0)) <= 0}>+</button></div>
                    <span className="small muted">이번 라운드 {cfg.procureMaxPerKindPerRound - (t.purchasesThisRound[p.id] ?? 0)}개 더</span>
                  </div>
                </div>
              ) : (
                <div key={p.id} className={`product equip ${p.rec ? 'rec' : ''}`}>
                  <div className="product-head">
                    <AssetImage id={EQUIPMENT[p.id]!.imageId} alt="" className="eq-img" fallback={<EquipmentFallback />} />
                    <b>{EQUIPMENT[p.id]!.name}</b>
                    <span className="row"><span className="tag tag-copper"><CoinIcon size={12} /> {EQUIPMENT[p.id]!.price}</span>
                    {t.equipment.some((e) => e.id === p.id) && <span className="tag tag-teal">설치됨</span>}
                    {p.rec && !t.equipment.some((e) => e.id === p.id) && <span className="tag tag-amber">지금 유용</span>}</span>
                  </div>
                  <p className="product-desc">{EQUIPMENT[p.id]!.effect}<br /><span className="muted small">{placement(p.id)}</span></p>
                  <div className="row-between product-foot">
                    <span className="small muted">{equipReason(p.id)}</span>
                    <button className="btn btn-sm btn-primary" disabled={!!equipReason(p.id)} {...previewProps({ coins: -EQUIPMENT[p.id]!.price, actions: -1, label: EQUIPMENT[p.id]!.name })} onClick={() => buyEquip(p.id)}>장비 구입 · {EQUIPMENT[p.id]!.price}코인 / 행동 1</button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="sell-list">
              <p className="small sell-intro">남는 재료를 <b>낮은 가격</b>에 넘길 수 있어요. 구입가보다 싸고, <b>라운드 1회 · 라운드 {bb?.roundCap}코인 · 경기 {bb?.gameCap}코인</b> 한도가 있어요. 행동력은 들지 않아요. 섞인 것은 먼저 정리해야 해요.</p>
              {sellable.length === 0 && <p className="muted small">넘길 수 있는 재료가 없어요.</p>}
              <div className="product-grid">
                {sellable.map((l) => {
                  const q = unitQuote(l);
                  const need = contractNeeds[l.materialId!] ?? 0;
                  return (
                    <div key={l.id} className={`product sell ${need ? 'needed' : ''}`}>
                      <div className="product-head">
                        <MaterialArt lot={l} size={56} showPhase />
                        <span className="product-title"><b>{MATERIALS[l.materialId!]!.displayName}</b> <span className="muted small">{lotSource(l)}</span></span>
                        <span className="row"><span className="tag">창고 {l.units}개</span><span className="tag tag-copper">회수가 약 {coinText(q)}/개</span>{l.grade === 'purchased' && <span className="small muted">(구입가 {g.prices[l.materialId!] ?? '-'})</span>}</span>
                        {need > 0 && <span className="tag tag-amber">받은 의뢰에 필요 · {need}개</span>}
                      </div>
                      <div className="product-foot">
                        <div className="stepper"><button onClick={() => changeSell(l, -1)} aria-label={`${MATERIALS[l.materialId!]!.displayName} 빼기`}>−</button><span>{sellBasket[l.id] ?? 0}</span><button onClick={() => changeSell(l, 1)} aria-label={`${MATERIALS[l.materialId!]!.displayName} 담기`} disabled={(sellBasket[l.id] ?? 0) >= l.units}>+</button></div>
                        <button className="btn btn-sm btn-ghost" onClick={() => { for (let k = sellBasket[l.id] ?? 0; k < l.units; k++) changeSell(l, 1); }}>남는 것 모두</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <aside className="place-side">
          {mode === 'buy' ? (
            <section className="panel trade">
              <div className="panel-title">거래 카운터</div>
              {items.length === 0 ? <p className="muted small">재료를 담으면 여기에 보여요.{Object.keys(needed).length ? <> <button className="btn btn-sm btn-ghost" onClick={fillNeeded}>부족한 재료 담기</button></> : null}</p> : (
                <ul className="basket">{items.map((i) => <li key={i.materialId}><span className="basket-mat"><MaterialArt materialId={i.materialId} size={28} badge={false} />{MATERIALS[i.materialId]!.displayName} ×{i.units}</span><span>{(g.prices[i.materialId] ?? 0) * i.units}코인</span></li>)}</ul>
              )}
              <div className="row-between"><span className="small">모두 {total}개</span><b>{cost}코인</b></div>
              <button className="btn btn-primary btn-block" disabled={!!buyReason} {...previewProps({ coins: -cost, actions: -1 })} onClick={buy}>재료 구입 · {cost}코인 / 행동 1</button>
              {buyReason && <p className="small muted">{buyReason}</p>}
              {items.length > 0 && <button className="btn btn-sm btn-ghost" onClick={() => setBasket({})}>바구니 비우기</button>}
              <div className={`divider ${highlight === 'energy' ? 'hl' : ''}`} />
              <div className="small"><b>에너지 충전</b> — {cfg.energyBundleCost}코인에 <EnergyIcon size={12} /> {cfg.energyBundleAmount} (행동 1)</div>
              <div className="row">{[1, 2].slice(0, cfg.energyBundleMax).map((n) => <button key={n} className="btn btn-sm btn-ghost" disabled={!canAct || supportPending || t.actionsLeft <= 0 || avail < n * cfg.energyBundleCost || t.energy >= cfg.energyCap} {...previewProps({ coins: -n * cfg.energyBundleCost, energy: n * cfg.energyBundleAmount, actions: -1 })} onClick={() => send({ type: 'buyEnergy', bundles: n }, 'sfx-supply')}>{n}묶음 {n * cfg.energyBundleCost}코인</button>)}</div>
              {arrived && <div className="arrival" role="status"><ObjectArt id="obj-support-closed" size={28} variant="s" /> {arrived}이(가) 공방에 도착했어요 <button className="btn btn-sm btn-copper" onClick={() => goTo('workshop')}>공방으로 →</button></div>}
            </section>
          ) : (
            <section className="panel trade crate-panel">
              <div className="panel-title">회수 상자</div>
              <div className="crate-art">
                <ObjectArt id="obj-recycling-crate" size={150} variant="l" />
                <span className="crate-items" aria-hidden>{sellItems.slice(0, 6).map((i) => { const l = t.lots.find((x) => x.id === i.lotId)!; return <MaterialArt key={i.lotId} lot={l} size={34} badge={false} />; })}</span>
              </div>
              {sellItems.length === 0 ? <p className="muted small">넘길 재료를 담으면 실제 견적이 보여요.</p> : (
                <ul className="basket">{quote.lines.map((ln) => <li key={ln.lotId}><span className="basket-mat"><MaterialArt materialId={ln.materialId} size={28} badge={false} />{MATERIALS[ln.materialId]!.displayName} ×{ln.units}</span><span>{coinText(ln.mc)}코인</span></li>)}</ul>
              )}
              <div className="row-between"><span className="small">합계(내림)</span><b>{quote.coins}코인</b></div>
              <p className="small muted">이번 라운드 한도 {quote.roundLeft}코인 · 경기 남은 한도 {quote.gameLeft}코인 · 이번 라운드 매각 {quote.usedThisRound ? 0 : 1}/{bb?.perRound ?? 1}회 남음</p>
              {shortfall.length > 0 && <p className="small warn-box">넘기면 받은 의뢰에 {shortfall.map((s) => `${MATERIALS[s.materialId]!.displayName} ${s.short}개`).join(', ')}가 부족해져요. 그래도 넘길 수 있어요.</p>}
              <button className="btn btn-copper btn-block" disabled={!!sellReason} {...previewProps({ coins: quote.coins })} onClick={sell}>재고 넘기기 · +{quote.coins}코인 (행동력 없음)</button>
              {sellReason && <p className="small muted">{sellReason}</p>}
              {sellItems.length > 0 && <button className="btn btn-sm btn-ghost" onClick={() => setSellBasket({})}>회수 상자 비우기</button>}
              {sold && <div className="arrival" role="status">회수 완료 {sold}</div>}
            </section>
          )}
        </aside>
      </div>
    </Scene>
  );
}

/** 화면 견적을 서버와 같은 함수로 계산하기 위한 최소 상태 (기준 가치·매입 설정·라운드) */
function fakeState(g: NonNullable<ClientView['game']>) {
  return {
    round: g.round,
    roundsTotal: g.roundsTotal,
    buybackGameCap: g.buyback?.gameCap,
    config: { materialValues: g.materialValues, prices: g.prices, buyback: g.buyback ? { rate: g.buyback.rate, roundCap: g.buyback.roundCap, gameCap: g.buyback.gameCap, baseRounds: 10, perRound: g.buyback.perRound } : undefined },
  };
}
