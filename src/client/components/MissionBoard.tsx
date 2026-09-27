import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { ClientView } from '../../shared/protocol';
import type { ContractInstance } from '../../shared/types';
import { MATERIALS } from '../../shared/chemistry/materials';
import { PROCESSES } from '../../shared/chemistry/processes';
import { CONTRACTS, CATEGORY_LABEL } from '../../shared/chemistry/contracts';
import { contractPayout } from '../../shared/engine/market';
import { cardRelation, missionProgress, routeSteps, type ReqProgress } from '../../shared/engine/mission';
import { mapFor } from './Coach';
import { MaterialArt } from './Art';
import { AssetImage } from './common';
import { objectEntry, objectUrl } from '../lib/assets';
import type { Place } from '../lib/places';

/** 의뢰 보드 그림을 border-image 로: 모서리 클립은 그대로, 가운데 종이만 늘어난다 */
function boardStyle(): CSSProperties | undefined {
  const url = objectUrl('obj-mission-board');
  const e = objectEntry('obj-mission-board');
  if (!url || !e?.slice) return undefined;
  const s = e.slice;
  // 원본 조각을 화면에서 약 0.2 배로 (클립 폭 ≈ 30px). 위·아래는 조각 두께만큼 자리를 비우고,
  // 좌우 조각 안쪽은 빈 종이라 글이 겹쳐도 되므로 얇게 둔다.
  const k = 0.2;
  return {
    borderStyle: 'solid',
    borderWidth: `${Math.round(s.top * k)}px 12px ${Math.round(s.bottom * k)}px 12px`,
    borderImageSource: `url(${url})`,
    borderImageSlice: `${s.top} ${s.right} ${s.bottom} ${s.left} fill`,
    borderImageWidth: `${Math.round(s.top * k)}px ${Math.round(s.right * k)}px ${Math.round(s.bottom * k)}px ${Math.round(s.left * k)}px`,
    borderImageRepeat: 'stretch',
  };
}

function Bar({ p }: { p: ReqProgress }) {
  const need = Math.max(1, p.need);
  const seg = (n: number) => `${Math.min(100, (Math.max(0, n) / need) * 100)}%`;
  const sorting = Math.min(p.needsSorting, p.stillNeeded);
  const working = Math.min(p.inProgress, Math.max(0, p.stillNeeded - sorting));
  return (
    <span className="mb-bar" aria-hidden>
      <span className="mb-seg ready" style={{ width: seg(p.ready) }} />
      <span className="mb-seg sort" style={{ width: seg(sorting) }} />
      <span className="mb-seg work" style={{ width: seg(working) }} />
    </span>
  );
}

function ReqRow({ p, hl, flash, routeIdx, onNextRoute }: { p: ReqProgress; hl: 'direct' | 'mid' | null; hlLabel?: string; flash: boolean; routeIdx: number; onNextRoute: () => void }) {
  const m = MATERIALS[p.materialId]!;
  const rest = Math.max(0, p.stillNeeded - Math.min(p.needsSorting, p.stillNeeded) - p.inProgress);
  const route = p.routes.length ? p.routes[routeIdx % p.routes.length]! : null;
  return (
    <div className={`mb-req ${p.stillNeeded === 0 ? 'done' : ''} ${hl ? `hl-${hl}` : ''} ${flash ? 'flash' : ''}`}>
      <MaterialArt materialId={p.materialId} size={40} />
      <div className="mb-req-main">
        <div className="mb-req-top">
          <b className="mb-name">{m.displayName}</b>
          <span className="mb-count"><b>준비됨 {p.ready}</b> / 필요 {p.need}</span>
          {p.stillNeeded === 0 && <span className="mb-ok">✓</span>}
        </div>
        <Bar p={p} />
        <div className="mb-notes">
          {p.needsSorting > 0 && p.stillNeeded > 0 && <span className="mb-note sort">◆ 정리 필요 {Math.min(p.needsSorting, p.stillNeeded)} ({PROCESSES[p.sortProcess ?? '']?.name ?? '정리하기'})</span>}
          {p.inProgress > 0 && p.stillNeeded > 0 && <span className="mb-note work">⟳ 작업 중 {p.inProgress} (정산 뒤)</span>}
          {rest > 0 && <span className="mb-note need">아직 필요 {rest}</span>}
          {p.supportReady > 0 && <span className="mb-note">지원품 {p.supportReady} 포함</span>}
          {p.sharedWith && <span className="mb-note shared">다른 의뢰({p.sharedWith})와 공용</span>}
          {hl === 'direct' && <span className="mb-note hl">선택한 카드가 만드는 목표</span>}
          {rest > 0 && route && <span className="mb-route">추천 경로: {routeSteps(route)}{p.routes.length > 1 && <button className="mb-alt" onClick={onNextRoute}>다른 방법 ▸</button>}</span>}
        </div>
      </div>
    </div>
  );
}

export interface BoardHighlight { reactionId: string }

/**
 * 공방 작업대 위 의뢰 보드: 수락한 의뢰를 의뢰소에 가지 않고 확인한다.
 * 준비됨 / 정리 필요 / 작업 중 / 아직 필요를 따로 보이고, 선택한 카드와 관련된 물질을 강조하며,
 * 서버 상태가 바뀐 성분만 짧게(0.9초) 반짝인다.
 */
