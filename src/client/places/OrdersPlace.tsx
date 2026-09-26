import { useState } from 'react';
import type { ClientView } from '../../shared/protocol';
import type { ContractInstance, TeamCommand } from '../../shared/types';
import { CONTRACTS, CATEGORY_LABEL } from '../../shared/chemistry/contracts';
import { MATERIALS } from '../../shared/chemistry/materials';
import { REACTIONS } from '../../shared/chemistry/reactions';
import { contractSatisfiable, tagLabel } from '../../shared/engine/commands';
import { contractPayout, payoutRange } from '../../shared/engine/market';
import { routesFor } from '../../shared/engine/reachability';
import { Scene, Npc } from '../components/Scene';
import { AssetImage, Formula } from '../components/common';
import { reactionStatus } from '../components/ReactionCard';
import { mapFor } from '../components/Coach';
import type { Place } from '../lib/places';

type Send = (cmd: TeamCommand, sfx?: string) => Promise<boolean>;

function DistrictFallback({ category }: { category: string }) {
  const color = category === 'metal' ? '#B87346' : category === 'water' ? '#5a9bd4' : category === 'gas' ? '#5EC9B5' : category === 'bio' ? '#5FB37A' : '#1F6F78';
  return <svg className="cimg" viewBox="0 0 54 54" aria-hidden><rect width="54" height="54" rx="10" fill="#ede6d8" /><rect x="12" y="20" width="30" height="22" rx="4" fill={color} /><rect x="20" y="12" width="14" height="10" rx="2" fill={color} opacity="0.7" /></svg>;
}

