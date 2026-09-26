import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { ClientView, TeamPublic } from '../../shared/protocol';
import type { GameClient } from '../lib/net';
import { TEAM_COLORS, TEAM_EMBLEMS, EMBLEM_LABEL } from '../../shared/engine/state';
import { DEFAULT_ECONOMY } from '../../shared/config/economy';
import { EQUIPMENT } from '../../shared/chemistry/equipment';
import { MATERIALS } from '../../shared/chemistry/materials';
import { MODES } from '../../shared/chemistry/modes';
import { store } from '../lib/store';
import { imageUrl } from '../lib/assets';
import { audio } from '../lib/audio';
import { Emblem } from '../components/Emblem';
import { Wordmark, Modal } from '../components/common';
import { Codex } from '../components/Codex';

export function LobbyScreen({ view, client, onLeave }: { view: ClientView; client: GameClient; onLeave: () => void }) {
  const me = view.me;
  const isTeacher = me.role === 'teacher';
  const [qr, setQr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [codex, setCodex] = useState(false);
  const bg = imageUrl('bg-lobby');
  useEffect(() => { audio.bgm('bgm-lobby'); }, []);
  useEffect(() => {
    if (!isTeacher) return;
    QRCode.toDataURL(view.room.joinUrl, { width: 240, margin: 1, color: { dark: '#17494D', light: '#FFFFFF' } }).then(setQr).catch(() => setQr(null));
  }, [view.room.joinUrl, isTeacher]);
  const send = async (cmd: Parameters<GameClient['send']>[0]) => { const r = await client.send(cmd); if (!r.ok) store.toast(r.error ?? '실패', 'error'); return r.ok; };
  const myTeam = view.teams.find((t) => t.id === me.teamId) ?? null;
  const students = view.players.filter((p) => p.role !== 'teacher');
  const unassigned = students.filter((p) => !p.teamId);
  const allReady = view.teams.length > 0 && view.teams.every((t) => t.ready || t.members.length === 0);
  const canCreate = (me.isLeader || isTeacher) && !me.teamId;

  return (
    <div className="screen">
      <div className={`bg-full ${bg ? '' : 'bg-fallback-lobby'}`} style={bg ? { backgroundImage: `url(${bg})`, opacity: 0.9 } : undefined} />
      <div className="bg-content lobby">
        <aside className="stack">
          <div className="card"><Wordmark compact /><div className="muted small" style={{ marginTop: 6 }}>{MODES[view.room.mode].name} · {MODES[view.room.mode].presets.find((p) => p.id === view.room.presetId)?.name} · {view.room.rounds}라운드</div></div>
          {isTeacher ? (
            <div className="card stack">
              <div className="card-title">학생 입장</div>
              <div className="code-box" aria-label={`방 코드 ${view.room.code}`}>{view.room.code}</div>
              <div className="qr-box">{qr ? <img src={qr} alt="입장 QR 코드" /> : <span className="muted small">{view.room.joinUrl}</span>}</div>
              <div className="row"><button className="btn btn-sm btn-block" onClick={() => { navigator.clipboard?.writeText(view.room.joinUrl).then(() => store.toast('링크를 복사했습니다', 'success')).catch(() => {}); }}>링크 복사</button><button className="btn btn-sm btn-block" onClick={() => send({ type: 'lock', on: !view.room.locked })}>{view.room.locked ? '입장 열기' : '입장 잠금'}</button></div>
              <p className="muted small">교사 복구 정보는 이 링크에 포함되지 않습니다. 교사 화면은 로그인으로 복구합니다.</p>
            </div>
          ) : (
            <div className="card"><div className="card-title">내 정보</div><p><b>{me.nick}</b> {me.isLeader && <span className="tag tag-amber">팀장</span>} {me.role === 'spectator' && <span className="tag">관전자</span>}</p><p className="muted small">방 {view.room.code} · 교사 {view.room.teacherNick}</p></div>
          )}
          <div className="card">
            <div className="card-title">참가자 {students.length}명 {isTeacher && <span className="muted small">(이름을 눌러 팀장 임명)</span>}</div>
            <div className="player-list">
              {students.map((p) => (
                <div key={p.id} className={`player-row ${p.connected ? '' : 'offline'}`}>
                  <span className={`dot ${p.connected ? '' : 'off'}`} />
                  <span style={{ flex: 1 }}>{p.nick} {p.isLeader && <span className="tag tag-amber">팀장</span>} {p.teamId && <span className="muted small">{view.teams.find((t) => t.id === p.teamId)?.name}</span>}</span>
                  {isTeacher && <>
                    <button className="btn btn-sm btn-ghost" onClick={() => send({ type: 'appointLeader', playerId: p.id, on: !p.isLeader })}>{p.isLeader ? '해제' : '팀장'}</button>
                    <TeacherMove p={p} teams={view.teams} onMove={(teamId) => send({ type: 'movePlayer', playerId: p.id, teamId })} />
                    <button className="btn btn-sm btn-ghost" aria-label="내보내기" onClick={() => send({ type: 'kickPlayer', playerId: p.id })}>✕</button>
                  </>}
                </div>
              ))}
              {students.length === 0 && <p className="muted small">아직 아무도 들어오지 않았습니다.</p>}
            </div>
          </div>
          <div className="card row"><button className="btn btn-ghost btn-block" onClick={() => setCodex(true)}>도감·규칙</button><button className="btn btn-ghost btn-block" onClick={onLeave}>나가기</button></div>
        </aside>

        <main className="stack">
          <div className="card">
            <div className="row-between">
              <div><h2 style={{ color: 'var(--teal)' }}>길드 편성</h2><p className="muted small">교사가 팀장을 임명 → 팀장이 팀을 만들고 시작 재료를 고름 → 학생이 팀 선택 → 팀장이 준비 → 교사가 시작. 권장 6팀 × 5명, 팀은 2~8개.</p></div>
              <div className="row">
                {canCreate && <button className="btn btn-primary" onClick={() => setCreating(true)}>{isTeacher ? '교사가 팀으로 참가' : '내 팀 만들기'}</button>}
                {isTeacher && me.teamId && <button className="btn btn-ghost" onClick={() => send({ type: 'teacherLeaveTeam' })}>팀에서 나가기 (관전)</button>}
                {isTeacher && <button className="btn btn-copper btn-lg" disabled={view.teams.length === 0} onClick={() => { if (!allReady && !confirm('아직 준비를 누르지 않은 팀이 있습니다. 시작할까요?')) return; send({ type: 'start' }); }}>게임 시작</button>}
              </div>
            </div>
          </div>
          <div className="team-grid">
            {view.teams.map((t) => <TeamCard key={t.id} t={t} view={view} isMine={t.id === me.teamId} send={send} />)}
            {view.teams.length === 0 && <div className="card muted">아직 팀이 없습니다. {isTeacher ? '참가자 목록에서 팀장을 임명하세요.' : '팀장이 팀을 만들면 여기에 나타납니다.'}</div>}
          </div>
          {unassigned.length > 0 && view.teams.length > 0 && <p className="muted small">아직 팀이 없는 학생: {unassigned.map((p) => p.nick).join(', ')}</p>}
          {!isTeacher && !me.teamId && !me.isLeader && me.role === 'student' && <div className="card center"><p>팀 카드의 <b>참가</b>를 눌러 팀에 들어가세요.</p></div>}
          {me.role === 'spectator' && <div className="card center"><p>경기 시작 후 들어와 관전자입니다. 교사가 팀에 편입할 수 있습니다.</p></div>}
        </main>
      </div>
      {creating && <CreateTeamModal view={view} onClose={() => setCreating(false)} onCreate={async (name, color, emblem) => { const ok = await send(isTeacher ? { type: 'teacherJoinTeam', name, color, emblem } : { type: 'createTeam', name, color, emblem }); if (ok) setCreating(false); }} />}
      {codex && <Codex onClose={() => setCodex(false)} />}
      {myTeam && !isTeacher && <div className="hidden" />}
    </div>
  );
}

function TeacherMove({ p, teams, onMove }: { p: { teamId: string | null }; teams: TeamPublic[]; onMove: (teamId: string | null) => void }) {
  return (
    <select className="input" style={{ width: 100, minHeight: 30, padding: '2px 4px', fontSize: 12 }} value={p.teamId ?? ''} onChange={(e) => onMove(e.target.value || null)} aria-label="팀 이동">
      <option value="">팀 없음</option>
      {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
  );
}

function TeamCard({ t, view, isMine, send }: { t: TeamPublic; view: ClientView; isMine: boolean; send: (cmd: Parameters<GameClient['send']>[0]) => Promise<boolean> }) {
  const me = view.me;
  const isTeacher = me.role === 'teacher';
  const isLeader = t.leaderId === me.playerId;
  const bundle = DEFAULT_ECONOMY.bundles.find((b) => b.id === t.bundleId) ?? DEFAULT_ECONOMY.bundles[0]!;
  const leasable = view.room.mode === 'industrial' ? ['U05', 'U06', 'U07'] : [];
  return (
    <div className={`team-card ${isMine ? 'mine' : ''}`}>
      <div className="team-head"><Emblem shape={t.emblem} color={t.color} size={28} /><span className="team-name">{t.name}</span>{t.ready && <span className="tag tag-teal">준비</span>}<span style={{ flex: 1 }} /><span className="muted small">{t.members.length}명</span></div>
      <div>{t.members.map((m) => { const p = view.players.find((x) => x.id === m); return p ? <span key={m} className={`member-chip ${p.id === t.leaderId ? 'leader' : ''} ${p.connected ? '' : 'off'}`}>{p.nick}</span> : null; })}</div>
      <div className="divider" />
      {isLeader ? (
        <div className="stack">
          <label className="label">시작 재료 (팀장이 고름, 다른 팀과 겹쳐도 됨)</label>
          {DEFAULT_ECONOMY.bundles.map((b) => <button key={b.id} className={`btn btn-sm ${t.bundleId === b.id ? 'btn-primary' : 'btn-ghost'}`} style={{ justifyContent: 'flex-start', textAlign: 'left' }} onClick={() => send({ type: 'setBundle', bundleId: b.id })}><span><b>{b.name}</b> <span className="small" style={{ opacity: 0.85 }}>{b.items.map((i) => `${MATERIALS[i.materialId]!.displayName} ${i.units}개`).join(' · ')}{b.extraCoins ? ` +${b.extraCoins}코인` : ''}</span><div className="small" style={{ opacity: 0.8 }}>{b.blurb}</div></span></button>)}
          {leasable.length > 0 && <><label className="label">무료로 빌릴 장비 1개 (끝날 때 돌려받는 값 0)</label><div className="row">{leasable.map((e) => <button key={e} className={`btn btn-sm ${t.leaseId === e ? 'btn-primary' : 'btn-ghost'}`} onClick={() => send({ type: 'setLease', equipmentId: e })}>{EQUIPMENT[e]!.name}</button>)}</div></>}
          {t.members.length > 1 && <MemberOrder t={t} view={view} onReorder={(order) => send({ type: 'reorderMembers', order })} />}
          <button className={`btn ${t.ready ? 'btn-ghost' : 'btn-copper'}`} onClick={() => send({ type: 'ready', on: !t.ready })}>{t.ready ? '준비 취소' : '준비 완료'}</button>
        </div>
      ) : (
        <div className="stack">
          <span className="small">시작 재료: <b>{bundle.name}</b>{t.leaseId ? ` · 빌린 장비 ${EQUIPMENT[t.leaseId]!.name}` : ''}</span>
          {!me.teamId && me.role === 'student' && !isTeacher && <button className="btn btn-primary" onClick={() => send({ type: 'joinTeam', teamId: t.id })}>참가</button>}
          {isMine && !isLeader && !isTeacher && <button className="btn btn-ghost btn-sm" onClick={() => send({ type: 'leaveTeam' })}>팀 나가기</button>}
          {isTeacher && <div className="row"><TeacherLeaderSelect t={t} view={view} onSet={(pid) => send({ type: 'setTeamLeader', teamId: t.id, playerId: pid })} /><button className="btn btn-sm btn-ghost" onClick={() => { if (confirm(`${t.name} 팀을 해산할까요?`)) send({ type: 'disbandTeam', teamId: t.id }); }}>해산</button></div>}
        </div>
      )}
    </div>
  );
}

function TeacherLeaderSelect({ t, view, onSet }: { t: TeamPublic; view: ClientView; onSet: (pid: string) => void }) {
  return (
    <select className="input" style={{ minHeight: 30, padding: '2px 4px', fontSize: 12, width: 130 }} value={t.leaderId ?? ''} onChange={(e) => e.target.value && onSet(e.target.value)} aria-label="팀장 교체">
      {t.members.map((m) => <option key={m} value={m}>{view.players.find((p) => p.id === m)?.nick ?? m} {m === t.leaderId ? '(팀장)' : ''}</option>)}
    </select>
  );
}

function MemberOrder({ t, view, onReorder }: { t: TeamPublic; view: ClientView; onReorder: (order: string[]) => void }) {
  const move = (i: number, d: number) => {
    const arr = t.members.slice();
    const j = i + d;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    onReorder(arr);
  };
  return (
    <div>
      <label className="label">차례 순서 (첫 라운드부터 이 순서로 돌아가요)</label>
      {t.members.map((m, i) => <div key={m} className="row small" style={{ justifyContent: 'space-between', padding: '2px 0' }}><span>{i + 1}. {view.players.find((p) => p.id === m)?.nick}</span><span><button className="btn btn-sm btn-ghost" onClick={() => move(i, -1)} aria-label="위로">↑</button><button className="btn btn-sm btn-ghost" onClick={() => move(i, 1)} aria-label="아래로">↓</button></span></div>)}
    </div>
  );
}

function CreateTeamModal({ view, onClose, onCreate }: { view: ClientView; onClose: () => void; onCreate: (name: string, color: string, emblem: string) => void }) {
  const usedColors = new Set(view.teams.map((t) => t.color));
  const usedEmblems = new Set(view.teams.map((t) => t.emblem));
  const [name, setName] = useState('');
  const [color, setColor] = useState(TEAM_COLORS.find((c) => !usedColors.has(c)) ?? TEAM_COLORS[0]!);
  const [emblem, setEmblem] = useState<string>(TEAM_EMBLEMS.find((e) => !usedEmblems.has(e)) ?? 'circle');
  return (
    <Modal title="팀 만들기" onClose={onClose}>
      <div className="field"><label className="label" htmlFor="teamname">팀 이름 (12자)</label><input id="teamname" className="input" value={name} maxLength={12} onChange={(e) => setName(e.target.value)} placeholder="예: 구리 연금단" autoFocus /></div>
      <div className="field"><label className="label">팀 색</label><div className="swatches">{TEAM_COLORS.map((c) => <button key={c} className={`swatch ${color === c ? 'active' : ''}`} style={{ background: c, opacity: usedColors.has(c) ? 0.25 : 1 }} disabled={usedColors.has(c)} onClick={() => setColor(c)} aria-label={`색 ${c}`} />)}</div></div>
      <div className="field"><label className="label">팀 문양</label><div className="emblem-pick">{TEAM_EMBLEMS.map((e) => <button key={e} className={emblem === e ? 'active' : ''} disabled={usedEmblems.has(e)} onClick={() => setEmblem(e)} aria-label={EMBLEM_LABEL[e]}><Emblem shape={e} color={color} size={26} /></button>)}</div></div>
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn btn-ghost" onClick={onClose}>취소</button><button className="btn btn-primary" disabled={!name.trim()} onClick={() => onCreate(name.trim(), color, emblem)}>만들기</button></div>
    </Modal>
  );
}
