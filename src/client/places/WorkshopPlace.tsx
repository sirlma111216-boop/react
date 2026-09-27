import { useMemo, useState } from 'react';
import type { ClientView } from '../../shared/protocol';
import type { Lot, TeamCommand } from '../../shared/types';
import { REACTIONS } from '../../shared/chemistry/reactions';
import { MATERIALS } from '../../shared/chemistry/materials';
import { EQUIPMENT } from '../../shared/chemistry/equipment';
import { lotComponents } from '../../shared/chemistry/processes';
import { routesFor } from '../../shared/engine/reachability';
import { cardRelation, needsSorting } from '../../shared/engine/mission';
import { lotTagText } from '../../shared/engine/commands';
import { Scene } from '../components/Scene';
import { AssetImage, Modal } from '../components/common';
import { ReactionDetail } from '../components/ReactionCard';
import { WorkCard, availability } from '../components/WorkCard';
import { MissionBoard, type BoardHighlight } from '../components/MissionBoard';
import { SupportModal, SupportTray } from '../components/SupportPanel';
import { MaterialArt } from '../components/Art';
import { LotDetail } from '../components/Inventory';
import { mapFor, unmetRequirements } from '../components/Coach';
import type { Place } from '../lib/places';

type Send = (cmd: TeamCommand, sfx?: string) => Promise<boolean>;

/** 창고 칸 하나: 공통 물질 그림 + 이름 + 정확한 개수. 그림 속 알갱이 수는 수량이 아니다. */
function Jar({ lot, rel, hl, status, onClick }: { lot: Lot; rel?: boolean; hl?: boolean; status?: 'need' | 'done' | 'support' | null; onClick: () => void }) {
  const label = lot.kind === 'pure' ? MATERIALS[lot.materialId!]!.displayName : lotComponents(lot).map((c) => MATERIALS[c.materialId]!.displayName).join(' + ');
  return (
    <button className={`jar ${rel ? 'rel' : ''} ${status ?? ''} ${hl ? 'hl' : ''}`} onClick={onClick} aria-label={`${label} ${lot.units}개${status === 'need' ? ' · 정리 필요' : status === 'done' ? ' · 출하 가능' : ''}`}>
      <MaterialArt lot={lot} size={56} />
      <span className="jar-name" title={label}>{lot.kind === 'mixture' ? '섞인 것' : label}</span>
      {lot.kind === 'mixture' && <span className="jar-sub" title={label}>{label}</span>}
      <span className="jar-count">{lot.units}개</span>
      {status === 'need' && <span className="tag tag-amber">◆ 정리 필요</span>}
      {status === 'done' && <span className="tag tag-teal">✓ 출하 가능</span>}
      {status === 'support' && <span className="tag tag-gas">지원품{lot.tags.length ? ` · ${lotTagText(lot)}` : ''}</span>}
    </button>
  );
}

