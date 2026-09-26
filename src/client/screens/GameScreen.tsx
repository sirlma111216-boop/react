import { useEffect, useMemo, useState } from 'react';
import type { ClientView } from '../../shared/protocol';
import type { GameClient } from '../lib/net';
import type { TeamCommand } from '../../shared/types';
import { contractSatisfiable } from '../../shared/engine/commands';
import { store } from '../lib/store';
import { audio } from '../lib/audio';
import { prefGet, prefSet } from '../lib/session';
import { usePlaceRoute, useFocusContract, previewStore, type Place } from '../lib/places';
import { Hud, MobileNav } from '../components/Hud';
import { nextHint, HelpModal } from '../components/Coach';
import { Codex } from '../components/Codex';
import { Emblem } from '../components/Emblem';
import { OrdersPlace } from '../places/OrdersPlace';
import { WorkshopPlace } from '../places/WorkshopPlace';
import { StorePlace } from '../places/StorePlace';
import { ShippingPlace } from '../places/ShippingPlace';
import { ResultsScreen } from './ResultsScreen';

/** 게임 화면 골격: HUD + 4개 장소. 장소 이동은 개인 UI 상태이며 서버 명령이 아니다. */
export function GameScreen({ view, client, onLeave, headerExtra }: { view: ClientView; client: GameClient; onLeave: () => void; headerExtra?: React.ReactNode }) {
  const game = view.game!;
  const team = game.myTeam;
  const me = view.me;
  const roomCode = client.kind === 'ws' ? view.room.code : null;
  const [place, setPlace] = usePlaceRoute(roomCode);
  const [focusId, setFocus] = useFocusContract(roomCode);
  const [help, setHelp] = useState(() => prefGet('help.seen', '0') !== '1');
  const [codex, setCodex] = useState(false);
  const [teamPanel, setTeamPanel] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [lastRound, setLastRound] = useState(game.round);

  const canAct = !!team && me.isOperator && game.phase === 'execute' && view.room.status === 'playing' && !team.roundReady;
  const canPlan = canAct;

  useEffect(() => { audio.bgm(game.round >= game.roundsTotal ? 'bgm-final' : 'bgm-gameplay'); }, [game.round, game.roundsTotal]);
  // 라운드가 바뀌면 장소는 유지하고 변화 요약 한 줄만
  useEffect(() => {
    if (game.round !== lastRound) {
      setLastRound(game.round);
      const done = team?.processes.length ?? 0;
      setSummary(`${game.round}라운드 시작 · 완성품이 트레이에 들어왔어요${done ? ` · 아직 만드는 중 ${done}개` : ''} · 시세가 새로 정해졌어요`);
      setTimeout(() => setSummary(null), 6000);
    }
  }, [game.round, lastRound, team?.processes.length]);
  useEffect(() => { if (roomCode) client.send({ type: 'observe', place }); /* 관측용, 응답 무시 */ }, [place, roomCode, client]);

  const send = async (cmd: TeamCommand, okSfx?: string) => {
    const r = await client.send({ type: 'team', cmd });
    previewStore.set(null); // 버튼이 사라져도 미리보기가 남지 않게
    if (!r.ok) { store.toast(r.error ?? '지금은 할 수 없어요.', 'error'); audio.sfx('sfx-invalid'); }
    else if (okSfx) audio.sfx(okSfx);
    return r.ok;
  };
  const goTo = (p: Place, target: string | null = null) => { setHighlight(target); setPlace(p); };

  const hint = useMemo(() => nextHint(view, focusId), [view, focusId]);
  const badges = useMemo(() => {
    const b: Partial<Record<Place, string>> = {};
    if (!team) return b;
    const deliverable = team.contracts.filter((c) => contractSatisfiable(team, c).ok).length;
    if (deliverable) b.shipping = `배달 ${deliverable}`;
    const sortable = team.lots.filter((l) => l.kind === 'mixture' || (l.kind === 'pure' && l.materialId === 'H2O_g')).length;
    if (sortable) b.workshop = `정리 ${sortable}`;
    if (team.contracts.length === 0 && team.offers.length) b.orders = `새 ${team.offers.length}`;
    return b;
  }, [team]);

  if (game.phase === 'finished' && game.results) return <ResultsScreen view={view} onLeave={onLeave} />;

  if (!team) {
    return (
      <div className="screen" style={{ padding: 16 }}>
        <div className="card center"><h2>구경 중</h2><p className="muted">팀에 들어가 있지 않아 공개된 진행만 볼 수 있어요. 선생님이 팀에 넣어 줄 수 있어요.</p>
          <div className="others" style={{ marginTop: 12 }}>{view.teams.map((t) => <div key={t.id} className="other"><Emblem shape={t.emblem} color={t.color} /><span>{t.name}</span><span className="muted small">주문 {t.contractsHeld} · 배달 {t.delivered} · {t.roundReady ? '준비 완료' : '진행 중'}</span></div>)}</div>
          <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={onLeave}>나가기</button>
        </div>
      </div>
    );
  }

  const placeEl = place === 'orders' ? <OrdersPlace view={view} send={send} focusId={focusId} setFocus={setFocus} canPlan={canPlan} goTo={goTo} />
    : place === 'workshop' ? <WorkshopPlace view={view} send={send} focusId={focusId} canAct={canAct} goTo={goTo} highlight={highlight} />
    : place === 'store' ? <StorePlace view={view} send={send} focusId={focusId} canAct={canAct} goTo={goTo} highlight={highlight} />
    : <ShippingPlace view={view} send={send} focusId={focusId} setFocus={setFocus} canAct={canAct} goTo={goTo} highlight={highlight} />;

  return (
    <div className="game-shell">
      <Hud view={view} place={place} onPlace={(p) => goTo(p, hint.place === p ? hint.target ?? null : null)} hint={hint} badges={badges}
        onReady={(on) => send({ type: 'readyRound', on }, on ? 'sfx-turn' : undefined)} onHelp={() => setHelp(true)} onCodex={() => setCodex(true)} onLeave={onLeave}
        extra={<>{headerExtra}<button className="btn btn-sm btn-ghost" onClick={() => setTeamPanel(true)}>팀</button></>} />
      {summary && <div className="round-summary" role="status">{summary}</div>}
      <main className="place-view" key={place}>{placeEl}</main>
      <MobileNav place={place} onPlace={(p) => goTo(p)} badges={badges} />
      {help && <HelpModal isLocal={client.kind === 'local'} onClose={() => { setHelp(false); prefSet('help.seen', '1'); }} />}
      {codex && <Codex activeReactions={game.activeReactions} onClose={() => setCodex(false)} />}
      {teamPanel && <TeamPanel view={view} send={send} onClose={() => setTeamPanel(false)} />}
    </div>
  );
}

