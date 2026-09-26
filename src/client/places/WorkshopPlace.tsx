import { useMemo, useState } from 'react';
import type { ClientView } from '../../shared/protocol';
import type { Lot, TeamCommand } from '../../shared/types';
import { REACTIONS } from '../../shared/chemistry/reactions';
import { MATERIALS } from '../../shared/chemistry/materials';
import { EQUIPMENT } from '../../shared/chemistry/equipment';
import { lotComponents } from '../../shared/chemistry/processes';
import { routesFor } from '../../shared/engine/reachability';
import { Scene } from '../components/Scene';
import { AssetImage, Modal, Formula } from '../components/common';
import { ReactionCard, ReactionDetail, reactionStatus } from '../components/ReactionCard';
import { LotDetail } from '../components/Inventory';
import { mapFor, unmetRequirements } from '../components/Coach';
import { previewProps, type Place } from '../lib/places';

type Send = (cmd: TeamCommand, sfx?: string) => Promise<boolean>;

/** 용기 형태: 기체=실린더, 액체/수용액=병, 고체=상자. 크기는 실제 질량·부피를 뜻하지 않는다. */
function Container({ lot, level }: { lot: Lot; level: 0 | 1 | 2 | 3 }) {
  const m = lot.kind === 'pure' ? MATERIALS[lot.materialId!] : null;
  const ph = m?.phase ?? 'aq';
  const mixture = lot.kind === 'mixture';
  const fill = mixture ? '#c9a06b' : ph === 'g' ? '#5EC9B5' : ph === 'l' ? '#5a9bd4' : ph === 'aq' ? '#8fbbe0' : '#b8a48a';
  const bundles = Array.from({ length: level }, (_, i) => i);
  return (
    <svg className="container-svg" viewBox="0 0 48 60" aria-hidden>
      {ph === 'g' && !mixture ? <><rect x="14" y="8" width="20" height="44" rx="10" fill="#e8e2d4" stroke="#7d8889" /><rect x="20" y="3" width="8" height="6" rx="2" fill="#b87346" /></>
        : ph === 's' && !mixture ? <rect x="8" y="18" width="32" height="32" rx="4" fill="#e8e2d4" stroke="#7d8889" />
        : <><rect x="14" y="14" width="20" height="38" rx="6" fill="#eef3f4" stroke="#7d8889" /><rect x="19" y="6" width="10" height="9" rx="2" fill="#b87346" /></>}
      {bundles.map((i) => <rect key={i} x={ph === 's' && !mixture ? 12 : 17} y={46 - i * 10} width={ph === 's' && !mixture ? 24 : 14} height="8" rx="2" fill={fill} opacity={0.9} />)}
      {mixture && <text x="24" y="58" textAnchor="middle" fontSize="8" fill="#7a4f0b">섞임</text>}
    </svg>
  );
}
const levelOf = (units: number): 0 | 1 | 2 | 3 => (units <= 0 ? 0 : units <= 2 ? 1 : units <= 5 ? 2 : 3);

