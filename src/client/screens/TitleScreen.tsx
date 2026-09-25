import { useEffect, useState } from 'react';
import { imageUrl } from '../lib/assets';
import { api } from '../lib/net';
import { loadTeacherKey, saveTeacherKey, loadSession, roomFromUrl, loadRecentRooms, rememberRoom } from '../lib/session';
import { MODES } from '../../shared/chemistry/modes';
import { ROUND_PRESETS } from '../../shared/config/economy';
import { store } from '../lib/store';
import { audio } from '../lib/audio';
import { Wordmark } from '../components/common';
import { Codex } from '../components/Codex';
import type { ModeId } from '../../shared/types';

export interface JoinResult { code: string; playerId: string; token: string; nick: string; role: 'student' | 'spectator' | 'teacher' }

export function TitleScreen({ onJoin, onPractice }: { onJoin: (r: JoinResult) => void; onPractice: (mode: ModeId) => void }) {
  const [tab, setTab] = useState<'student' | 'teacher' | 'practice'>(roomFromUrl() ? 'student' : 'student');
  const [codex, setCodex] = useState(false);
  const bg = imageUrl('bg-title');
  const [audioOpen, setAudioOpen] = useState(false);
  return (
    <div className="screen title-screen">
      <div className={`bg-full ${bg ? '' : 'bg-fallback-title'}`} style={bg ? { backgroundImage: `url(${bg})` } : undefined} />
      <div className="bg-content title-panel fade-in">
        <Wordmark />
        <p className="center muted" style={{ marginBottom: 14 }}>작은 화학 공방을 운영하는 길드가 원료를 사고 반응을 연결해 도시의 주문을 납품합니다.<br />부산물까지 활용해 가장 높은 자산을 만든 길드가 승리합니다.</p>
        <div className="tabs" role="tablist">
          <button role="tab" className={tab === 'student' ? 'active' : ''} onClick={() => setTab('student')}>학생 입장</button>
          <button role="tab" className={tab === 'teacher' ? 'active' : ''} onClick={() => setTab('teacher')}>교사</button>
          <button role="tab" className={tab === 'practice' ? 'active' : ''} onClick={() => setTab('practice')}>연습</button>
        </div>
        {tab === 'student' && <StudentJoin onJoin={onJoin} />}
        {tab === 'teacher' && <TeacherPanel onJoin={onJoin} />}
        {tab === 'practice' && (
          <div className="stack">
            <p className="small">혼자 3분 안에 AI 공방과 한 주문을 완료해 봅니다. 담당자는 항상 나, 라운드는 6개, 단계 시간은 짧게.</p>
            <div className="row">{(['classic', 'extended', 'industrial'] as ModeId[]).map((m) => <button key={m} className="btn btn-primary btn-block" onClick={() => onPractice(m)}>{MODES[m].name}</button>)}</div>
          </div>
        )}
        <div className="row" style={{ justifyContent: 'center', marginTop: 14 }}>
          <button className="btn btn-sm btn-ghost" onClick={() => setCodex(true)}>도감·규칙</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setAudioOpen((v) => !v)}>소리 설정</button>
        </div>
        {audioOpen && <AudioSettings />}
      </div>
      {codex && <Codex onClose={() => setCodex(false)} />}
    </div>
  );
}

export function AudioSettings() {
  const [, force] = useState(0);
  const r = () => force((x) => x + 1);
  return (
    <div className="card stack small" style={{ marginTop: 10 }}>
      <label className="row"><input type="checkbox" checked={audio.bgmOn} onChange={(e) => { audio.setBgm(e.target.checked); r(); }} /> 배경음악 (기본 꺼짐)</label>
      <label className="row"><input type="checkbox" checked={audio.sfxOn} onChange={(e) => { audio.setSfx(e.target.checked); r(); }} /> 효과음 — 내 조작·차례 알림만</label>
      <label className="row">음악 음량 <input type="range" min={0} max={1} step={0.05} value={audio.bgmVolume} onChange={(e) => { audio.setBgmVolume(Number(e.target.value)); r(); }} /></label>
      <label className="row">효과음 음량 <input type="range" min={0} max={1} step={0.05} value={audio.sfxVolume} onChange={(e) => { audio.setSfxVolume(Number(e.target.value)); r(); }} /></label>
      <label className="row"><input type="checkbox" checked={audio.speakerMode} onChange={(e) => { audio.setSpeaker(e.target.checked); r(); }} /> 교사 스피커 모드 (공용 음악·전역 이벤트만)</label>
      <p className="muted">현재 오디오 파일은 제작 전이라 무음으로 동작합니다. 파일을 넣으면 앱 코드 수정 없이 재생됩니다.</p>
    </div>
  );
}