function TeamPanel({ view, send, onClose }: { view: ClientView; send: (cmd: TeamCommand) => Promise<boolean>; onClose: () => void }) {
  const g = view.game!;
  const t = g.myTeam!;
  const members = view.teams.find((x) => x.id === t.id)?.members ?? [];
  return (
    <div className="modal-bg" onClick={onClose} role="presentation">
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head"><h3><Emblem shape={t.emblem} color={t.color} size={18} /> {t.name}</h3><button className="x" onClick={onClose} aria-label="닫기">×</button></div>
        <div className="members">
          {members.map((pid) => { const p = view.players.find((x) => x.id === pid); if (!p) return null; return <div key={pid} className={`member ${t.operatorId === pid ? 'operator' : ''} ${pid === view.me.playerId ? 'me' : ''}`}><span className={`dot ${p.connected ? '' : 'off'}`} />{p.nick}{t.operatorId === pid && <span className="tag tag-amber">차례</span>}{p.isLeader && <span className="small">★</span>}{view.me.isLeader && t.operatorId !== pid && p.connected && <button className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => send({ type: 'memo', text: t.memo })}>{''}</button>}</div>; })}
        </div>
        <div className="divider" />
        <div className="panel-title">다음 사람에게 메모</div>
        <textarea className="input" rows={2} defaultValue={t.memo} key={t.memo} maxLength={200} placeholder="예: 다음엔 수증기를 응축해서 배달하면 돼" onBlur={(e) => { if (e.target.value !== t.memo) send({ type: 'memo', text: e.target.value }); }} />
        <div className="panel-title" style={{ marginTop: 8 }}>팀원 추천</div>
        <div className="pins">{t.pins.length === 0 && <p className="muted small">카드나 주문에서 👍를 누르면 여기에 나와요.</p>}{t.pins.slice().reverse().map((p, i) => <div key={i} className="pin"><b>{view.players.find((x) => x.id === p.playerId)?.nick ?? '?'}</b>: {p.label}</div>)}</div>
        <div className="divider" />
        <div className="panel-title">다른 팀</div>
        <div className="others">{view.teams.filter((x) => x.id !== t.id).map((x) => <div key={x.id} className="other"><Emblem shape={x.emblem} color={x.color} size={20} /><span>{x.name}<div className="muted small">주문 {x.contractsHeld} · 배달 {x.delivered} · {x.roundReady ? '준비 완료' : '진행 중'}</div></span><span className="small muted">{x.assetHistory[x.assetHistory.length - 1] ?? '-'}</span></div>)}</div>
        <div className="panel-title" style={{ marginTop: 8 }}>소식</div>
        <div className="small" style={{ maxHeight: 120, overflow: 'auto' }}>{g.log.slice(-12).reverse().map((l, i) => <div key={i} className="muted">{l.round}R {l.text}</div>)}</div>
      </div>
    </div>
  );
}
