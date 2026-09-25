import { useEffect, useState } from 'react';
import type { ModeId } from '../shared/types';
import { WsClient } from './lib/net';
import { useAppState, store } from './lib/store';
import { loadSession, saveSession, loadTeacherKey, type StudentSession } from './lib/session';
import { audio } from './lib/audio';
import { TitleScreen, type JoinResult } from './screens/TitleScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { GameScreen } from './screens/GameScreen';
import { TeacherBoard } from './screens/TeacherBoard';
import { PracticeScreen } from './screens/PracticeScreen';
import { Toasts, ConnectionBadge } from './components/common';

type Route = { kind: 'title' } | { kind: 'room'; session: StudentSession } | { kind: 'practice'; mode: ModeId };

export function App() {
  const [route, setRoute] = useState<Route>(() => {
    const s = loadSession();
    const urlRoom = new URL(location.href).searchParams.get('room');
    // URL 에 다른 방 코드가 있으면 새로 입장하도록 타이틀부터
    if (s && (!urlRoom || urlRoom.toUpperCase() === s.code)) return { kind: 'room', session: s };
    return { kind: 'title' };
  });
  const [client, setClient] = useState<WsClient | null>(null);
  const [teacherView, setTeacherView] = useState<'spectate' | 'team'>('spectate');
  const { view, connection, closedReason } = useAppState();

  useEffect(() => {
    if (route.kind !== 'room') { client?.close(); setClient(null); store.reset(); return; }
    const c = new WsClient(route.session.code, route.session.token);
    setClient(c);
    return () => c.close();
  }, [route]);

  const onJoin = (r: JoinResult) => {
    const s: StudentSession = { code: r.code, playerId: r.playerId, token: r.token, nick: r.nick, role: r.role };
    saveSession(s);
    setRoute({ kind: 'room', session: s });
  };
  const leave = () => {
    if (route.kind === 'room' && !confirm('나가면 이 기기의 접속 정보가 지워집니다. 다시 들어오려면 교사에게 재배정을 요청해야 할 수 있습니다. 나갈까요?')) return;
    saveSession(null);
    setRoute({ kind: 'title' });
    audio.stopBgm();
    history.replaceState(null, '', location.pathname);
  };

  if (route.kind === 'practice') return <><PracticeScreen mode={route.mode} onLeave={() => setRoute({ kind: 'title' })} /><Toasts /></>;
  if (route.kind === 'title') return <><TitleScreen onJoin={onJoin} onPractice={(mode) => setRoute({ kind: 'practice', mode })} /><Toasts /></>;

  if (!client || !view) {
    return (
      <div className="screen title-screen">
        <div className="bg-full bg-fallback-lobby" />
        <div className="bg-content title-panel center stack">
          {connection === 'closed' ? (
            <>
              <h2>연결이 끊겼습니다</h2>
              <p className="muted">{closedReason ?? '방이 없거나 접속 정보가 유효하지 않습니다.'}</p>
              <button className="btn btn-primary" onClick={() => { saveSession(null); setRoute({ kind: 'title' }); }}>처음으로</button>
            </>
          ) : (
            <><div className="spinner" style={{ margin: '0 auto' }} /><p className="muted">방 {route.session.code}에 연결 중…</p><button className="btn btn-ghost btn-sm" onClick={() => { saveSession(null); setRoute({ kind: 'title' }); }}>취소</button></>
          )}
        </div>
        <Toasts />
      </div>
    );
  }

  const isTeacher = view.me.role === 'teacher';
  let screen: React.ReactNode;
  if (view.room.status === 'lobby' || !view.game) screen = <LobbyScreen view={view} client={client} onLeave={leave} />;
  else if (isTeacher && (teacherView === 'spectate' || !view.me.teamId)) screen = <TeacherBoard view={view} client={client} onLeave={leave} teacherKey={loadTeacherKey()} onSwitchToTeam={view.me.teamId ? () => setTeacherView('team') : undefined} />;
  else screen = (
    <div style={{ position: 'relative' }}>
      <GameScreen view={view} client={client} onLeave={leave} />
      {isTeacher && <button className="btn btn-sm btn-copper" style={{ position: 'fixed', top: 62, right: 12, zIndex: 20 }} onClick={() => setTeacherView('spectate')}>관전 보드</button>}
    </div>
  );
  return <>{screen}<Toasts /><ConnectionBadge /></>;
}