function StudentJoin({ onJoin }: { onJoin: (r: JoinResult) => void }) {
  const [code, setCode] = useState(roomFromUrl() ?? '');
  const [nick, setNick] = useState('');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<{ status: string; teacherNick: string; players: number } | null>(null);
  const prev = loadSession();
  useEffect(() => {
    const c = code.toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(c)) { setInfo(null); return; }
    api<{ exists: boolean; status: string; teacherNick: string; players: number }>(`/api/rooms/${c}`).then((d) => setInfo(d.exists ? d : null)).catch(() => setInfo(null));
  }, [code]);
  const join = async () => {
    setBusy(true);
    try {
      const c = code.toUpperCase();
      const r = await api<{ playerId: string; token: string; role: 'student' | 'spectator' }>(`/api/rooms/${c}/join`, { method: 'POST', body: JSON.stringify({ nick }) });
      onJoin({ code: c, playerId: r.playerId, token: r.token, nick, role: r.role });
    } catch (e) { store.toast(e instanceof Error ? e.message : '입장 실패', 'error'); }
    finally { setBusy(false); }
  };
  return (
    <div className="stack">
      {prev && prev.role !== 'teacher' && <button className="btn btn-copper btn-block" onClick={() => onJoin({ ...prev })}>이전 세션으로 돌아가기 — {prev.nick} @ {prev.code}</button>}
      <div className="field"><label className="label" htmlFor="code">방 코드</label><input id="code" className="input" style={{ fontFamily: 'var(--mono)', letterSpacing: '0.2em', textTransform: 'uppercase', fontSize: 22 }} value={code} maxLength={6} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABC123" autoComplete="off" /></div>
      {info && <p className="small muted">교사 {info.teacherNick} · 참가 {info.players}명 · {info.status === 'lobby' ? '대기 중' : info.status === 'playing' ? '경기 중 (관전자로 입장)' : info.status}</p>}
      <div className="field"><label className="label" htmlFor="nick">닉네임 (12자, 방 안에서 중복 불가)</label><input id="nick" className="input" value={nick} maxLength={12} onChange={(e) => setNick(e.target.value)} placeholder="예: 민지" onKeyDown={(e) => { if (e.key === 'Enter' && nick.trim() && code.length === 6) join(); }} /></div>
      <button className="btn btn-primary btn-lg btn-block" disabled={busy || !nick.trim() || code.length !== 6} onClick={join}>{busy ? '입장 중…' : '입장'}</button>
      <p className="muted small">별도 로그인이 없습니다. 이 기기에 접속 정보가 저장되어 새로고침해도 이어집니다.</p>
    </div>
  );
}