/** 의뢰소: 과학자에게 주문을 받는 장소. 동시에 최대 3개의 의뢰 카드에 집중한다. */
export function OrdersPlace({ view, send, focusId, setFocus, canPlan, goTo }: { view: ClientView; send: Send; focusId: string | null; setFocus: (id: string | null) => void; canPlan: boolean; goTo: (p: Place) => void }) {
  const g = view.game!;
  const t = g.myTeam!;
  const [selected, setSelected] = useState<string | null>(null);
  const [justTaken, setJustTaken] = useState<string | null>(null);
  const [bid, setBid] = useState<number | null>(null);
  const map = mapFor(view);
  const full = t.contracts.length >= g.config.contractLimit;
  const auction = g.auction;

  /** 지금 재료·에너지·자리로 첫 단계를 바로 시작할 수 있는 주문 */
  const canStartNow = (c: ContractInstance) => c.requirements.every((req) => routesFor(map, req.materialId, req.tags).some((r) => g.activeReactions.includes(r.reactionId) && reactionStatus(t, r.reactionId, g).canRun));
  const stepsOf = (c: ContractInstance) => Math.max(...c.requirements.map((req) => { const rs = routesFor(map, req.materialId, req.tags).filter((r) => g.activeReactions.includes(r.reactionId)); return rs.length ? Math.min(...rs.map((r) => 1 + r.processIds.length)) : 1; }));
  const recommended = t.offers.find(canStartNow)?.id ?? null;
  const line = t.contracts.length === 0 ? '우리 연구에 필요한 재료를 만들어 주시겠어요? 마음에 드는 주문을 골라 보세요.' : full ? '주문이 가득 찼네요. 만든 뒤에 또 오세요!' : '새 주문이 들어왔어요. 지금 재료로 시작할 수 있는 것부터 보세요.';

  const take = async (o: ContractInstance) => {
    if (await send({ type: 'takeContract', offerId: o.id }, 'sfx-card')) { setFocus(o.id); setJustTaken(o.id); setSelected(null); setTimeout(() => setJustTaken(null), 2500); }
  };

  return (
    <Scene place="orders">
      <div className="place-grid orders-grid">
        <div className="npc-col"><Npc place="orders" line={line} /></div>
        <div className="place-main">
          <section className="panel">
            <div className="panel-title">새 주문 <span className="muted small" style={{ textTransform: 'none' }}>받기는 행동을 쓰지 않아요 · {t.contracts.length}/{g.config.contractLimit} 보유</span></div>
            {t.offers.length === 0 && <p className="muted small">이번 라운드에는 새 주문이 없어요.</p>}
            <div className="offer-cards">
              {t.offers.map((o) => {
                const tpl = CONTRACTS[o.templateId]!;
                const range = payoutRange(o);
                const open = selected === o.id;
                return (
                  <div key={o.id} className={`offer ${open ? 'open' : ''} ${recommended === o.id ? 'rec' : ''}`}>
                    <button className="offer-head" onClick={() => setSelected(open ? null : o.id)} aria-expanded={open}>
                      <AssetImage id={tpl.imageId} alt={CATEGORY_LABEL[tpl.category]} className="cimg" fallback={<DistrictFallback category={tpl.category} />} />
                      <span className="offer-body">
                        <span className="ctitle">{o.title}</span>
                        <span className="muted small">{tpl.blurb}</span>
                        <span className="creq">{o.requirements.map((r, i) => <span key={i} className="tag">{MATERIALS[r.materialId]!.displayName} {r.units}개</span>)}<span className="tag tag-teal">{stepsOf(o)}단계</span>{recommended === o.id && <span className="tag tag-amber">지금 시작할 수 있어요</span>}</span>
                      </span>
                      <span className="offer-pay"><b>{o.reward}</b><span className="small muted">기본금</span><span className="small">시세 {range.min}~{range.max}</span></span>
                    </button>
                    {open && (
                      <div className="offer-detail">
                        <p className="small">필요한 것: {o.requirements.map((r) => `${MATERIALS[r.materialId]!.displayName} ${r.units}개 (${r.tags.map(tagLabel).join('/')})`).join(', ')} · 기한 {o.deadlineRound}라운드까지</p>
                        <p className="small muted">기본금 {o.reward}코인. 배달할 때의 시세에 따라 {range.min}~{range.max}코인을 받아요 (기본금 ±8%). 시세는 라운드가 바뀔 때만 움직여요.</p>
                        <p className="small">만드는 방법: {o.requirements.map((r) => { const rs = routesFor(map, r.materialId, r.tags).filter((x) => g.activeReactions.includes(x.reactionId)); return rs.slice(0, 2).map((x) => `${REACTIONS[x.reactionId]!.name}${x.processIds.length ? ' → 정리' : ''}`).join(' 또는 '); }).join(' · ')}</p>
                        <div className="row" style={{ justifyContent: 'flex-end' }}>
                          {canPlan && !full ? <button className="btn btn-primary" onClick={() => take(o)}>이 주문 받기</button> : full ? <span className="muted small">보유 주문이 가득 찼어요. 서류철의 주문을 먼저 끝내세요.</span> : <button className="btn btn-ghost" onClick={() => send({ type: 'pin', playerId: view.me.playerId, target: `offer:${o.templateId}`, label: `"${o.title}" 주문 추천` }, 'sfx-ping')}>👍 추천</button>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
          {auction && (
            <section className="panel invite">
              <div className="panel-title">도시 특별 주문 초대장 <span className="tag tag-amber">{auction.resolved ? '공개됨' : `${auction.bidderCount}팀 참여`}</span></div>
              <p className="small"><b>{auction.contract.title}</b> — {auction.contract.requirements.map((r) => `${MATERIALS[r.materialId]!.displayName} ${r.units}개`).join(', ')} · 기본금 {auction.contract.reward} + 보너스 {auction.contract.bonus ?? 0}코인 · 게임 끝까지</p>
              {auction.resolved ? <p className="small">{auction.winnerId ? `${view.teams.find((x) => x.id === auction!.winnerId)?.name ?? '?'} 팀이 가져갔어요` : '아무도 가져가지 않았어요'}</p> : (
                <div className="row">
                  <input type="range" min={0} max={g.config.auctionMaxBid} value={bid ?? auction.myBid} onChange={(e) => setBid(Number(e.target.value))} disabled={!canPlan} aria-label="입찰액" style={{ flex: 1 }} />
                  <b>{bid ?? auction.myBid}코인</b>
                  <button className="btn btn-sm btn-copper" disabled={!canPlan || (bid ?? auction.myBid) === auction.myBid} onClick={() => send({ type: 'bid', amount: bid ?? auction.myBid }, 'sfx-card')}>몰래 써내기</button>
                </div>
              )}
              <p className="muted small">0은 안 함. 이번 라운드 마무리 때 공개되고 가장 많이 쓴 팀만 돈을 내요. 주문 자리 1개를 예약해요.</p>
            </section>
          )}
        </div>
        <aside className="place-side">
          <section className="panel folder">
            <div className="panel-title">보유 서류철 <span className="tag">{t.contracts.length}/{g.config.contractLimit}</span></div>
            {t.contracts.length === 0 && <p className="muted small">받은 주문이 여기 쌓여요.</p>}
            {t.contracts.map((c) => {
              const sat = contractSatisfiable(t, c);
              const pay = contractPayout(g, c);
              return (
                <div key={c.id} className={`folder-item ${focusId === c.id ? 'focus' : ''} ${justTaken === c.id ? 'slide-in' : ''}`}>
                  <div className="row-between"><b>{c.title}</b><span className="reward">{pay.total}코인</span></div>
                  <div className="small muted">{c.requirements.map((r) => `${MATERIALS[r.materialId]!.displayName} ${r.units}개`).join(', ')} · {c.special ? '게임 끝까지' : `${c.deadlineRound}R까지`}</div>
                  <div className="row" style={{ marginTop: 4 }}>
                    {focusId === c.id ? <span className="tag tag-amber">집중 의뢰</span> : <button className="btn btn-sm btn-ghost" onClick={() => setFocus(c.id)}>집중하기</button>}
                    {sat.ok ? <button className="btn btn-sm btn-copper" onClick={() => goTo('shipping')}>출하장에서 배달 →</button> : <button className="btn btn-sm btn-ghost" onClick={() => goTo('workshop')}>공방에서 준비하기 →</button>}
                    {canPlan && !c.special && <button className="btn btn-sm btn-ghost" onClick={() => send({ type: 'cancelContract', contractId: c.id })}>취소</button>}
                  </div>
                </div>
              );
            })}
          </section>
          <p className="muted small">주문마다 필요한 물질과 화학식은 도감에서 볼 수 있어요. 예: 물 <Formula id="H2O_l" /></p>
        </aside>
      </div>
    </Scene>
  );
}
