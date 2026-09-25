/**
 * 실서버(wrangler dev 또는 배포 URL) 통합 테스트.
 * 교사 로그인 → 방 생성 → 학생 N명 입장 → 팀장 임명 → 팀 생성·가입 → 시작 → 라운드 진행(명령·중복·권한·재접속) → 종료.
 * 사용: node scripts/e2e-ws.mjs [baseUrl] [students] [fastTimer=1]
 */
const base = process.argv[2] ?? 'http://127.0.0.1:8787';
const STUDENTS = Number(process.argv[3] ?? 12);
const FAST = (process.argv[4] ?? '1') === '1';
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
    return new Promise((resolve) => { this.pending.set(cid, resolve); this.ws.send(JSON.stringify({ type: 'cmd', id: cid, cmd })); setTimeout(() => { if (this.pending.has(cid)) { this.pending.delete(cid); resolve({ ok: false, error: 'timeout' }); } }, 8000); });
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
  // 1. 교사 로그인
  const bad = await api('/api/teacher/login', { method: 'POST', body: JSON.stringify({ id: 'teacher', password: 'wrong' }) });
  check('잘못된 비밀번호 거절', bad.status === 401);
  const login = await api('/api/teacher/login', { method: 'POST', body: JSON.stringify({ id: 'teacher', password: process.env.TEACHER_PASSWORD ?? 'guild2026' }) });
  check('교사 로그인', login.status === 200 && !!login.data.teacherKey);
  const key = login.data.teacherKey;
  const noAuth = await api('/api/rooms', { method: 'POST', body: JSON.stringify({}) });
  check('교사 키 없이 방 생성 거절', noAuth.status === 401);
  // 2. 방 생성
  const room = await api('/api/rooms', { method: 'POST', headers: { 'x-teacher-key': key }, body: JSON.stringify({ nick: '김선생', mode: 'classic', rounds: 6 }) });
  check('방 생성', room.status === 200 && /^[A-Z0-9]{6}$/.test(room.data.code ?? ''), room.data.code);
  const code = room.data.code;
  const teacher = new Client('teacher', code, room.data.teacherToken);
  await teacher.ready;
  await teacher.waitView((v) => v.me.role === 'teacher');
  check('교사 WS 연결·투영', teacher.view.me.role === 'teacher' && teacher.view.room.code === code);
  // 3. 학생 입장
  const students = [];
  for (let i = 0; i < STUDENTS; i++) {
    const j = await api(`/api/rooms/${code}/join`, { method: 'POST', body: JSON.stringify({ nick: `학생${i + 1}` }) });
    if (j.status !== 200) { check(`학생${i + 1} 입장`, false, JSON.stringify(j.data)); continue; }
    students.push(new Client(`s${i + 1}`, code, j.data.token, j.data.playerId));
    students[students.length - 1].playerId = j.data.playerId;
  }
  await Promise.all(students.map((s) => s.ready));
  const dup = await api(`/api/rooms/${code}/join`, { method: 'POST', body: JSON.stringify({ nick: '학생1' }) });
  check('중복 닉네임 거절', dup.status === 409);
  const badTok = new Client('bad', code, 'not-a-token');
  const badCode = await badTok.closed.catch(() => 0);
  check('잘못된 토큰 WS 거절', badCode !== 1000 && badCode !== undefined);
  await teacher.waitView((v) => v.players.length >= STUDENTS + 1);
  check(`학생 ${STUDENTS}명 입장 확인`, teacher.view.players.filter((p) => p.role === 'student').length === STUDENTS);
  // 4. 일반 학생이 교사 명령 → 거절, 임명 안 된 학생 팀 생성 → 거절
  const s1 = students[0];
  await s1.waitView((v) => !!v.me.playerId);
  check('학생의 교사 명령 거절', !(await s1.send({ type: 'start' })).ok);
  check('임명 안 된 학생의 팀 생성 거절', !(await s1.send({ type: 'createTeam', name: '무단', color: '#000', emblem: 'star' })).ok);
  // 5. 팀장 임명 → 팀 생성 → 가입 (마지막 자리 동시 가입 포함)
  const leaders = students.slice(0, TEAMS);
  for (const l of leaders) check(`팀장 임명 ${l.name}`, (await teacher.send({ type: 'appointLeader', playerId: l.playerId, on: true })).ok);
  for (const [i, l] of leaders.entries()) { await l.waitView((v) => v.me.isLeader); check(`팀 생성 ${l.name}`, (await l.send({ type: 'createTeam', name: `길드${i + 1}`, color: '#1F6F78', emblem: 'circle' })).ok); }
  await teacher.waitView((v) => v.teams.length === TEAMS);
  const teamIds = teacher.view.teams.map((t) => t.id);
  const others = students.slice(TEAMS);
  const joins = await Promise.all(others.map((s, i) => s.send({ type: 'joinTeam', teamId: teamIds[i % TEAMS] })));
  check('학생 팀 가입', joins.every((j) => j.ok), `${joins.filter((j) => j.ok).length}/${others.length}`);
  check('두 번 가입 거절', !(await others[0].send({ type: 'joinTeam', teamId: teamIds[1] })).ok);
  check('팀장 시작 묶음 선택', (await leaders[0].send({ type: 'setBundle', bundleId: 'carbonate' })).ok);
  for (const l of leaders) await l.send({ type: 'ready', on: true });
  if (FAST) check('개발 환경 빠른 타이머', (await teacher.send({ type: 'setTimerScale', scale: 0.05 })).ok);
  // 6. 시작
  check('게임 시작', (await teacher.send({ type: 'start' })).ok);
  await teacher.waitView((v) => v.room.status === 'playing' && v.game?.round === 1);
  check('1라운드 계획 단계', teacher.view.game.phase === 'plan');
  check('교사 투영에 전 팀 상태', (teacher.view.teacherTeams ?? []).length === TEAMS);
  const spec = await api(`/api/rooms/${code}/join`, { method: 'POST', body: JSON.stringify({ nick: '늦은학생' }) });
  check('경기 중 입장은 관전자', spec.status === 200 && spec.data.role === 'spectator');
  // 7. 명령: 담당자만 실행, 중복 commandId 는 한 번만, 다른 팀 비공개 정보 미노출
  await leaders[0].waitView((v) => v.game?.phase === 'execute', FAST ? 10000 : 45000);
  const team0 = leaders[0].view.game.myTeam;
  const opId = team0.operatorId;
  const members = leaders[0].view.teams.find((t) => t.id === team0.id).members;
  const nonOp = students.find((s) => members.includes(s.playerId) && s.playerId !== opId);
  const op = students.find((s) => s.playerId === opId);
  if (nonOp) check('담당자 아닌 팀원의 실행 거절', !(await nonOp.send({ type: 'team', cmd: { type: 'procure', items: [{ materialId: 'O2_g', units: 1 }] } })).ok);
  if (nonOp) check('담당자 아닌 팀원의 핑 허용', (await nonOp.send({ type: 'team', cmd: { type: 'pin', playerId: 'x', target: 'reaction:R01', label: '제안' } })).ok);
  const dupId = 'dup-cmd-1';
  const r1 = await op.send({ type: 'team', cmd: { type: 'procure', items: [{ materialId: 'O2_g', units: 2 }] } }, dupId);
  const r2 = await op.send({ type: 'team', cmd: { type: 'procure', items: [{ materialId: 'O2_g', units: 2 }] } }, dupId);
  await op.waitView((v) => v.game.myTeam.purchasesThisRound['O2_g'] === 2, 5000).catch(() => {});
  check('담당자 조달 성공', r1.ok, r1.error);
  check('중복 commandId 는 같은 결과·한 번만 소비', r2.ok === r1.ok && op.view.game.myTeam.purchasesThisRound['O2_g'] === 2 && op.view.game.myTeam.actionsLeft === 1);
  const rawView = JSON.stringify(op.view);
  check('학생 투영에 다른 팀 재고·입찰 없음', !rawView.includes('"teacherTeams"') && op.view.teams.every((t) => t.id === team0.id || !('lots' in t)));
  // 8. 재접속: 같은 토큰으로 다시 연결하면 상태 복구
  op.close(); await op.closed; op.open(); await op.ready; await op.waitView((v) => !!v.game);
  check('재접속 후 상태 복구', op.view.game.myTeam.id === team0.id);
  // 9. 일시정지·재개·연장
  const pz = await teacher.send({ type: 'pause' }); check('일시정지', pz.ok, pz.error ?? '');
  await teacher.waitView((v) => v.room.status === 'paused', 10000);
  check('일시정지 중 팀 명령 거절', !(await op.send({ type: 'team', cmd: { type: 'buyEnergy', bundles: 1 } })).ok);
  const rs = await teacher.send({ type: 'resume' }); check('재개', rs.ok, rs.error ?? '');
  check('연장', (await teacher.send({ type: 'extend', seconds: 5 })).ok);
  // 10. 끝까지 진행 (빠른 타이머)
  if (FAST) {
    const start = Date.now();
    await teacher.waitView((v) => v.room.status === 'finished', 120000);
    check('6라운드 완주·결과 생성', Array.isArray(teacher.view.game.results) && teacher.view.game.results.length === TEAMS, `${Math.round((Date.now() - start) / 1000)}s`);
    const ops = new Set();
    // 담당자 순환은 라운드별 로그 대신 최종 상태에서 확인 어렵기에 토스트로 확인
    for (const s of students) for (const t of s.toasts) if (t.includes('조작 담당자는 당신')) ops.add(s.name);
    check('조작 담당자가 여러 팀원에게 순환', ops.size > TEAMS, `${ops.size}명이 담당자 알림 수신`);
    const exp = await api(`/api/rooms/${code}/export`, { headers: { 'x-teacher-key': key } });
    check('교사 결과 내보내기', exp.status === 200 && Array.isArray(exp.data.results));
  }
  const list = await api('/api/rooms', { headers: { 'x-teacher-key': key } });
  check('교사 방 목록', list.status === 200 && list.data.rooms.some((r) => r.code === code));
  teacher.close(); for (const s of students) s.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n통과 ${results.length - failed.length}/${results.length}, 소요 ${Math.round((Date.now() - t0) / 1000)}s`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('E2E 예외:', e); process.exit(1); });