export function MissionBoard({ view, focusId, setFocus, highlight, goTo, compact }: { view: ClientView; focusId: string | null; setFocus: (id: string | null) => void; highlight: BoardHighlight | null; goTo: (p: Place, target?: string | null) => void; compact?: boolean }) {
  const g = view.game!;
  const t = g.myTeam!;
  const map = mapFor(view);
  const contracts = t.contracts;
  const focus = contracts.find((c) => c.id === focusId) ?? contracts[0] ?? null;
  const progress = useMemo(() => missionProgress(t, contracts, map, g.activeReactions, focus?.id ?? null), [t, contracts, map, g.activeReactions, focus?.id]);
  const [tab, setTab] = useState<string | null>(null);
  const [routeIdx, setRouteIdx] = useState<Record<string, number>>({});
  // 서버 상태 변화 강조: 성분별 (준비됨, 작업 중, 정리 필요) 이 바뀌면 0.9초 반짝
  const prev = useRef<Record<string, string>>({});
  const [flash, setFlash] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const now: Record<string, string> = {};
    const changed: Record<string, boolean> = {};
    for (const mp of progress) for (const r of mp.reqs) {
      const k = `${mp.contract.id}:${r.index}`;
      now[k] = `${r.ready}/${r.inProgress}/${r.needsSorting}`;
      if (prev.current[k] !== undefined && prev.current[k] !== now[k]) changed[k] = true;
    }
    prev.current = now;
    if (Object.keys(changed).length) {
      setFlash(changed);
      const h = setTimeout(() => setFlash({}), 900);
      return () => clearTimeout(h);
    }
  }, [progress]);

  const many = progress.length > 2;
  const shown = many ? progress.filter((p) => p.contract.id === (tab ?? focus?.id)) : progress;
  const style = boardStyle();

  return (
    <section className={`mboard ${compact ? 'compact' : ''} ${style ? 'has-art' : ''}`} style={style} aria-label="작업대 의뢰 보드">
      <div className="mb-head">
        <span className="mb-title">의뢰 보드</span>
        <span className="muted small">받은 의뢰 {contracts.length}/{g.config.contractLimit}</span>
        {many && <span className="mb-tabs" role="tablist">{progress.map((p) => <button key={p.contract.id} role="tab" aria-selected={(tab ?? focus?.id) === p.contract.id} className={`chip ${(tab ?? focus?.id) === p.contract.id ? 'active' : ''}`} onClick={() => setTab(p.contract.id)}>{p.contract.title}</button>)}</span>}
      </div>
      {progress.length === 0 && (
        <p className="mb-empty">받은 의뢰가 없어요. 의뢰를 받으면 여기서 준비 상황을 바로 볼 수 있어요. <button className="btn btn-sm btn-primary" onClick={() => goTo('orders')}>의뢰소에서 받기 →</button></p>
      )}
      <div className="mb-contracts">
        {shown.map((mp) => {
          const c: ContractInstance = mp.contract;
          const tpl = CONTRACTS[c.templateId]!;
          const pay = contractPayout(g, c);
          const isFocus = focus?.id === c.id;
          return (
            <div key={c.id} className={`mb-contract ${isFocus ? 'focus' : ''} ${mp.shippable ? 'ship' : ''}`}>
              <div className="mb-chead">
                <AssetImage id={tpl.imageId} alt={CATEGORY_LABEL[tpl.category]} className="mb-cimg" fallback={<span className="mb-cimg" />} />
                <button className="mb-ctitle" onClick={() => setFocus(c.id)} aria-pressed={isFocus} title="집중 의뢰로 정하기">{c.title}</button>
                <span className="mb-pay" title={pay.fixed ? '고정가 의뢰' : `기본금 ${pay.base} ${pay.adjust >= 0 ? '+' : '−'} 시세 ${Math.abs(pay.adjust)}${pay.bonus ? ` + 보너스 ${pay.bonus}` : ''}`}>{pay.total}코인{pay.fixed ? '' : ' · 시세 반영'}</span>
                <span className="mb-deadline">{c.special ? '게임 끝까지' : `${c.deadlineRound}R까지`}</span>
                {isFocus ? <span className="tag tag-amber">집중</span> : <button className="btn btn-sm btn-ghost" onClick={() => setFocus(c.id)}>집중하기</button>}
                {mp.shippable && <button className="btn btn-sm btn-copper mb-ship" onClick={() => goTo('shipping', `contract:${c.id}`)}>출하장으로 →</button>}
              </div>
              <div className="mb-reqs">
                {mp.reqs.map((r) => {
                  const rel = highlight ? cardRelation(map, highlight.reactionId, c.requirements[r.index]!, g.activeReactions) : null;
                  const k = `${c.id}:${r.index}`;
                  return (
                    <div key={k}>
                      <ReqRow p={r} hl={rel?.kind === 'direct' ? 'direct' : rel ? 'mid' : null} flash={!!flash[k]} routeIdx={routeIdx[k] ?? 0} onNextRoute={() => setRouteIdx((x) => ({ ...x, [k]: (x[k] ?? 0) + 1 }))} />
                      {rel?.kind === 'intermediate' && <div className="mb-mid"><MaterialArt materialId={rel.materialId} size={24} badge={false} /> 다음 단계 재료: {MATERIALS[rel.materialId]?.displayName}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