function TeacherPanel({ onJoin }: { onJoin: (r: JoinResult) => void }) {
  const [key, setKey] = useState<string | null>(loadTeacherKey());
  const [id, setId] = useState('teacher');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [rooms, setRooms] = useState<{ code: string; mode: string; status: string; createdAt: number; rounds: number }[]>([]);
  const [nick, setNick] = useState('선생님');
  const [mode, setMode] = useState<ModeId>('classic');
  const [presetId, setPresetId] = useState(MODES.classic.presets[0]!.id);
  const [rounds, setRounds] = useState(10);
  useEffect(() => {
    if (!key) return;
    api<{ ok: boolean }>('/api/teacher/verify', { teacherKey: key }).then((d) => { if (!d.ok) { saveTeacherKey(null); setKey(null); } }).catch(() => {});
    api<{ rooms: typeof rooms }>('/api/rooms', { teacherKey: key }).then((d) => setRooms(d.rooms ?? [])).catch(() => {});
  }, [key]);
  const login = async () => {
    setBusy(true);
    try {
      const r = await api<{ teacherKey: string }>('/api/teacher/login', { method: 'POST', body: JSON.stringify({ id, password: pw }) });
      saveTeacherKey(r.teacherKey); setKey(r.teacherKey); setPw('');
    } catch (e) { store.toast(e instanceof Error ? e.message : '로그인 실패', 'error'); }
    finally { setBusy(false); }
  };
  const create = async () => {
    if (!key) return;
    setBusy(true);
    try {
      const r = await api<{ code: string; teacherToken: string; playerId: string }>('/api/rooms', { method: 'POST', teacherKey: key, body: JSON.stringify({ nick, mode, presetId, rounds }) });
      rememberRoom({ code: r.code, teacherToken: r.teacherToken, playerId: r.playerId, at: Date.now(), mode });
      onJoin({ code: r.code, playerId: r.playerId, token: r.teacherToken, nick, role: 'teacher' });
    } catch (e) { store.toast(e instanceof Error ? e.message : '방 생성 실패', 'error'); }
    finally { setBusy(false); }
  };
  const reopen = async (code: string) => {
    if (!key) return;
    const local = loadRecentRooms().find((r) => r.code === code);
    try {
      const r = local ?? (await api<{ code: string; teacherToken: string; playerId: string }>(`/api/rooms/${code}/teacher`, { teacherKey: key }));
      onJoin({ code, playerId: r.playerId, token: r.teacherToken, nick, role: 'teacher' });
    } catch (e) { store.toast(e instanceof Error ? e.message : '방을 열 수 없습니다', 'error'); }
  };
  if (!key) {
    return (
      <div className="stack">
        <div className="field"><label className="label" htmlFor="tid">아이디</label><input id="tid" className="input" value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" /></div>
        <div className="field"><label className="label" htmlFor="tpw">비밀번호</label><input id="tpw" className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" onKeyDown={(e) => { if (e.key === 'Enter') login(); }} /></div>
        <button className="btn btn-primary btn-block" disabled={busy || !pw} onClick={login}>로그인</button>
      </div>
    );
  }
  return (
    <div className="stack">
      <div className="card stack">
        <div className="card-title">새 게임 열기</div>
        <div className="grid-2">
          <div className="field"><label className="label">교사 닉네임</label><input className="input" value={nick} maxLength={12} onChange={(e) => setNick(e.target.value)} /></div>
          <div className="field"><label className="label">게임 길이</label><select className="input" value={rounds} onChange={(e) => setRounds(Number(e.target.value))}>{Object.values(ROUND_PRESETS).map((p) => <option key={p.rounds} value={p.rounds}>{p.label}</option>)}</select></div>
        </div>
        <div className="field"><label className="label">모드</label><div className="row">{(Object.keys(MODES) as ModeId[]).map((m) => <button key={m} className={`btn btn-sm ${mode === m ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { setMode(m); setPresetId(MODES[m].presets[0]!.id); }}>{MODES[m].name}</button>)}</div><p className="muted small" style={{ marginTop: 4 }}>{MODES[mode].blurb}</p></div>
        <div className="field"><label className="label">시나리오 프리셋</label><select className="input" value={presetId} onChange={(e) => setPresetId(e.target.value)}>{MODES[mode].presets.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.blurb} ({p.reactions.length}장)</option>)}</select></div>
        <button className="btn btn-copper btn-lg btn-block" disabled={busy} onClick={create}>게임 열기</button>
        <p className="muted small">방 코드와 QR이 만들어집니다. 교사는 관전만 하거나 한 팀의 팀장으로 함께 참가할 수 있습니다.</p>
      </div>
      {rooms.length > 0 && <div className="card"><div className="card-title">최근 방 (48시간 보존)</div><div className="stack">{rooms.slice(0, 6).map((r) => <button key={r.code} className="btn btn-ghost" style={{ justifyContent: 'space-between' }} onClick={() => reopen(r.code)}><span className="formula">{r.code}</span><span className="muted small">{MODES[r.mode as ModeId]?.name} · {r.rounds}R · {r.status} · {new Date(r.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></button>)}</div></div>}
      <button className="btn btn-sm btn-ghost" onClick={() => { saveTeacherKey(null); setKey(null); }}>로그아웃</button>
    </div>
  );
}
