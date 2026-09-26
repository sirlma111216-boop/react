import { useEffect, useState } from 'react';
import type { ClientView } from '../../shared/protocol';
import type { ContractInstance, TeamCommand, TeamState } from '../../shared/types';
import { MATERIALS } from '../../shared/chemistry/materials';
import { CONTRACTS, CATEGORY_LABEL } from '../../shared/chemistry/contracts';
import { contractSatisfiable, tagLabel } from '../../shared/engine/commands';
import { contractPayout, contractCategory, MARKET_STEP } from '../../shared/engine/market';
import { Scene, Npc } from '../components/Scene';
import { previewProps, type Place } from '../lib/places';

type Send = (cmd: TeamCommand, sfx?: string) => Promise<boolean>;

/** 서버가 고를 로트를 같은 규칙으로 미리 보여준다 (구매 로트 제외, 조건 태그 일치, 앞에서부터) */
function plannedLots(team: TeamState, c: ContractInstance): { materialId: string; units: number; tags: string[] }[] {
  const out: { materialId: string; units: number; tags: string[] }[] = [];
  const used: Record<string, number> = {};
  for (const req of c.requirements) {
    let need = req.units;
    for (const lot of team.lots) {
      if (need <= 0) break;
      if (lot.kind !== 'pure' || lot.materialId !== req.materialId || lot.grade === 'purchased' || !lot.tags.some((t) => req.tags.includes(t))) continue;
      const take = Math.min(lot.units - (used[lot.id] ?? 0), need);
      if (take > 0) { out.push({ materialId: req.materialId, units: take, tags: lot.tags }); used[lot.id] = (used[lot.id] ?? 0) + take; need -= take; }
    }
  }
  return out;
}

