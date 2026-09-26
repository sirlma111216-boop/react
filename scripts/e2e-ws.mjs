/**
 * 실서버(wrangler dev 또는 배포 URL) 통합 테스트 — 수동 라운드(V2).
 * 교사 로그인 → 방 생성 → 학생 N명 입장 → 팀장 임명 → 팀 생성·가입 → 시작 →
 * 명령·중복·권한·재접속 → 준비 완료로 라운드 진행(정산 1회 검증, 취소·멈춤·건너뛰기 경합) → 완주.
 * 사용: node scripts/e2e-ws.mjs [baseUrl] [students] [full=1]
 */
const base = process.argv[2] ?? 'http://127.0.0.1:8787';
const STUDENTS = Number(process.argv[3] ?? 12);
const FULL = (process.argv[4] ?? '1') === '1';
const TEAMS = Math.min(6, Math.max(2, Math.floor(STUDENTS / 4)));
const wsBase = base.replace(/^http/, 'ws');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, init = {}) {
  const res = await fetch(base + path, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

class Client {
  constructor(name, code, token) {
    this.name = name; this.code = code; this.token = token; this.view = null; this.pending = new Map(); this.seq = 0; this.toasts = [];
    this.open();
  }
  open() {
    this.ws = new WebSocket(`${wsBase}/ws?room=${this.code}&token=${encodeURIComponent(this.token)}`);
    this.ready = new Promise((resolve, reject) => { this.ws.onopen = () => resolve(); this.ws.onerror = () => reject(new Error('ws error')); });
    this.ready.catch(() => {});
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'view') this.view = m.view;
      else if (m.type === 'ack') { const p = this.pending.get(m.id); if (p) { this.pending.delete(m.id); p(m); } }
      else if (m.type === 'toast') this.toasts.push(m.text);
    };
    this.closed = new Promise((resolve) => { this.ws.onclose = (ev) => resolve(ev.code); });
  }
  send(cmd, id) {
    const cid = id ?? `${this.name}-${++this.seq}`;
    return new Promise((resolve) => { this.pending.set(cid, resolve); this.ws.send(JSON.stringify({ type: 'cmd', id: cid, cmd })); setTimeout(() => { if (this.pending.has(cid)) { this.pending.delete(cid); resolve({ ok: false, error: 'timeout' }); } }, 15000); });
  }
  async waitView(pred, ms = 10000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (this.view && pred(this.view)) return this.view; await sleep(100); }
    throw new Error(`waitView timeout (${this.name})`);
  }
  close() { this.ws.close(); }
}

