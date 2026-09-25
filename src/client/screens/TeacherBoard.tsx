import { useState } from 'react';
import type { ClientView } from '../../shared/protocol';
import type { GameClient } from '../lib/net';
import { REACTIONS } from '../../shared/chemistry/reactions';
import { PROCESSES } from '../../shared/chemistry/processes';
import { MATERIALS } from '../../shared/chemistry/materials';
import { useCountdown } from '../lib/useCountdown';
import { store } from '../lib/store';
import { Emblem } from '../components/Emblem';
import { Wordmark, Modal } from '../components/common';
import { Spark } from './GameScreen';
import { ResultsScreen } from './ResultsScreen';

const PHASE_LABEL = { plan: '계획', execute: '실행', settle: '정산·인계', finished: '종료', setup: '준비' } as const;

/** 교사 관전 보드: 모든 팀 진행을 한 화면에서. 교사가 팀에 참가했으면 '내 팀 보드'로 전환할 수 있다. */
export function TeacherBoard({ view, client, onLeave, onSwitchToTeam, teacherKey }: { view: ClientView; client: GameClient; onLeave: () => void; onSwitchToTeam?: () => void; teacherKey: string | null }) {
  const game = view.game!;
  const seconds = useCountdown(view.room.phaseEndsAt, view.room.pausedRemaining);
  const [opTeam, setOpTeam] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const send = async (cmd: Parameters<GameClient['send']>[0]) => { const r = await client.send(cmd); if (!r.ok) store.toast(r.error ?? '실패', 'error'); return r.ok; };
  const exportAll = async () => {
    if (!teacherKey) return;
    const res = await fetch(`/api/rooms/${view.room.code}/export`, { headers: { 'x-teacher-key': teacherKey } });
    const blob = new Blob([await res.text()], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `reaction-guild-${view.room.code}-full.json`; a.click();
  };
  if (game.phase === 'finished' && game.results) return <ResultsScreen view={view} onLeave={onLeave} teacherExport={exportAll} />;
  const teams = view.teacherTeams ?? [];
  return (
    <div className="tboard" style={{ background: 'var(--ivory)' }}>
      <header className="board-head">
        <Wordmark compact />
        <span className="round-label">R{game.round}/{game.roundsTotal}</span>
        <span className={`phase-pill phase-${game.phase}`}>{PHASE_LABEL[game.phase]}{view.room.status === 'paused' ? ' · 일시정지' : ''}</span>
        <span className={`timer ${seconds <= 10 ? 'low' : ''}`}>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>
        <div className="tctrl">
          {view.room.status === 'paused' ? <button className="btn btn-sm btn-primary" onClick={() => send({ type: 'resume' })}>재개</button> : <button className="btn btn-sm" onClick={() => send({ type: 'pause' })}>일시정지</button>}
          <button className="btn btn-sm" onClick={() => send({ type: 'extend', seconds: 30 })}>+30초</button>
          <select className="input" style={{ minHeight: 32, width: 110, padding: '2px 6px', fontSize: 13 }} value={view.room.timerScale} onChange={(e) => send({ type: 'setTimerScale', scale: Number(e.target.value) })} aria-label="타이머 배율">
            {[0.75, 1, 1.25, 1.5, 2].map((s) => <option key={s} value={s}>타이머 ×{s}</option>)}
          </select>
          <button className="btn btn-sm btn-danger" onClick={() => setConfirmEnd(true)}>조기 종료</button>
        </div>
        <span style={{ flex: 1 }} />
        {onSwitchToTeam && <button className="btn btn-sm btn-copper" onClick={onSwitchToTeam}>내 팀 보드</button>}
        <button className="btn btn-sm btn-ghost" onClick={onLeave}>나가기</button>
      </header>
      <div className="tgrid">
        {teams.map((t) => {
          const pub = view.teams.find((x) => x.id === t.id);
          const members = pub?.members ?? [];
          const op = view.players.find((p) => p.id === t.operatorId);
          return (
            <div key={t.id} className="tteam" style={{ borderTopColor: t.color }}>
              <div className="thead"><Emblem shape={t.emblem} color={t.color} size={22} /><b style={{ fontSize: 15 }}>{t.name}</b><span className="tag">코인 {t.coins}</span><span className="tag">에너지 {t.energy}</span><span className="tag">행동 {t.actionsLeft}</span><span style={{ flex: 1 }} /><Spark data={t.assetHistory} color={t.color} /></div>
              <div className="row" style={{ marginBottom: 4 }}>
                <span className="tag tag-amber">담당 {op?.nick ?? '-'}{op && !op.connected ? ' (끊김)' : ''}</span>
                <button className="btn btn-sm btn-ghost" onClick={() => setOpTeam(t.id)}>조작권 넘기기</button>
                <span className="muted small">{members.map((m) => { const p = view.players.find((x) => x.id === m); return p ? `${p.nick}${p.connected ? '' : '(끊김)'}` : ''; }).join(', ')}</span>
              </div>
              <div className="small"><b>공정:</b> {t.processes.length ? t.processes.map((p) => `${p.kind === 'reaction' ? REACTIONS[p.defId]!.name : PROCESSES[p.defId]!.name}→${p.completesRound}R`).join(', ') : '없음'}</div>
              <div className="small"><b>계약:</b> {t.contracts.length ? t.contracts.map((c) => `${c.title}(${c.deadlineRound}R)`).join(', ') : '없음'} · 납품 {t.delivered}</div>
              <div className="small"><b>재고:</b> {t.lots.slice(0, 8).map((l) => l.kind === 'pure' ? `${MATERIALS[l.materialId!]!.formula}×${l.units}` : `혼합(${l.origin.reactionId})`).join(' ')}{t.lots.length > 8 ? ' …' : ''}</div>
              {t.memo && <div className="small muted">메모: {t.memo}</div>}
            </div>
          );
        })}
      </div>
      {opTeam && (
        <Modal title="조작권 넘기기" onClose={() => setOpTeam(null)}>
          <div className="stack">{(view.teams.find((t) => t.id === opTeam)?.members ?? []).map((m) => { const p = view.players.find((x) => x.id === m); return <button key={m} className="btn" onClick={async () => { if (await send({ type: 'setOperator', teamId: opTeam, playerId: m })) setOpTeam(null); }}>{p?.nick ?? m} {p?.connected ? '' : '(끊김)'}</button>; })}</div>
        </Modal>
      )}
      {confirmEnd && (
        <Modal title="조기 종료" onClose={() => setConfirmEnd(false)}>
          <p>현재 라운드를 마지막으로 정산하고 결과를 계산합니다. 되돌릴 수 없습니다.</p>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><button className="btn btn-ghost" onClick={() => setConfirmEnd(false)}>취소</button><button className="btn btn-danger" onClick={async () => { if (await send({ type: 'endGame' })) setConfirmEnd(false); }}>종료</button></div>
        </Modal>
      )}
    </div>
  );
}
