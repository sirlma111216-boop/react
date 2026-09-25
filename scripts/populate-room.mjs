/**
 * 개발용: 기존 방에 가짜 학생을 채워 팀을 구성한다 (브라우저 수동 확인 보조).
 * 사용: node scripts/populate-room.mjs <ROOMCODE> [baseUrl] [students=5] [teams=2]
 * 닉네임에 '브라우저'가 들어간 실제 참가자가 있으면 첫 팀에 편입한다.
 */
const code = (process.argv[2] ?? '').toUpperCase();
const base = process.argv[3] ?? 'http://127.0.0.1:8787';
const N = Number(process.argv[4] ?? 5);
const TEAMS = Number(process.argv[5] ?? 2);
if (!code) { console.error('방 코드가 필요합니다'); process.exit(2); }
const wsBase = base.replace(/^http/, 'ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, init = {}) => { const r = await fetch(base + p, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } }); return { status: r.status, data: await r.json().catch(() => ({})) }; };
const mk = (tok) => { const c = { view: null, p: new Map(), n: 0 }; c.ws = new WebSocket(`${wsBase}/ws?room=${code}&token=${encodeURIComponent(tok)}`); c.ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === 'view') c.view = m.view; if (m.type === 'ack') { const f = c.p.get(m.id); if (f) { c.p.delete(m.id); f(m); } } }; c.ready = new Promise((r) => (c.ws.onopen = r)); c.send = (cmd) => new Promise((res) => { const id = 'p' + (++c.n) + Math.random().toString(36).slice(2, 6); c.p.set(id, res); c.ws.send(JSON.stringify({ type: 'cmd', id, cmd })); }); return c; };

const login = await api('/api/teacher/login', { method: 'POST', body: JSON.stringify({ id: 'teacher', password: process.env.TEACHER_PASSWORD ?? 'guild2026' }) });
const key = login.data.teacherKey;
const t = await api(`/api/rooms/${code}/teacher`, { headers: { 'x-teacher-key': key } });
const teacher = mk(t.data.teacherToken); await teacher.ready; await sleep(300);
const students = [];
for (let i = 0; i < N; i++) {
  const j = await api(`/api/rooms/${code}/join`, { method: 'POST', body: JSON.stringify({ nick: `봇학생${i + 1}` }) });
  if (j.status !== 200) { console.log('입장 실패', j.data); continue; }
  const c = mk(j.data.token); c.playerId = j.data.playerId; await c.ready; students.push(c);
}
await sleep(400);
const names = ['구리 연금단', '소다 공방', '수증기 길드', '석회 상회', '마그네슘단', '전해 공방'];
const emblems = ['triangle', 'hexagon', 'star', 'wave', 'leaf', 'square'];
const colors = ['#B87346', '#5B7F3A', '#8C4E7A', '#C48F1F', '#4A6FB5', '#A8493E'];
for (let k = 0; k < TEAMS && k < students.length; k++) {
  await teacher.send({ type: 'appointLeader', playerId: students[k].playerId, on: true });
  await sleep(200);
  console.log('팀 생성', await students[k].send({ type: 'createTeam', name: names[k], color: colors[k], emblem: emblems[k] }));
}
await sleep(400);
const teamIds = teacher.view.teams.map((x) => x.id);
for (let k = TEAMS; k < students.length; k++) await students[k].send({ type: 'joinTeam', teamId: teamIds[k % TEAMS] });
const browserStudent = teacher.view.players.find((p) => p.nick.includes('브라우저'));
if (browserStudent) console.log('브라우저 학생 편입', await teacher.send({ type: 'movePlayer', playerId: browserStudent.id, teamId: teamIds[0] }));
for (let k = 0; k < TEAMS; k++) await students[k].send({ type: 'setBundle', bundleId: ['gas', 'carbonate', 'material'][k % 3] });
for (let k = 0; k < TEAMS; k++) await students[k].send({ type: 'ready', on: true });
await sleep(300);
console.log('팀:', teacher.view.teams.map((x) => `${x.name}(${x.members.length}명)`).join(', '));
console.log('가짜 학생들은 접속을 유지합니다. Ctrl+C 로 종료.');
// 가짜 학생의 담당자 차례에 간단한 행동을 해서 보드가 움직이게 한다
setInterval(async () => {
  for (const s of students) {
    const v = s.view; if (!v?.game || v.game.phase !== 'execute' || !v.me.isOperator) continue;
    const team = v.game.myTeam; if (!team || team.actionsLeft <= 0) continue;
    if (team.offers.length && team.contracts.length < 2) await s.send({ type: 'team', cmd: { type: 'takeContract', offerId: team.offers[0].id } });
    const r = await s.send({ type: 'team', cmd: { type: 'react', reactionId: v.game.activeReactions[0], scale: 1 } });
    if (!r.ok) await s.send({ type: 'team', cmd: { type: 'procure', items: [{ materialId: v.game.shopMaterials[0], units: 1 }] } });
  }
}, 3000);