export function WorkshopPlace({ view, send, focusId, setFocus, canAct, goTo, highlight }: { view: ClientView; send: Send; focusId: string | null; setFocus: (id: string | null) => void; canAct: boolean; goTo: (p: Place, target?: string | null) => void; highlight: string | null }) {
  const g = view.game!;
  const t = g.myTeam!;
  const map = mapFor(view);
  const [picker, setPicker] = useState<{ slot: number } | null>(null);
  const [openReaction, setOpenReaction] = useState<string | null>(null);
  const [openLot, setOpenLot] = useState<string | null>(null);
  const [supportOpen, setSupportOpen] = useState(false);
  const [allShelf, setAllShelf] = useState(false);
  const [allCards, setAllCards] = useState(false);
  const [selCard, setSelCard] = useState<string | null>(null);
  const focus = t.contracts.find((c) => c.id === focusId) ?? t.contracts[0] ?? null;
  const slotCount = (g.reactionSlots ?? 2) + (t.equipment.some((e) => e.id === 'U01') ? 1 : 0);
  const running = t.processes.filter((p) => p.kind === 'reaction');
  const opNick = view.players.find((p) => p.id === t.operatorId)?.nick ?? '다른 팀원';
  const supportPending = !!t.support && t.support.status === 'pending' && t.support.round === g.round;

  // 집중 의뢰 관련 재료·카드 (검증된 경로 기준)
  const focusMats = useMemo(() => {
    const set = new Set<string>();
    if (!focus) return set;
    for (const req of unmetRequirements(t, focus.requirements)) for (const r of routesFor(map, req.materialId, req.tags)) for (const inp of r.inputsPerBatch) for (const alt of inp.alternatives) set.add(alt);
    return set;
  }, [focus, t, map]);

  const isRaw = (l: Lot) => l.kind === 'pure' && (l.grade === 'purchased' || (l.grade === 'support' && l.tags.length === 0));
  const rawLots = t.lots.filter(isRaw);
  const madeLots = t.lots.filter((l) => !isRaw(l));
  const shelf = [...rawLots].sort((a, b) => Number(focusMats.has(b.materialId!)) - Number(focusMats.has(a.materialId!)));
  const shelfShown = allShelf ? shelf : shelf.slice(0, 10);
  const lotById = (id: string | null) => (id ? t.lots.find((l) => l.id === id) ?? null : null);

  // 카드 목록: 집중 의뢰와의 관계(직접 → 다음 단계) · 지금 가능 순
  const cards = g.activeReactions.map((rid) => {
    const av = availability(g, t, rid, { isOperator: view.me.isOperator, operatorNick: opNick, supportPending });
    const reqRel = focus ? focus.requirements.map((q) => cardRelation(map, rid, q, g.activeReactions)).find((x) => x) ?? null : null;
    const route = focus ? focus.requirements.flatMap((q) => routesFor(map, q.materialId, q.tags)).find((r) => r.reactionId === rid) ?? null : null;
    const runnable = av.state === 'ok' || av.state === 'wait' || av.state === 'lock' || av.state === 'ready' || av.state === 'actions';
    return { rid, av, rel: reqRel, route, score: (reqRel?.kind === 'direct' ? 4 : reqRel ? 2 : 0) + (runnable ? 1 : 0) };
  });
  const sorted = [...cards].sort((a, b) => b.score - a.score);
  const recommended = sorted.filter((c) => c.score > 0).slice(0, 4);
  const shownCards = allCards || !recommended.length ? sorted : recommended;
  const boardHl: BoardHighlight | null = selCard ? { reactionId: selCard } : null;

  const run = async (rid: string, scale: 1 | 2) => {
    if (await send({ type: 'react', reactionId: rid, scale }, 'sfx-reaction-start')) { setOpenReaction(null); setPicker(null); setSelCard(null); }
  };

  return (
    <Scene place="workshop">
      <div className="place-grid workshop-grid">
        <div className="ws-board"><MissionBoard view={view} focusId={focus?.id ?? null} setFocus={setFocus} highlight={boardHl} goTo={goTo} /></div>
        {t.support && t.support.round === g.round && <div className="ws-support"><SupportTray view={view} onOpen={() => setSupportOpen(true)} /></div>}

        <section className="bench" aria-label="작업대">
          <div className="bench-title">작업대 <span className="muted small">작업 자리 {running.length}/{slotCount} 사용 중 · 빈 자리를 누르면 만들기 카드</span></div>
          <div className="bench-slots">
            {Array.from({ length: slotCount }, (_, i) => {
              const p = running[i];
              if (!p) return (
                <button key={i} className={`device empty ${canAct ? 'can' : ''}`} onClick={() => setPicker({ slot: i })} aria-label={`빈 작업 자리 ${i + 1}`}>
                  <span className="device-outline" aria-hidden />
                  <span className="small">빈 자리</span>
                  <span className="tag tag-teal">{canAct ? '눌러서 만들기' : '만들기 카드 보기'}</span>
                </button>
              );
              const r = REACTIONS[p.defId]!;
              const left = p.completesRound - g.round;
              return (
                <div key={i} className="device busy" aria-label={`${r.name} 가동 중`}>
                  <AssetImage id="equipment-reactor" alt="" className="device-img processing" fallback={<span className="device-outline" />} />
                  <span className="bubbles" aria-hidden><i /><i /><i /></span>
                  <b>{r.name} ×{p.scale}</b>
                  <span className="device-outs">{p.outputs.map((o) => <MaterialArt key={o.id} lot={o} size={28} badge={false} />)}</span>
                  <span className="tag tag-amber">⟳ {left <= 0 ? '이번 정산 때 완성' : `정산 ${left + 1}회 뒤 완성`}</span>
                </div>
              );
            })}
            {slotCount < 3 && <div className="device ghost" aria-hidden><span className="device-outline dashed" /><span className="small muted">추가 반응기 자리</span><button className="btn btn-sm btn-ghost" style={{ pointerEvents: 'auto' }} onClick={() => goTo('store', 'equip:U01')}>상점에서 보기</button></div>}
          </div>
          <div className="modules" aria-label="설치된 장비">
            <span className="small muted">장비:</span>
            <span className="tag tag-teal">가열</span><span className="tag tag-teal">기체 모으기</span>
            {t.equipment.map((e) => <span key={e.id} className="module"><AssetImage id={EQUIPMENT[e.id]!.imageId} alt="" className="module-img" fallback={<span />} />{EQUIPMENT[e.id]!.name}{e.leased ? ' (빌림)' : ''}</span>)}
          </div>
        </section>

        <section className="shelf panel" aria-label="재료 선반">
          <div className="panel-title">재료 선반 <span className="muted small" style={{ textTransform: 'none' }}>{focus ? `"${focus.title}" 재료 먼저` : '산 재료 · 지원받은 원료'}</span></div>
          {shelf.length === 0 && <p className="muted small">재료가 없어요. <button className="btn btn-sm btn-ghost" onClick={() => goTo('store')}>상점으로 →</button></p>}
          <div className="shelf-row">
            {shelfShown.map((l) => <Jar key={l.id} lot={l} rel={focusMats.has(l.materialId!)} hl={highlight === `lot:${l.id}`} status={l.grade === 'support' ? 'support' : null} onClick={() => setOpenLot(l.id)} />)}
          </div>
          {shelf.length > 10 && <button className="btn btn-sm btn-ghost" onClick={() => setAllShelf((v) => !v)}>{allShelf ? '접기' : `전체 창고 (${shelf.length})`}</button>}
        </section>

        <section className="tray panel" aria-label="완성품 트레이">
          <div className="panel-title">완성품 트레이</div>
          {madeLots.length === 0 && <p className="muted small">만든 것이 완성되면 여기에 나타나요.</p>}
          <div className="shelf-row">
            {madeLots.map((l) => <Jar key={l.id} lot={l} hl={highlight === `lot:${l.id}`} status={needsSorting(l) ? 'need' : l.grade === 'support' ? 'support' : 'done'} onClick={() => setOpenLot(l.id)} />)}
          </div>
          {madeLots.some((l) => !needsSorting(l)) && <button className="btn btn-sm btn-copper" onClick={() => goTo('shipping')}>출하장으로 →</button>}
        </section>
      </div>

      {picker && (
        <Modal title={`작업 자리 ${picker.slot + 1} · 무엇을 만들까요?`} onClose={() => { setPicker(null); setSelCard(null); }} wide>
          <div className="picker-board"><MissionBoard view={view} focusId={focus?.id ?? null} setFocus={setFocus} highlight={boardHl} goTo={(p, tg) => { setPicker(null); goTo(p, tg); }} compact /></div>
          <p className="small muted" style={{ margin: '6px 0' }}>{focus ? `"${focus.title}"과 관련된 카드를 먼저 보여 줘요. 카드 제목을 누르면 위 의뢰 보드에서 만드는 목표(진한 표시)와 다음 단계 재료(옅은 표시)를 볼 수 있어요.` : '의뢰를 받으면 관련 카드를 먼저 보여 줘요.'}</p>
          <div className="wcard-grid">
            {shownCards.map((c) => (
              <WorkCard key={c.rid} rid={c.rid} game={g} team={t} av={c.av} focus={focus} relation={c.rel} route={c.route} selected={selCard === c.rid}
                pinned={t.pins.filter((p) => p.target === `reaction:${c.rid}`).length} running={running.some((p) => p.defId === c.rid)}
                onSelect={() => setSelCard(selCard === c.rid ? null : c.rid)}
                onRun={(scale) => run(c.rid, scale)}
                onShort={() => { setPicker(null); goTo('store', `need:${c.rid}`); }}
                onEquip={(eq) => { setPicker(null); goTo('store', eq === 'energy' ? 'energy' : `equip:${eq}`); }}
                onDetail={() => setOpenReaction(c.rid)}
                onPin={() => send({ type: 'pin', playerId: view.me.playerId, target: `reaction:${c.rid}`, label: `"${REACTIONS[c.rid]!.name}" 추천` }, 'sfx-ping')} />
            ))}
          </div>
          <div className="row" style={{ marginTop: 10 }}><button className="btn btn-sm btn-ghost" onClick={() => setAllCards((v) => !v)}>{allCards ? '관련 카드만 보기' : `전체 카드 보기 (${cards.length})`}</button></div>
        </Modal>
      )}
      {openReaction && <ReactionDetail rid={openReaction} team={t} game={g} canAct={canAct && !supportPending} onClose={() => setOpenReaction(null)}
        onRun={(scale) => run(openReaction, scale)}
        onPin={() => send({ type: 'pin', playerId: view.me.playerId, target: `reaction:${openReaction}`, label: `"${REACTIONS[openReaction]!.name}" 추천` }, 'sfx-ping')} />}
      {openLot && lotById(openLot) && <LotDetail lot={lotById(openLot)!} team={t} canAct={canAct && !supportPending} onClose={() => setOpenLot(null)} onProcess={async (pid) => { if (await send({ type: 'process', processId: pid, lotId: openLot }, 'sfx-filter')) setOpenLot(null); }} />}
      {supportOpen && <SupportModal view={view} send={send} onClose={() => setSupportOpen(false)} />}
    </Scene>
  );
}
