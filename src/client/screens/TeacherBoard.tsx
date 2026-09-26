import { useState } from 'react';
import type { ClientView } from '../../shared/protocol';
import type { GameClient } from '../lib/net';
import { REACTIONS } from '../../shared/chemistry/reactions';
import { PROCESSES } from '../../shared/chemistry/processes';
import { MATERIALS } from '../../shared/chemistry/materials';
import { CATEGORY_LABEL } from '../../shared/chemistry/contracts';
import { MARKET_STEP } from '../../shared/engine/market';
import { store } from '../lib/store';
import { Emblem } from '../components/Emblem';
import { Wordmark, Modal } from '../components/common';
import { Spark } from '../components/Spark';
import { ResultsScreen } from './ResultsScreen';

/** 교사 관전 보드: 모든 팀의 준비·연결·남은 행동을 한 화면에서. 진행이 어디서 막혔는지 보인다. */
export function TeacherBoard({ view, client, onLeave, onSwitchToTeam, teacherKey }: { view: ClientView; client: GameClient; onLeave: () => void; onSwitchToTeam?: () => void; teacherKey: string | null }) {
  const game = view.game!;
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
  const manual = view.room.turnMode === 'manual';
  const waiting = view.teams.filter((t) => !t.roundReady);
  return (
    <div className="tboard" style={{ background: 'var(--ivory)' }}>
      <header className="board-head">
        <Wordmark compact />
        <span className="round-label">{game.round}/{game.roundsTotal} 라운드</span>
        <span className={`tag ${waiting.length ? 'tag-amber' : 'tag-teal'}`}>{manual ? `준비 ${game.readyCount}/${game.teamCount} 팀` : '시간제(구버전) 방'}</span>
        {view.room.status === 'paused' && <span className="tag tag-danger">멈춤</span>}
        <div className="tctrl">
          {view.room.status === 'paused' ? <button className="btn btn-sm btn-primary" onClick={() => send({ type: 'resume' })}>다시 시작</button> : <button className="btn btn-sm" onClick={() => send({ type: 'pause' })}>잠시 멈춤</button>}
          {!manual && <button className="btn btn-sm btn-copper" onClick={() => send({ type: 'switchToManual' })}>수동 진행으로 전환</button>}
          <button className="btn btn-sm btn-danger" onClick={() => setConfirmEnd(true)}>조기 종료</button>
        </div>
        <span style={{ flex: 1 }} />
        {onSwitchToTeam && <button className="btn btn-sm btn-copper" onClick={onSwitchToTeam}>내 팀 화면</button>}
        <button className="btn btn-sm btn-ghost" onClick={onLeave}>나가기</button>
      </header>
      {waiting.length > 0 && manual && <p className="small" style={{ margin: '0 0 6px', padding: '6px 10px', background: 'var(--amber-soft)', borderRadius: 8 }}>기다리는 팀: {waiting.map((t) => `${t.name}(남은 행동 ${t.actionsLeft}, 접속 ${t.connectedCount}명)`).join(' · ')} — 팀이 멈춰 있으면 "이번 라운드 건너뛰기"나 "차례 넘기기"를 쓰세요.</p>}
      <div className="tgrid">
        {teams.map((t) => {
          const pub = view.teams.find((x) => x.id === t.id);
          const members = pub?.members ?? [];
          const op = view.players.find((p) => p.id === t.operatorId);
          return (
            <div key={t.id} className="tteam" style={{ borderTopColor: t.color }}>
              <div className="thead"><Emblem shape={t.emblem} color={t.color} size={22} /><b style={{ fontSize: 15 }}>{t.name}</b><span className={`tag ${t.roundReady ? 'tag-teal' : 'tag-amber'}`}>{t.roundReady ? '준비 완료' : `행동 ${t.actionsLeft} 남음`}</span><span className="tag">코인 {t.coins}</span><span className="tag">에너지 {t.energy}</span><span style={{ flex: 1 }} /><Spark data={t.assetHistory} color={t.color} /></div>
              <div className="row" style={{ marginBottom: 4 }}>
                <span className="tag tag-amber">차례 {op?.nick ?? '-'}{op && !op.connected ? ' (끊김)' : ''}</span>
                <button className="btn btn-sm btn-ghost" onClick={() => setOpTeam(t.id)}>차례 넘기기</button>
                {manual && !t.roundReady && <button className="btn btn-sm btn-ghost" onClick={() => { if (confirm(`${t.name} 팀의 이번 라운드를 건너뛸까요? 남은 행동 ${t.actionsLeft}번은 버려져요.`)) send({ type: 'skipTeam', teamId: t.id }); }}>이번 라운드 건너뛰기</button>}
                <span className="muted small">{members.map((m) => { const p = view.players.find((x) => x.id === m); return p ? `${p.nick}${p.connected ? '' : '(끊김)'}` : ''; }).join(', ')}</span>
              </div>
              <div className="small"><b>만드는 중:</b> {t.processes.length ? t.processes.map((p) => `${p.kind === 'reaction' ? REACTIONS[p.defId]!.name : PROCESSES[p.defId]!.name}→${p.completesRound}R`).join(', ') : '없음'}</div>
              <div className="small"><b>주문:</b> {t.contracts.length ? t.contracts.map((c) => `${c.title}(${c.deadlineRound}R)`).join(', ') : '없음'} · 배달 {t.delivered}</div>
              <div className="small"><b>창고:</b> {t.lots.slice(0, 8).map((l) => l.kind === 'pure' ? `${MATERIALS[l.materialId!]!.displayName}×${l.units}` : `섞인 것(${l.origin.reactionId})`).join(' ')}{t.lots.length > 8 ? ' …' : ''}</div>
              {t.memo && <div className="small muted">메모: {t.memo}</div>}
            </div>
          );
        })}
        <div className="tteam" style={{ borderTopColor: 'var(--copper)' }}>
          <div className="thead"><b>이번 라운드 시세</b></div>
          <div className="row">{Object.entries(game.market).map(([c, z]) => <span key={c} className="tag">{CATEGORY_LABEL[c as keyof typeof CATEGORY_LABEL] ?? c} {z > 0 ? '+' : ''}{Math.round(z * MARKET_STEP * 100)}%</span>)}</div>
          <p className="small muted" style={{ marginTop: 6 }}>모든 팀에 같은 시세가 적용되고, 라운드가 바뀔 때만 변해요.</p>
        </div>
      </div>
      {opTeam && (
        <Modal title="차례 넘기기" onClose={() => setOpTeam(null)}>
          <div className="stack">{(view.teams.find((t) => t.id === opTeam)?.members ?? []).map((m) => { const p = view.players.find((x) => x.id === m); return <button key={m} className="btn" onClick={async () => { if (await send({ type: 'setOperator', teamId: opTeam, playerId: m })) setOpTeam(null); }}>{p?.nick ?? m} {p?.connected ? '' : '(끊김)'}</button>; })}</div>
        </Modal>
      )}
      {confirmEnd && (
        <Modal title="조기 종료" onClose={() => setConfirmEnd(false)}>
          <p>현재 라운드를 마지막으로 마무리하고 결과를 계산합니다. 되돌릴 수 없습니다.</p>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><button className="btn btn-ghost" onClick={() => setConfirmEnd(false)}>취소</button><button className="btn btn-danger" onClick={async () => { if (await send({ type: 'endGame' })) setConfirmEnd(false); }}>종료</button></div>
        </Modal>
      )}
    </div>
  );
}