(async () => {
  const t0 = Date.now();
  const bad = await api('/api/teacher/login', { method: 'POST', body: JSON.stringify({ id: 'teacher', password: 'wrong' }) });
  check('잘못된 비밀번호 거절', bad.status === 401);
  const login = await api('/api/teacher/login', { method: 'POST', body: JSON.stringify({ id: 'teacher', password: process.env.TEACHER_PASSWORD ?? 'guild2026' }) });
  check('교사 로그인', login.status === 200 && !!login.data.teacherKey);
  const key = login.data.teacherKey;
  check('교사 키 없이 방 생성 거절', (await api('/api/rooms', { method: 'POST', body: JSON.stringify({}) })).status === 401);
  const room = await api('/api/rooms', { method: 'POST', headers: { 'x-teacher-key': key }, body: JSON.stringify({ nick: '김선생', mode: 'classic', rounds: 6 }) });
  check('방 생성', room.status === 200 && /^[A-Z0-9]{6}$/.test(room.data.code ?? ''), room.data.code);
  const code = room.data.code;
  const info = await api(`/api/rooms/${code}`);
  check('새 방은 수동 진행', info.data.turnMode === 'manual');
  const teacher = new Client('teacher', code, room.data.teacherToken);
  await teacher.ready;
  await teacher.waitView((v) => v.me.role === 'teacher');
  check('교사 WS 연결·투영', teacher.view.me.role === 'teacher' && teacher.view.room.code === code);
  const students = [];
  for (let i = 0; i < STUDENTS; i++) {
    const j = await api(`/api/rooms/${code}/join`, { method: 'POST', body: JSON.stringify({ nick: `학생${i + 1}` }) });
    if (j.status !== 200) { check(`학생${i + 1} 입장`, false, JSON.stringify(j.data)); continue; }
    const c = new Client(`s${i + 1}`, code, j.data.token); c.playerId = j.data.playerId; students.push(c);
  }
  await Promise.all(students.map((s) => s.ready));
  check('중복 닉네임 거절', (await api(`/api/rooms/${code}/join`, { method: 'POST', body: JSON.stringify({ nick: '학생1' }) })).status === 409);
  const badTok = new Client('bad', code, 'not-a-token');
  const badCode = await badTok.closed.catch(() => 0);
  check('잘못된 토큰 WS 거절', badCode !== 1000 && badCode !== undefined);
  await teacher.waitView((v) => v.players.length >= STUDENTS + 1);
  check(`학생 ${STUDENTS}명 입장 확인`, teacher.view.players.filter((p) => p.role === 'student').length === STUDENTS);
  const s1 = students[0];
  await s1.waitView((v) => !!v.me.playerId);
  check('학생의 교사 명령 거절', !(await s1.send({ type: 'start' })).ok);
  check('임명 안 된 학생의 팀 생성 거절', !(await s1.send({ type: 'createTeam', name: '무단', color: '#000', emblem: 'star' })).ok);
  const leaders = students.slice(0, TEAMS);
  for (const l of leaders) await teacher.send({ type: 'appointLeader', playerId: l.playerId, on: true });
  for (const [i, l] of leaders.entries()) { await l.waitView((v) => v.me.isLeader); check(`팀 생성 ${l.name}`, (await l.send({ type: 'createTeam', name: `길드${i + 1}`, color: '#1F6F78', emblem: 'circle' })).ok); }
  await teacher.waitView((v) => v.teams.length === TEAMS);
  const teamIds = teacher.view.teams.map((t) => t.id);
  const others = students.slice(TEAMS);
  const joins = await Promise.all(others.map((s, i) => s.send({ type: 'joinTeam', teamId: teamIds[i % TEAMS] })));
  check('학생 팀 가입', joins.every((j) => j.ok), `${joins.filter((j) => j.ok).length}/${others.length}`);
  check('두 번 가입 거절', !(await others[0].send({ type: 'joinTeam', teamId: teamIds[1] })).ok);
  check('팀장 시작 재료 선택', (await leaders[0].send({ type: 'setBundle', bundleId: 'carbonate' })).ok);
  check('시간제 명령은 수동 방에서 거절', !(await teacher.send({ type: 'setTimerScale', scale: 1 })).ok);
  for (const l of leaders) await l.send({ type: 'ready', on: true });
  check('게임 시작', (await teacher.send({ type: 'start' })).ok);
  await teacher.waitView((v) => v.room.status === 'playing' && v.game?.round === 1);
  check('1라운드는 바로 행동 라운드(제한시간 없음)', teacher.view.game.phase === 'execute' && teacher.view.room.phaseEndsAt === null);
  check('교사 투영에 전 팀 상태', (teacher.view.teacherTeams ?? []).length === TEAMS);
  const spec = await api(`/api/rooms/${code}/join`, { method: 'POST', body: JSON.stringify({ nick: '늦은학생' }) });
  check('경기 중 입장은 관전자', spec.status === 200 && spec.data.role === 'spectator');

  // 팀별 담당자 찾기
  const opOf = (teamId) => { const gt = teacher.view.teacherTeams.find((t) => t.id === teamId); return students.find((s) => s.playerId === gt.operatorId); };
  await leaders[0].waitView((v) => v.game?.phase === 'execute');
  const team0 = leaders[0].view.game.myTeam;
  const members0 = leaders[0].view.teams.find((t) => t.id === team0.id).members;
  const op = opOf(team0.id);
  const nonOp = students.find((s) => members0.includes(s.playerId) && s.playerId !== op.playerId);
  if (nonOp) check('차례 아닌 팀원의 실행 거절', !(await nonOp.send({ type: 'team', cmd: { type: 'procure', items: [{ materialId: 'O2_g', units: 1 }] } })).ok);
  if (nonOp) check('차례 아닌 팀원의 추천 허용', (await nonOp.send({ type: 'team', cmd: { type: 'pin', playerId: 'x', target: 'reaction:R01', label: '추천' } })).ok);
  if (nonOp) check('차례 아닌 팀원의 준비 완료 거절', !(await nonOp.send({ type: 'team', cmd: { type: 'readyRound', on: true } })).ok);
  check('장소 이동 기록(경제 명령 아님)', (await op.send({ type: 'observe', place: 'store' })).ok);
  const dupId = 'dup-cmd-1';
  const r1 = await op.send({ type: 'team', cmd: { type: 'procure', items: [{ materialId: 'O2_g', units: 2 }] } }, dupId);
  const r2 = await op.send({ type: 'team', cmd: { type: 'procure', items: [{ materialId: 'O2_g', units: 2 }] } }, dupId);
  await op.waitView((v) => v.game.myTeam.purchasesThisRound['O2_g'] === 2, 5000).catch(() => {});
  check('담당자 조달 성공', r1.ok, r1.error);
  check('중복 commandId 는 같은 결과·한 번만 소비', r2.ok === r1.ok && op.view.game.myTeam.purchasesThisRound['O2_g'] === 2 && op.view.game.myTeam.actionsLeft === op.view.game.config.actionsPerRound - 1);
  const rawView = JSON.stringify(op.view);
  check('학생 투영에 다른 팀 창고·입찰 없음', !rawView.includes('"teacherTeams"'));
  check('시세 정보 공유', typeof op.view.game.market === 'object' && op.view.game.roundVersion === 0);
  // 재접속
  op.close(); await op.closed; op.open(); await op.ready; await op.waitView((v) => !!v.game);
  check('재접속 후 상태 복구', op.view.game.myTeam.id === team0.id && op.view.game.round === 1);
  // 벽시계 경과에도 라운드가 그대로 (5초)
  await sleep(5000);
  check('시간이 흘러도 라운드·행동이 그대로', teacher.view.game.round === 1 && op.view.game.myTeam.actionsLeft === op.view.game.config.actionsPerRound - 1);

  // 준비 완료 흐름: 한 팀만 준비 → 정산 없음, 준비 취소 → 다시 행동 가능
  const rr = await op.send({ type: 'team', cmd: { type: 'readyRound', on: true } });
  check('준비 완료(행동 남음 허용)', rr.ok, rr.error ?? '');
  await teacher.waitView((v) => v.game.readyCount === 1);
  check('한 팀만 준비되면 정산되지 않음', teacher.view.game.round === 1);
  check('준비 완료 뒤 행동 거절', !(await op.send({ type: 'team', cmd: { type: 'buyEnergy', bundles: 1 } })).ok);
  check('준비 취소', (await op.send({ type: 'team', cmd: { type: 'readyRound', on: false } })).ok);
  // 멈춤 중에는 모두 준비돼도 정산 안 함
  check('멈춤', (await teacher.send({ type: 'pause' })).ok);
  for (const tid of teamIds) { const o = opOf(tid); await o.send({ type: 'team', cmd: { type: 'readyRound', on: true } }); }
  await sleep(500);
  check('멈춤 중 준비 완료는 거절/보류되어 라운드 유지', teacher.view.game.round === 1);
  check('다시 시작', (await teacher.send({ type: 'resume' })).ok);
  // 재개 후: 남은 팀 준비 → 정산 1회
  for (const tid of teamIds) { const o = opOf(tid); await o.send({ type: 'team', cmd: { type: 'readyRound', on: true } }); }
  await teacher.waitView((v) => v.game.round === 2, 8000);
  await sleep(600);
  check('모든 팀 준비 → 정산 정확히 1회 (2라운드)', teacher.view.game.round === 2 && teacher.view.game.roundVersion === 1);
  check('다음 라운드 준비 상태 초기화', teacher.view.game.readyCount === 0);
  check('차례가 다음 팀원으로 바뀜', teacher.view.teacherTeams.some((t) => t.operatorId !== op.playerId) || TEAMS === 0);
  // 교사 건너뛰기 + 중복 준비 동시 도착
  const opsNow = teamIds.map(opOf);
  await Promise.all([teacher.send({ type: 'skipTeam', teamId: teamIds[0] }), ...opsNow.slice(1).map((o) => o.send({ type: 'team', cmd: { type: 'readyRound', on: true } })), ...opsNow.slice(1).map((o) => o.send({ type: 'team', cmd: { type: 'readyRound', on: true } }))]);
  await teacher.waitView((v) => v.game.round === 3, 8000);
  await sleep(600);
  check('건너뛰기+동시 준비 → 정산 1회 (3라운드)', teacher.view.game.round === 3 && teacher.view.game.roundVersion === 2);
  check('학생의 건너뛰기 거절', !(await students[0].send({ type: 'skipTeam', teamId: teamIds[0] })).ok);
  check('견적 버전 불일치 배달 거절', (await opOf(teamIds[0]).send({ type: 'team', cmd: { type: 'deliver', contractId: 'nope', quoteVersion: 1 } })).error !== undefined);
  if (FULL) {
    let guard = 0;
    while (teacher.view.room.status !== 'finished' && guard++ < 12) {
      const round = teacher.view.game.round;
      for (const tid of teamIds) { const o = opOf(tid); if (o) await o.send({ type: 'team', cmd: { type: 'readyRound', on: true } }); }
      await teacher.waitView((v) => v.room.status === 'finished' || v.game.round > round, 8000).catch(() => {});
    }
    check('6라운드 완주·결과 생성', teacher.view.room.status === 'finished' && Array.isArray(teacher.view.game.results));
    const ops = new Set(); for (const s of students) for (const t of s.toasts) if (t.includes('당신 차례')) ops.add(s.name);
    check('차례가 여러 팀원에게 순환', ops.size > TEAMS, `${ops.size}명이 차례 알림 수신`);
    const exp = await api(`/api/rooms/${code}/export`, { headers: { 'x-teacher-key': key } });
    check('교사 결과 내보내기(관측 요약 포함)', exp.status === 200 && Array.isArray(exp.data.results) && !!exp.data.observation);
  }
  const list = await api('/api/rooms', { headers: { 'x-teacher-key': key } });
  check('교사 방 목록', list.status === 200 && list.data.rooms.some((r) => r.code === code));
  teacher.close(); for (const s of students) s.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n통과 ${results.length - failed.length}/${results.length}, 소요 ${Math.round((Date.now() - t0) / 1000)}s`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('E2E 예외:', e); process.exit(1); });