export function WorkshopPlace({ view, send, focusId, canAct, goTo, highlight }: { view: ClientView; send: Send; focusId: string | null; canAct: boolean; goTo: (p: Place) => void; highlight: string | null }) {
  const g = view.game!;
  const t = g.myTeam!;
  const map = mapFor(view);
  const [picker, setPicker] = useState<{ slot: number } | null>(null);
  const [openReaction, setOpenReaction] = useState<string | null>(null);
  const [openLot, setOpenLot] = useState<string | null>(null);
  const [allShelf, setAllShelf] = useState(false);
  const [allCards, setAllCards] = useState(false);
  const focus = t.contracts.find((c) => c.id === focusId) ?? t.contracts[0] ?? null;
  const slotCount = 2 + (t.equipment.some((e) => e.id === 'U01') ? 1 : 0);
  const running = t.processes.filter((p) => p.kind === 'reaction');

  // 집중 의뢰 관련 재료·카드
  const focusMats = useMemo(() => {
    const set = new Set<string>();
    if (!focus) return set;
    for (const req of unmetRequirements(t, focus.requirements)) for (const r of routesFor(map, req.materialId, req.tags)) for (const inp of r.inputsPerBatch) for (const alt of inp.alternatives) set.add(alt);
    return set;
  }, [focus, t, map]);
  const focusReactions = useMemo(() => {
    const set = new Set<string>();
    if (!focus) return set;
    for (const req of unmetRequirements(t, focus.requirements)) for (const r of routesFor(map, req.materialId, req.tags)) set.add(r.reactionId);
    return set;
  }, [focus, t, map]);

  const rawLots = t.lots.filter((l) => l.kind === 'pure' && l.grade === 'purchased');
  const madeLots = t.lots.filter((l) => !(l.kind === 'pure' && l.grade === 'purchased'));
  const shelf = [...rawLots].sort((a, b) => (focusMats.has(a.materialId!) ? -1 : 0) - (focusMats.has(b.materialId!) ? -1 : 0));
  const shelfShown = allShelf ? shelf : shelf.slice(0, 8);
  const cards = g.activeReactions.map((rid) => ({ rid, st: reactionStatus(t, rid, g), rel: focusReactions.has(rid) }));
  const recommendedCards = cards.filter((c) => c.st.canRun || c.rel).sort((a, b) => Number(b.st.canRun) - Number(a.st.canRun) || Number(b.rel) - Number(a.rel)).slice(0, 5);
  const lotById = (id: string | null) => (id ? t.lots.find((l) => l.id === id) ?? null : null);
  const needsSort = (l: Lot) => l.kind === 'mixture' || (l.kind === 'pure' && l.materialId === 'H2O_g');

  return (
    <Scene place="workshop">
      <div className="place-grid workshop-grid">
        <section className="bench" aria-label="작업대">
          <div className="bench-title">작업대 <span className="muted small">작업 자리 {running.length}/{slotCount} 사용 중</span></div>
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
                <div key={i} className="device busy" aria-label={`${r.name} 만드는 중`}>
                  <AssetImage id="equipment-reactor" alt="" className="device-img processing" fallback={<span className="device-outline" />} />
                  <span className="bubbles" aria-hidden><i /><i /><i /></span>
                  <b>{r.name} ×{p.scale}</b>
                  <span className="small muted">{p.inputSummary}</span>
                  <span className="tag tag-amber">{left <= 0 ? '이번 마무리 때 완성' : `${left + 1}회 마무리 남음`}</span>
                </div>
              );
            })}
            {slotCount < 3 && <div className="device ghost" aria-hidden><span className="device-outline dashed" /><span className="small muted">추가 반응기 자리</span><button className="btn btn-sm btn-ghost" style={{ pointerEvents: 'auto' }} onClick={() => goTo('store')}>상점에서 보기</button></div>}
          </div>
          <div className="modules" aria-label="설치된 장비">
            <span className="small muted">장비:</span>
            <span className="tag tag-teal">가열</span><span className="tag tag-teal">기체 모으기</span>
            {t.equipment.map((e) => <span key={e.id} className="module"><AssetImage id={EQUIPMENT[e.id]!.imageId} alt="" className="module-img" fallback={<span />} />{EQUIPMENT[e.id]!.name}{e.leased ? ' (빌림)' : ''}</span>)}
          </div>
        </section>

        <section className="shelf panel" aria-label="재료 선반">
          <div className="panel-title">재료 선반 <span className="muted small" style={{ textTransform: 'none' }}>{focus ? `"${focus.title}" 재료 먼저` : '가게에서 산 재료'}</span></div>
          {shelf.length === 0 && <p className="muted small">재료가 없어요. <button className="btn btn-sm btn-ghost" onClick={() => goTo('store')}>상점으로 →</button></p>}
          <div className="shelf-row">
            {shelfShown.map((l) => (
              <button key={l.id} className={`jar ${focusMats.has(l.materialId!) ? 'rel' : ''} ${highlight === `lot:${l.id}` ? 'hl' : ''}`} onClick={() => setOpenLot(l.id)} aria-label={`${MATERIALS[l.materialId!]!.displayName} ${l.units}개`}>
                <Container lot={l} level={levelOf(l.units)} />
                <span className="jar-name">{MATERIALS[l.materialId!]!.displayName}</span>
                <span className="jar-count">{l.units}개</span>
              </button>
            ))}
          </div>
          {shelf.length > 8 && <button className="btn btn-sm btn-ghost" onClick={() => setAllShelf((v) => !v)}>{allShelf ? '접기' : `전체 창고 (${shelf.length})`}</button>}
        </section>

        <section className="tray panel" aria-label="완성품 트레이">
          <div className="panel-title">완성품 트레이</div>
          {madeLots.length === 0 && <p className="muted small">만든 것이 완성되면 여기에 나타나요.</p>}
          <div className="shelf-row">
            {madeLots.map((l) => {
              const sort = needsSort(l);
              const label = l.kind === 'pure' ? MATERIALS[l.materialId!]!.displayName : lotComponents(l).map((c) => MATERIALS[c.materialId]!.displayName).join('+');
              return (
                <button key={l.id} className={`jar ${sort ? 'need' : 'done'} ${highlight === `lot:${l.id}` ? 'hl' : ''}`} onClick={() => setOpenLot(l.id)} aria-label={`${label} ${l.units}개 ${sort ? '정리 필요' : '완성품'}`}>
                  <Container lot={l} level={levelOf(l.units)} />
                  <span className="jar-name">{label}</span>
                  <span className="jar-count">{l.units}개</span>
                  <span className={`tag ${sort ? 'tag-amber' : 'tag-teal'}`}>{sort ? '정리 필요' : '출하 가능'}</span>
                </button>
              );
            })}
          </div>
          {madeLots.some((l) => !needsSort(l)) && <button className="btn btn-sm btn-copper" onClick={() => goTo('shipping')}>출하장으로 →</button>}
        </section>
      </div>

      {picker && (
        <Modal title={`작업 자리 ${picker.slot + 1} · 무엇을 만들까요?`} onClose={() => setPicker(null)} wide>
          <p className="small muted">{focus ? `"${focus.title}"에 필요한 카드와 지금 만들 수 있는 카드를 먼저 보여줘요.` : '지금 만들 수 있는 카드를 먼저 보여줘요.'} 카드를 누르면 재료·비용·결과를 확인하고 시작할 수 있어요.</p>
          <div className="hand">
            {(allCards ? cards : recommendedCards.length ? recommendedCards : cards.slice(0, 5)).map((c) => <ReactionCard key={c.rid} rid={c.rid} team={t} game={g} pinned={t.pins.filter((p) => p.target === `reaction:${c.rid}`).length} onOpen={() => setOpenReaction(c.rid)} />)}
          </div>
          <div className="row" style={{ marginTop: 8 }}><button className="btn btn-sm btn-ghost" onClick={() => setAllCards((v) => !v)}>{allCards ? '추천만 보기' : `전체 카드 보기 (${cards.length})`}</button></div>
        </Modal>
      )}
      {openReaction && <ReactionDetail rid={openReaction} team={t} game={g} canAct={canAct} onClose={() => setOpenReaction(null)}
        onRun={async (scale) => { if (await send({ type: 'react', reactionId: openReaction, scale }, 'sfx-reaction-start')) { setOpenReaction(null); setPicker(null); } }}
        onPin={() => send({ type: 'pin', playerId: view.me.playerId, target: `reaction:${openReaction}`, label: `"${REACTIONS[openReaction]!.name}" 추천` }, 'sfx-ping')} />}
      {openLot && lotById(openLot) && <LotDetail lot={lotById(openLot)!} team={t} canAct={canAct} onClose={() => setOpenLot(null)} onProcess={async (pid) => { if (await send({ type: 'process', processId: pid, lotId: openLot }, 'sfx-filter')) setOpenLot(null); }} />}
      <span className="sr-only">{g.activeReactions.length}장의 만들기 카드 · 예: 물 <Formula id="H2O_l" /></span>
      <RunPreview />
    </Scene>
  );
}

/** 카드 실행 버튼의 hover 미리보기는 ReactionDetail 안에서 처리하므로 여기서는 자리만 둔다 */
function RunPreview() { void previewProps; return null; }