export function ShippingPlace({ view, send, focusId, setFocus, canAct, goTo, highlight }: { view: ClientView; send: Send; focusId: string | null; setFocus: (id: string | null) => void; canAct: boolean; goTo: (p: Place) => void; highlight: string | null }) {
  const g = view.game!;
  const t = g.myTeam!;
  const initial = highlight?.startsWith('contract:') ? highlight.slice(9) : focusId;
  const [selId, setSelId] = useState<string | null>(initial && t.contracts.some((c) => c.id === initial) ? initial : t.contracts[0]?.id ?? null);
  const [stamp, setStamp] = useState<string | null>(null);
  const [showTrend, setShowTrend] = useState(false);
  useEffect(() => { if (selId && !t.contracts.some((c) => c.id === selId)) setSelId(t.contracts[0]?.id ?? null); }, [t.contracts, selId]);
  const sel = t.contracts.find((c) => c.id === selId) ?? null;
  const sat = sel ? contractSatisfiable(t, sel) : null;
  const pay = sel ? contractPayout(g, sel) : null;
  const cat = sel ? contractCategory(sel) : null;
  const hist = cat ? g.marketHistory[cat] ?? [0] : [0];
  const prevZ = hist.length >= 2 ? hist[hist.length - 2]! : null;
  const z = pay?.z ?? 0;
  const arrow = prevZ === null ? '' : z > prevZ ? '↑' : z < prevZ ? '↓' : '→';
  const lastRound = g.round >= g.roundsTotal;
  const mixtures = t.lots.filter((l) => l.kind === 'mixture' || (l.kind === 'pure' && l.materialId === 'H2O_g'));
  const planned = sel ? plannedLots(t, sel) : [];
  const deliverReason = !sel ? '주문을 고르세요' : !canAct ? `이번 차례: ${view.players.find((p) => p.id === t.operatorId)?.nick ?? '다른 팀원'}` : t.actionsLeft <= 0 ? '행동이 남지 않았어요' : !sat?.ok ? '' : '';
  const deliver = async () => {
    if (!sel) return;
    const title = sel.title; const total = pay?.total ?? 0;
    if (await send({ type: 'deliver', contractId: sel.id, quoteVersion: g.round }, 'sfx-delivery')) { setStamp(`${title} · +${total}코인`); setTimeout(() => setStamp(null), 2500); if (focusId === sel.id) setFocus(null); }
  };
  const line = !t.contracts.length ? '배달할 주문이 아직 없네요. 의뢰소에서 주문을 받아 오세요.' : sat?.ok ? '검수 완료! 지금 배달할까요, 시세를 보고 다음 라운드에 할까요?' : '준비되면 여기서 검수해 드릴게요. 부족한 것은 아래에 적혀 있어요.';

  return (
    <Scene place="shipping">
      <div className="place-grid shipping-grid">
        <div className="npc-col"><Npc place="shipping" line={line} /></div>
        <div className="place-main">
          <section className="panel dock" aria-label="출하대">
            <div className="panel-title">출하대 {sel && <span className="muted small" style={{ textTransform: 'none' }}>{sel.title}</span>}</div>
            {!sel && <p className="muted small">오른쪽 운송 서류에서 주문을 고르세요.</p>}
            {sel && (
              <>
                <div className="dock-items">
                  {sel.requirements.map((req, i) => {
                    const have = planned.filter((p) => p.materialId === req.materialId).reduce((a, p) => a + p.units, 0);
                    const ok = have >= req.units;
                    return (
                      <div key={i} className={`crate ${ok ? 'ok' : 'missing'}`}>
                        <span className="crate-ico" aria-hidden>{ok ? '📦' : '▢'}</span>
                        <b>{MATERIALS[req.materialId]!.displayName}</b>
                        <span className="small">{Math.min(have, req.units)}/{req.units}개 · {req.tags.map(tagLabel).join('/')}</span>
                        {ok && <span className="tag tag-teal">✓ 검수 통과</span>}
                      </div>
                    );
                  })}
                </div>
                {sat && !sat.ok && (
                  <div className="small" style={{ background: 'var(--amber-soft)', padding: 8, borderRadius: 8 }}>
                    아직 부족: {sat.missing.join(', ')}.
                    {mixtures.length > 0 && <> 정리하지 않은 것이 {mixtures.length}개 있어요. <button className="btn btn-sm btn-ghost" onClick={() => goTo('workshop')}>공방에서 정리하기 →</button></>}
                    {mixtures.length === 0 && <> <button className="btn btn-sm btn-ghost" onClick={() => goTo('workshop')}>공방에서 만들기 →</button></>}
                  </div>
                )}
              </>
            )}
            {stamp && <div className="stamp" role="status">✔ 배달 완료 — {stamp}</div>}
          </section>
          {sel && pay && (
            <section className="panel price">
              <div className="panel-title">이번 라운드 수령액</div>
              {pay.fixed ? <p><b>{pay.total}코인</b> <span className="small muted">(고정가 주문)</span></p> : (
                <p className="price-line">기본금 {pay.base} {pay.adjust >= 0 ? '+' : '−'} 시장 {Math.abs(pay.adjust)}{pay.bonus ? ` + 보너스 ${pay.bonus}` : ''} = <b>{pay.total}코인</b> <span className="tag">{CATEGORY_LABEL[cat as keyof typeof CATEGORY_LABEL] ?? cat} 시세 {arrow} {Math.round(z * MARKET_STEP * 100)}%</span></p>
              )}
              <p className="small muted">화살표는 지난 라운드와 비교한 변화예요. 다음 시세는 알 수 없고, 라운드가 바뀔 때만 움직여요 (±4%씩, 최대 ±8%).</p>
              <button className="btn btn-sm btn-ghost" onClick={() => setShowTrend((v) => !v)}>{showTrend ? '추이 닫기' : '최근 추이 보기'}</button>
              {showTrend && <div className="row small">{hist.slice(-4).map((v, i) => <span key={i} className="tag">{g.round - Math.min(4, hist.length) + i + 1}R {v > 0 ? '+' : ''}{Math.round(v * MARKET_STEP * 100)}%</span>)}</div>}
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn btn-copper btn-lg" disabled={!!deliverReason || !sat?.ok} {...previewProps({ coins: pay.total, actions: -1 })} onClick={deliver}>지금 배달 · +{pay.total}코인 / 행동 1</button>
                <button className="btn btn-ghost" disabled={lastRound} title={lastRound ? '마지막 라운드예요' : ''} onClick={() => goTo('workshop')}>보관하고 다음 라운드에 보기</button>
              </div>
              {deliverReason && <p className="small muted">{deliverReason}</p>}
              <p className="small muted">{lastRound ? '마지막 라운드: 배달하지 않은 주문은 마무리 때 조건이 맞으면 이번 시세로 자동 배달돼요.' : `보관해도 물건과 주문은 그대로예요. 기한(${sel.special ? '게임 끝' : sel.deadlineRound + '라운드'})이 지나면 주문이 사라져요.`}</p>
            </section>
          )}
        </div>
        <aside className="place-side">
          <section className="panel">
            <div className="panel-title">운송 서류</div>
            {t.contracts.length === 0 && <p className="muted small">받은 주문이 없어요. <button className="btn btn-sm btn-ghost" onClick={() => goTo('orders')}>의뢰소로 →</button></p>}
            {t.contracts.map((c) => {
              const ok = contractSatisfiable(t, c).ok;
              const p = contractPayout(g, c);
              const tpl = CONTRACTS[c.templateId]!;
              return (
                <button key={c.id} className={`doc ${selId === c.id ? 'sel' : ''}`} onClick={() => setSelId(c.id)}>
                  <span className="row-between"><b>{c.title}</b><span className="reward">{p.total}</span></span>
                  <span className="small muted">{CATEGORY_LABEL[tpl.category]} · {c.special ? '게임 끝까지' : `${c.deadlineRound}R까지`}</span>
                  <span className={`tag ${ok ? 'tag-teal' : ''}`}>{ok ? '배달 가능' : '준비 중'}</span>
                </button>
              );
            })}
          </section>
        </aside>
      </div>
    </Scene>
  );
}
