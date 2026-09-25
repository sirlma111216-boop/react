/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from 'cloudflare:workers';
import type { GameState, ModeId, TeamCommand, TeamState } from '../shared/types';
import type { ClientEnvelope, ClientView, PlayerPublic, PlayerRole, RoomCommand, ServerMessage, TeamPublic } from '../shared/protocol';
import { sanitizeName, TEAM_NAME_MAX } from '../shared/protocol';
import { createGame, TEAM_COLORS, TEAM_EMBLEMS } from '../shared/engine/state';
import { advancePhase, startGame } from '../shared/engine/phases';
import { applyTeamCommand } from '../shared/engine/commands';
import { projectGame, stripTeam, teamCategory } from '../shared/projection';
import { PHASE_SECONDS, DEFAULT_ECONOMY } from '../shared/config/economy';
import { EQUIPMENT } from '../shared/chemistry/equipment';
import type { Env } from './index';

interface Player {
  id: string;
  nick: string;
  role: PlayerRole;
  token: string;
  teamId: string | null;
  isLeader: boolean;
  joinedAt: number;
  lastSeen: number;
}

interface Team {
  id: string;
  name: string;
  color: string;
  emblem: string;
  leaderId: string | null;
  members: string[];
  ready: boolean;
  bundleId: string | null;
  leaseId: string | null;
  operatorStart: number;
}

interface RoomMeta {
  code: string;
  createdAt: number;
  updatedAt: number;
  status: 'lobby' | 'playing' | 'paused' | 'finished' | 'expired';
  locked: boolean;
  mode: ModeId;
  presetId: string;
  rounds: number;
  teacherNick: string;
  teacherToken: string;
  teacherPlayerId: string;
  timerScale: number;
  phaseEndsAt: number | null;
  pausedRemaining: number | null;
  origin: string;
  finishedAt: number | null;
  cmdLog: Record<string, { ok: boolean; error?: string }>;
  cmdOrder: string[];
  joinTimes: number[];
  operatorGraceAt: number | null;
}

const LOBBY_IDLE_MS = 2 * 60 * 60 * 1000;
const FINISHED_KEEP_MS = 24 * 60 * 60 * 1000;
const MAX_AGE_MS = 48 * 60 * 60 * 1000;
const MAX_PLAYERS = 40;
const MAX_TEAMS = 8;
const TEAM_MAX_MEMBERS = 8;
const OPERATOR_GRACE_MS = 15_000;
const BROADCAST_DELAY_MS = 120;

const isFinished = (g: GameState): boolean => g.phase === 'finished';
function runToFinish(g: GameState): void {
  let guard = 0;
  while (!isFinished(g) && g.phase !== 'setup' && guard++ < 6) advancePhase(g);
}

function randomToken(bytes = 18): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** 학급 방 하나 = Durable Object 하나. SQLite-backed storage 에 상태를 보존한다. */
export class RoomDurableObject extends DurableObject<Env> {
  private meta: RoomMeta | null = null;
  private players: Record<string, Player> = {};
  private teams: Record<string, Team> = {};
  private game: GameState | null = null;
  private loaded = false;
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  // ---------- 저장 ----------
  private async load(): Promise<void> {
    if (this.loaded) return;
    await this.ctx.blockConcurrencyWhile(async () => {
      const [meta, players, teams, core] = await Promise.all([
        this.ctx.storage.get<RoomMeta>('meta'),
        this.ctx.storage.get<Record<string, Player>>('players'),
        this.ctx.storage.get<Record<string, Team>>('teams'),
        this.ctx.storage.get<Omit<GameState, 'teams'>>('game:core'),
      ]);
      this.meta = meta ?? null;
      this.players = players ?? {};
      this.teams = teams ?? {};
      if (core) {
        const teamsMap: Record<string, TeamState> = {};
        for (const id of core.teamOrder) {
          const t = await this.ctx.storage.get<TeamState>(`game:team:${id}`);
          if (t) teamsMap[id] = t;
        }
        this.game = { ...core, teams: teamsMap } as GameState;
      }
      this.loaded = true;
    });
  }

  private async save(): Promise<void> {
    if (!this.meta) return;
    this.meta.updatedAt = Date.now();
    const entries: Record<string, unknown> = { meta: this.meta, players: this.players, teams: this.teams };
    if (this.game) {
      const { teams, ...core } = this.game;
      entries['game:core'] = core;
      for (const [id, t] of Object.entries(teams)) entries[`game:team:${id}`] = t;
    }
    await this.ctx.storage.put(entries);
  }

  // ---------- HTTP 진입 ----------
  async fetch(request: Request): Promise<Response> {
    await this.load();
    const url = new URL(request.url);
    if (request.headers.get('upgrade') === 'websocket') return this.handleUpgrade(request);
    const path = url.pathname;

    if (path === '/init' && request.method === 'POST') {
      if (this.meta && this.meta.status !== 'expired') return new Response('exists', { status: 409 });
      const body = (await request.json()) as { code: string; nick: string; mode: ModeId; presetId: string; rounds: number; origin: string };
      const now = Date.now();
      const teacherPlayerId = 'P' + randomToken(4);
      this.meta = {
        code: body.code, createdAt: now, updatedAt: now, status: 'lobby', locked: false, mode: body.mode, presetId: body.presetId, rounds: body.rounds,
        teacherNick: body.nick, teacherToken: randomToken(), teacherPlayerId, timerScale: 1, phaseEndsAt: null, pausedRemaining: null, origin: body.origin, finishedAt: null,
        cmdLog: {}, cmdOrder: [], joinTimes: [], operatorGraceAt: null,
      };
      this.players = { [teacherPlayerId]: { id: teacherPlayerId, nick: body.nick, role: 'teacher', token: this.meta.teacherToken, teamId: null, isLeader: false, joinedAt: now, lastSeen: now } };
      this.teams = {};
      this.game = null;
      await this.save();
      await this.ctx.storage.setAlarm(now + LOBBY_IDLE_MS);
      return Response.json({ code: body.code, teacherToken: this.meta.teacherToken, playerId: teacherPlayerId });
    }

    if (!this.meta || this.meta.status === 'expired') return Response.json({ error: '없는 방 코드입니다.', exists: false }, { status: 404 });
    if (await this.maybeExpire()) return Response.json({ error: '만료된 방입니다.', exists: false }, { status: 410 });

    if (path === '/info') {
      return Response.json({ exists: true, code: this.meta.code, status: this.meta.status, locked: this.meta.locked, mode: this.meta.mode, presetId: this.meta.presetId, rounds: this.meta.rounds, players: Object.keys(this.players).length - 1, teams: Object.keys(this.teams).length, teacherNick: this.meta.teacherNick });
    }
    if (path === '/join' && request.method === 'POST') {
      const body = (await request.json()) as { nick: string };
      const now = Date.now();
      this.meta.joinTimes = this.meta.joinTimes.filter((t) => now - t < 10_000);
      if (this.meta.joinTimes.length >= 60) return Response.json({ error: '입장 요청이 너무 많습니다. 잠시 후 다시 시도하세요.' }, { status: 429 });
      this.meta.joinTimes.push(now);
      const nick = sanitizeName(body.nick, 12);
      if (nick.length < 1) return Response.json({ error: '닉네임을 입력하세요.' }, { status: 400 });
      if (Object.values(this.players).some((p) => p.nick.toLowerCase() === nick.toLowerCase())) return Response.json({ error: '이미 사용 중인 닉네임입니다.' }, { status: 409 });
      if (Object.keys(this.players).length - 1 >= MAX_PLAYERS) return Response.json({ error: '방이 가득 찼습니다.' }, { status: 409 });
      const role: PlayerRole = this.meta.status === 'lobby' && !this.meta.locked ? 'student' : 'spectator';
      if (this.meta.locked && this.meta.status === 'lobby') return Response.json({ error: '교사가 방을 잠갔습니다.' }, { status: 403 });
      const id = 'P' + randomToken(4);
      this.players[id] = { id, nick, role, token: randomToken(), teamId: null, isLeader: false, joinedAt: now, lastSeen: now };
      await this.save();
      this.scheduleBroadcast();
      return Response.json({ playerId: id, token: this.players[id]!.token, role });
    }
    if (path === '/teacher') {
      return Response.json({ code: this.meta.code, teacherToken: this.meta.teacherToken, playerId: this.meta.teacherPlayerId });
    }
    if (path === '/recover' && request.method === 'POST') {
      const body = (await request.json()) as { playerId: string };
      const p = this.players[body.playerId];
      if (!p || p.role === 'teacher') return Response.json({ error: '없는 참가자입니다.' }, { status: 404 });
      p.token = randomToken();
      for (const ws of this.ctx.getWebSockets(p.id)) { try { ws.close(4001, 'reissued'); } catch {} }
      await this.save();
      return Response.json({ playerId: p.id, token: p.token, nick: p.nick });
    }
    if (path === '/export') {
      return Response.json(this.exportData());
    }
    return new Response('not found', { status: 404 });
  }

  private exportData() {
    const g = this.game;
    return {
      code: this.meta?.code, mode: this.meta?.mode, presetId: this.meta?.presetId, rounds: this.meta?.rounds, createdAt: this.meta?.createdAt, status: this.meta?.status,
      scienceVersion: g?.scienceVersion, buildHash: g?.buildHash, configVersion: g?.config.version, seed: g?.seed,
      teams: Object.values(this.teams).map((t) => ({ id: t.id, name: t.name, emblem: t.emblem, color: t.color, members: t.members.map((m) => this.players[m]?.nick ?? '?') })),
      results: g?.results ?? null,
      assetHistory: g ? Object.fromEntries(Object.values(g.teams).map((t) => [t.name, t.assetHistory])) : null,
      deliveries: g ? Object.fromEntries(Object.values(g.teams).map((t) => [t.name, t.deliveredContracts])) : null,
      log: g?.log ?? [],
    };
  }

  // ---------- 만료 ----------
  private async maybeExpire(): Promise<boolean> {
    if (!this.meta) return false;
    const now = Date.now();
    const age = now - this.meta.createdAt;
    const idle = now - this.meta.updatedAt;
    const expired = age > MAX_AGE_MS
      || (this.meta.status === 'lobby' && idle > LOBBY_IDLE_MS)
      || (this.meta.status === 'finished' && this.meta.finishedAt !== null && now - this.meta.finishedAt > FINISHED_KEEP_MS);
    if (!expired) return false;
    for (const ws of this.ctx.getWebSockets()) { try { ws.send(JSON.stringify({ type: 'closed', reason: '방이 만료되었습니다.' } satisfies ServerMessage)); ws.close(4000, 'expired'); } catch {} }
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
    this.meta = { ...this.meta, status: 'expired' };
    this.players = {}; this.teams = {}; this.game = null;
    return true;
  }

  // ---------- WebSocket ----------
  private handleUpgrade(request: Request): Response {
    const url = new URL(request.url);
    const token = url.searchParams.get('token') ?? '';
    const player = Object.values(this.players).find((p) => p.token === token);
    if (!player || !this.meta) return new Response('unauthorized', { status: 401 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [player.id]);
    server.serializeAttachment({ playerId: player.id });
    player.lastSeen = Date.now();
    this.sendTo(server, { type: 'view', view: this.projectFor(player) });
    this.scheduleBroadcast();
    return new Response(null, { status: 101, webSocket: client });
  }

  private playerOf(ws: WebSocket): Player | null {
    const att = ws.deserializeAttachment() as { playerId?: string } | null;
    return att?.playerId ? this.players[att.playerId] ?? null : null;
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.load();
    if (!this.meta) return;
    const player = this.playerOf(ws);
    if (!player) { ws.close(4001, 'unknown'); return; }
    let env: ClientEnvelope;
    try { env = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)) as ClientEnvelope; } catch { return; }
    if (env.type === 'ping') { this.sendTo(ws, { type: 'pong', now: Date.now() }); return; }
    if (env.type !== 'cmd' || typeof env.id !== 'string') return;
    player.lastSeen = Date.now();
    // 중복 commandId: 같은 결과 반환, 두 번 소비하지 않음
    const key = `${player.id}:${env.id}`;
    const prev = this.meta.cmdLog[key];
    if (prev) { this.sendTo(ws, { type: 'ack', id: env.id, ok: prev.ok, error: prev.error }); return; }
    const res = await this.handleCommand(player, env.cmd);
    this.meta.cmdLog[key] = res;
    this.meta.cmdOrder.push(key);
    if (this.meta.cmdOrder.length > 400) { const old = this.meta.cmdOrder.splice(0, 100); for (const k of old) delete this.meta.cmdLog[k]; }
    this.sendTo(ws, { type: 'ack', id: env.id, ok: res.ok, error: res.error });
    await this.save();
    this.scheduleBroadcast();
  }

  async webSocketClose(ws: WebSocket, code?: number, reason?: string): Promise<void> {
    // 클라이언트가 시작한 종료는 서버가 close() 를 호출해야 핸드셰이크가 끝난다 (Hibernation API)
    try { ws.close(typeof code === 'number' && code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000, (reason ?? '').slice(0, 100)); } catch {}
    await this.load();
    const player = this.playerOf(ws);
    if (player && this.meta) {
      player.lastSeen = Date.now();
      // 조작 담당자 이탈: 15초 유예 후 다음 접속자에게
      if (this.game && this.game.phase === 'execute' && player.teamId) {
        const t = this.game.teams[player.teamId];
        if (t && t.operatorId === player.id && this.connectedCount(player.id) === 0) {
          this.meta.operatorGraceAt = Date.now() + OPERATOR_GRACE_MS;
          await this.rescheduleAlarm();
        }
      }
      await this.save();
    }
    this.scheduleBroadcast();
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  private connectedCount(playerId: string): number {
    return this.ctx.getWebSockets(playerId).length;
  }
  private isConnected(playerId: string): boolean {
    return this.connectedCount(playerId) > 0;
  }

  private sendTo(ws: WebSocket, msg: ServerMessage): void {
    try { ws.send(JSON.stringify(msg)); } catch {}
  }

  private scheduleBroadcast(): void {
    this.dirty = true;
    if (this.broadcastTimer) return;
    this.broadcastTimer = setTimeout(() => { this.broadcastTimer = null; if (this.dirty) this.broadcast(); }, BROADCAST_DELAY_MS);
  }

  /** 역할·팀별 projection 을 한 번씩만 계산해 보낸다. */
  private broadcast(): void {
    this.dirty = false;
    if (!this.meta) return;
    const cache = new Map<string, string>();
    for (const ws of this.ctx.getWebSockets()) {
      const p = this.playerOf(ws);
      if (!p) continue;
      const key = `${p.role}:${p.teamId ?? ''}:${p.id}`;
      let payload = cache.get(key);
      if (!payload) { payload = JSON.stringify({ type: 'view', view: this.projectFor(p) } satisfies ServerMessage); cache.set(key, payload); }
      try { ws.send(payload); } catch {}
    }
  }

  private toast(playerIds: string[] | 'all', text: string, level: 'info' | 'warn' | 'success' = 'info'): void {
    const ids = playerIds === 'all' ? Object.keys(this.players) : playerIds;
    for (const id of ids) for (const ws of this.ctx.getWebSockets(id)) this.sendTo(ws, { type: 'toast', text, level });
  }

  // ---------- Projection ----------
  private projectFor(p: Player): ClientView {
    const meta = this.meta!;
    const g = this.game;
    const players: PlayerPublic[] = Object.values(this.players).map((x) => ({ id: x.id, nick: x.nick, role: x.role, teamId: x.teamId, isLeader: x.isLeader, connected: this.isConnected(x.id) }));
    const teams: TeamPublic[] = Object.values(this.teams).map((t) => {
      const gt = g?.teams[t.id];
      return {
        id: t.id, name: t.name, color: t.color, emblem: t.emblem, leaderId: t.leaderId, members: t.members, ready: t.ready, bundleId: t.bundleId, leaseId: t.leaseId,
        contractsHeld: gt?.contracts.length ?? 0, delivered: gt?.delivered ?? 0, assetHistory: gt?.assetHistory ?? [], category: gt ? teamCategory(gt) : null, operatorId: gt?.operatorId ?? null, badges: gt?.badges ?? [],
      };
    });
    const myTeamId = p.teamId;
    const view: ClientView = {
      serverNow: Date.now(),
      me: { playerId: p.id, nick: p.nick, role: p.role, teamId: myTeamId, isLeader: p.isLeader, isOperator: !!(g && myTeamId && g.teams[myTeamId]?.operatorId === p.id) },
      room: {
        code: meta.code, status: meta.status, locked: meta.locked, mode: meta.mode, presetId: meta.presetId, rounds: meta.rounds, teacherNick: meta.teacherNick, teacherPlayerId: meta.teacherPlayerId,
        timerScale: meta.timerScale, phaseEndsAt: meta.phaseEndsAt, pausedRemaining: meta.pausedRemaining, createdAt: meta.createdAt, expiresAt: meta.createdAt + MAX_AGE_MS,
        joinUrl: `${meta.origin}/?room=${meta.code}`,
      },
      players,
      teams,
      game: g ? projectGame(g, myTeamId) : null,
    };
    if (p.role === 'teacher' && g) {
      view.teacherTeams = Object.values(g.teams).map((t) => stripTeam({ ...t, bid: 0 }));
      view.auctionsAll = g.auctions.map((a) => (a.resolved ? a : { ...a, bids: {} }));
    }
    return view;
  }

  // ---------- 명령 처리 ----------
  private async handleCommand(p: Player, cmd: RoomCommand): Promise<{ ok: boolean; error?: string }> {
    const meta = this.meta!;
    const fail = (error: string) => ({ ok: false, error });
    const isTeacher = p.role === 'teacher';
    try {
      switch (cmd.type) {
        // ----- 교사 -----
        case 'appointLeader': {
          if (!isTeacher) return fail('교사만 팀장을 임명할 수 있습니다.');
          if (meta.status !== 'lobby') return fail('대기실에서만 임명할 수 있습니다.');
          const target = this.players[cmd.playerId];
          if (!target || target.role === 'teacher') return fail('없는 학생입니다.');
          if (!cmd.on && target.teamId && this.teams[target.teamId]?.leaderId === target.id) return fail('팀을 이미 만든 팀장입니다. 팀장 교체를 사용하세요.');
          target.isLeader = !!cmd.on;
          return { ok: true };
        }
        case 'movePlayer': {
          if (!isTeacher) return fail('교사만 이동시킬 수 있습니다.');
          const target = this.players[cmd.playerId];
          if (!target || target.role === 'teacher') return fail('없는 학생입니다.');
          if (cmd.teamId && !this.teams[cmd.teamId]) return fail('없는 팀입니다.');
          if (cmd.teamId && this.teams[cmd.teamId]!.members.length >= TEAM_MAX_MEMBERS) return fail('팀 인원이 가득 찼습니다.');
          this.removeFromTeam(target);
          if (cmd.teamId) { this.teams[cmd.teamId]!.members.push(target.id); target.teamId = cmd.teamId; target.role = 'student'; }
          this.syncTeamStates();
          return { ok: true };
        }
        case 'kickPlayer': {
          if (!isTeacher) return fail('교사만 내보낼 수 있습니다.');
          const target = this.players[cmd.playerId];
          if (!target || target.role === 'teacher') return fail('없는 학생입니다.');
          this.removeFromTeam(target);
          delete this.players[target.id];
          for (const ws of this.ctx.getWebSockets(target.id)) { this.sendTo(ws, { type: 'closed', reason: '교사가 내보냈습니다.' }); try { ws.close(4002, 'kicked'); } catch {} }
          this.syncTeamStates();
          return { ok: true };
        }
        case 'setTeamLeader': {
          if (!isTeacher) return fail('교사만 팀장을 교체할 수 있습니다.');
          const team = this.teams[cmd.teamId];
          const target = this.players[cmd.playerId];
          if (!team || !target || !team.members.includes(target.id)) return fail('그 팀의 팀원이 아닙니다.');
          if (team.leaderId) { const old = this.players[team.leaderId]; if (old) old.isLeader = false; }
          team.leaderId = target.id; target.isLeader = true;
          return { ok: true };
        }
        case 'disbandTeam': {
          if (!isTeacher) return fail('교사만 팀을 해산할 수 있습니다.');
          if (meta.status !== 'lobby') return fail('대기실에서만 해산할 수 있습니다.');
          const team = this.teams[cmd.teamId];
          if (!team) return fail('없는 팀입니다.');
          for (const m of team.members) { const pl = this.players[m]; if (pl) { pl.teamId = null; if (team.leaderId === m) pl.isLeader = false; } }
          delete this.teams[team.id];
          return { ok: true };
        }
        case 'lock': {
          if (!isTeacher) return fail('교사만 잠글 수 있습니다.');
          meta.locked = !!cmd.on;
          return { ok: true };
        }
        case 'start': {
          if (!isTeacher) return fail('교사만 시작할 수 있습니다.');
          if (meta.status !== 'lobby') return fail('이미 시작했습니다.');
          const teams = Object.values(this.teams).filter((t) => t.members.length > 0);
          if (teams.length < 1) return fail('팀이 하나 이상 필요합니다.');
          for (const t of Object.values(this.teams)) if (t.members.length === 0) delete this.teams[t.id];
          this.game = createGame({
            seed: `${meta.code}-${meta.createdAt}`, mode: meta.mode, presetId: meta.presetId, roundsTotal: meta.rounds, config: DEFAULT_ECONOMY,
            teams: teams.map((t) => ({ id: t.id, name: t.name, color: t.color, emblem: t.emblem, bundleId: t.bundleId, leaseId: t.leaseId })),
          });
          for (const t of teams) {
            if (t.bundleId) applyTeamCommand(this.game, t.id, { type: 'chooseBundle', bundleId: t.bundleId });
            if (t.leaseId) applyTeamCommand(this.game, t.id, { type: 'chooseLease', equipmentId: t.leaseId });
          }
          startGame(this.game);
          meta.status = 'playing';
          meta.locked = true;
          for (const pl of Object.values(this.players)) if (pl.role === 'student' && !pl.teamId) pl.role = 'spectator';
          this.assignOperators();
          await this.startPhaseTimer();
          this.notifyDirectory('playing');
          return { ok: true };
        }
        case 'pause': {
          if (!isTeacher) return fail('교사만 일시정지할 수 있습니다.');
          if (meta.status !== 'playing' || meta.phaseEndsAt === null) return fail('진행 중이 아닙니다.');
          meta.pausedRemaining = Math.max(0, meta.phaseEndsAt - Date.now());
          meta.phaseEndsAt = null;
          meta.status = 'paused';
          await this.ctx.storage.deleteAlarm();
          this.toast('all', '교사가 게임을 일시정지했습니다.', 'warn');
          return { ok: true };
        }
        case 'resume': {
          if (!isTeacher) return fail('교사만 재개할 수 있습니다.');
          if (meta.status !== 'paused') return fail('일시정지 상태가 아닙니다.');
          meta.phaseEndsAt = Date.now() + (meta.pausedRemaining ?? 0);
          meta.pausedRemaining = null;
          meta.status = 'playing';
          await this.rescheduleAlarm();
          this.toast('all', '게임을 재개합니다.', 'info');
          return { ok: true };
        }
        case 'extend': {
          if (!isTeacher) return fail('교사만 시간을 연장할 수 있습니다.');
          const sec = Math.max(5, Math.min(120, Math.floor(Number(cmd.seconds) || 0)));
          if (meta.status === 'paused') meta.pausedRemaining = (meta.pausedRemaining ?? 0) + sec * 1000;
          else if (meta.phaseEndsAt !== null) { meta.phaseEndsAt += sec * 1000; await this.rescheduleAlarm(); }
          else return fail('진행 중이 아닙니다.');
          this.toast('all', `교사가 ${sec}초 연장했습니다.`, 'info');
          return { ok: true };
        }
        case 'setTimerScale': {
          if (!isTeacher) return fail('교사만 조정할 수 있습니다.');
          const s = Number(cmd.scale);
          const minScale = this.env.ENVIRONMENT === 'production' ? 0.75 : 0.05;
          if (!(s >= minScale && s <= 2)) return fail('배율은 0.75~2 사이입니다.');
          meta.timerScale = s;
          return { ok: true };
        }
        case 'setOperator': {
          if (!isTeacher) return fail('교사만 조작권을 넘길 수 있습니다.');
          const g = this.game; const team = this.teams[cmd.teamId];
          if (!g || !team || !g.teams[team.id]) return fail('없는 팀입니다.');
          if (!team.members.includes(cmd.playerId)) return fail('그 팀의 팀원이 아닙니다.');
          g.teams[team.id]!.operatorId = cmd.playerId;
          g.version += 1;
          this.toast([cmd.playerId], '교사가 조작권을 넘겼습니다. 지금부터 당신이 담당자입니다.', 'success');
          return { ok: true };
        }
        case 'endGame': {
          if (!isTeacher) return fail('교사만 종료할 수 있습니다.');
          if (!this.game || this.game.phase === 'finished') return fail('진행 중인 경기가 없습니다.');
          // 조기 종료: 현재 라운드를 마지막으로 정산
          this.game.roundsTotal = Math.max(1, this.game.round);
          runToFinish(this.game);
          await this.onGameFinished();
          return { ok: true };
        }
        case 'teacherJoinTeam': {
          if (!isTeacher) return fail('교사 전용입니다.');
          if (meta.status !== 'lobby') return fail('대기실에서만 참가할 수 있습니다.');
          if (p.teamId) return fail('이미 팀에 참가했습니다.');
          const r = this.createTeamFor(p, cmd.name, cmd.color, cmd.emblem);
          return r;
        }
        case 'teacherLeaveTeam': {
          if (!isTeacher) return fail('교사 전용입니다.');
          if (meta.status !== 'lobby') return fail('대기실에서만 나갈 수 있습니다.');
          if (!p.teamId) return fail('팀에 속해 있지 않습니다.');
          const team = this.teams[p.teamId]!;
          this.removeFromTeam(p);
          if (team.members.length === 0) delete this.teams[team.id];
          else if (team.leaderId === p.id) { team.leaderId = team.members[0]!; this.players[team.leaderId]!.isLeader = true; }
          return { ok: true };
        }
        // ----- 팀장 -----
        case 'createTeam': {
          if (meta.status !== 'lobby') return fail('대기실에서만 팀을 만들 수 있습니다.');
          if (!p.isLeader) return fail('교사가 임명한 팀장만 팀을 만들 수 있습니다.');
          if (p.teamId) return fail('이미 팀에 속해 있습니다.');
          return this.createTeamFor(p, cmd.name, cmd.color, cmd.emblem);
        }
        case 'setBundle': {
          const team = this.leaderTeam(p);
          if (!team) return fail('팀장만 시작 묶음을 고를 수 있습니다.');
          if (meta.status !== 'lobby') return fail('시작 전에만 고를 수 있습니다.');
          if (!DEFAULT_ECONOMY.bundles.some((b) => b.id === cmd.bundleId)) return fail('없는 묶음입니다.');
          team.bundleId = cmd.bundleId;
          return { ok: true };
        }
        case 'setLease': {
          const team = this.leaderTeam(p);
          if (!team) return fail('팀장만 임대 설비를 고를 수 있습니다.');
          if (meta.mode !== 'industrial') return fail('산업 공방에서만 임대합니다.');
          if (!EQUIPMENT[cmd.equipmentId]?.leasable) return fail('임대할 수 없는 설비입니다.');
          team.leaseId = cmd.equipmentId;
          return { ok: true };
        }
        case 'ready': {
          const team = this.leaderTeam(p);
          if (!team) return fail('팀장만 준비를 누를 수 있습니다.');
          team.ready = !!cmd.on;
          return { ok: true };
        }
        case 'reorderMembers': {
          const team = this.leaderTeam(p);
          if (!team) return fail('팀장만 순서를 정할 수 있습니다.');
          if (meta.status !== 'lobby') return fail('첫 라운드 순서는 시작 전에만 정할 수 있습니다.');
          const order = (cmd.order ?? []).filter((id, i, arr) => team.members.includes(id) && arr.indexOf(id) === i);
          if (order.length !== team.members.length) return fail('순서 목록이 팀원과 맞지 않습니다.');
          team.members = order;
          return { ok: true };
        }
        // ----- 학생 -----
        case 'joinTeam': {
          if (meta.status !== 'lobby') return fail('경기 중에는 팀을 옮길 수 없습니다. 교사에게 요청하세요.');
          if (p.role === 'teacher') return fail('교사는 "팀으로 참가"를 사용하세요.');
          if (p.teamId) return fail('이미 팀에 속해 있습니다.');
          const team = this.teams[cmd.teamId];
          if (!team) return fail('없는 팀입니다.');
          if (team.members.length >= TEAM_MAX_MEMBERS) return fail('팀 인원이 가득 찼습니다.');
          team.members.push(p.id); p.teamId = team.id;
          return { ok: true };
        }
        case 'leaveTeam': {
          if (meta.status !== 'lobby') return fail('경기 중에는 팀을 나갈 수 없습니다.');
          if (!p.teamId) return fail('팀에 속해 있지 않습니다.');
          const team = this.teams[p.teamId]!;
          if (team.leaderId === p.id) return fail('팀장은 팀을 나갈 수 없습니다. 교사에게 팀장 교체를 요청하세요.');
          this.removeFromTeam(p);
          return { ok: true };
        }
        case 'team': {
          return await this.handleTeamCommand(p, cmd.cmd);
        }
        default:
          return fail('알 수 없는 명령입니다.');
      }
    } finally {
      this.syncTeamStates();
    }
  }

  private createTeamFor(p: Player, nameRaw: string, color: string, emblem: string): { ok: boolean; error?: string } {
    const name = sanitizeName(nameRaw, TEAM_NAME_MAX);
    if (!name) return { ok: false, error: '팀 이름을 입력하세요.' };
    if (Object.keys(this.teams).length >= MAX_TEAMS) return { ok: false, error: `팀은 최대 ${MAX_TEAMS}개입니다.` };
    if (Object.values(this.teams).some((t) => t.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: '같은 이름의 팀이 있습니다.' };
    const usedEmblems = new Set(Object.values(this.teams).map((t) => t.emblem));
    const usedColors = new Set(Object.values(this.teams).map((t) => t.color));
    const em = TEAM_EMBLEMS.includes(emblem as (typeof TEAM_EMBLEMS)[number]) && !usedEmblems.has(emblem) ? emblem : TEAM_EMBLEMS.find((e) => !usedEmblems.has(e)) ?? 'circle';
    const col = TEAM_COLORS.includes(color) && !usedColors.has(color) ? color : TEAM_COLORS.find((c) => !usedColors.has(c)) ?? TEAM_COLORS[0]!;
    const id = 'T' + randomToken(3);
    this.teams[id] = { id, name, color: col, emblem: em, leaderId: p.id, members: [p.id], ready: false, bundleId: 'gas', leaseId: null, operatorStart: 0 };
    p.teamId = id; p.isLeader = true;
    return { ok: true };
  }

  private leaderTeam(p: Player): Team | null {
    if (!p.teamId) return null;
    const t = this.teams[p.teamId];
    return t && t.leaderId === p.id ? t : null;
  }

  private removeFromTeam(p: Player): void {
    if (!p.teamId) return;
    const t = this.teams[p.teamId];
    if (t) t.members = t.members.filter((m) => m !== p.id);
    p.teamId = null;
  }

  /** 경기 중 편입/이탈이 있어도 게임 팀 상태의 구성원 목록은 방 상태를 따른다 (자원 추가 지급 없음). */
  private syncTeamStates(): void {
    if (!this.game) return;
    for (const t of Object.values(this.teams)) {
      const gt = this.game.teams[t.id];
      if (gt) { gt.name = t.name; gt.color = t.color; gt.emblem = t.emblem; }
    }
  }

  private async handleTeamCommand(p: Player, cmd: TeamCommand): Promise<{ ok: boolean; error?: string }> {
    const g = this.game;
    if (!g) return { ok: false, error: '경기가 시작되지 않았습니다.' };
    if (!p.teamId || !g.teams[p.teamId]) return { ok: false, error: '팀에 속해 있지 않습니다.' };
    if (this.meta!.status === 'paused') return { ok: false, error: '일시정지 중입니다.' };
    const team = g.teams[p.teamId]!;
    const freeForAll = cmd.type === 'memo' || cmd.type === 'pin';
    if (cmd.type === 'pin') {
      // 핑 제한: 팀당 최근 10초 6개
      const recent = team.pins.filter((x) => Date.now() - x.at < 10_000).length;
      if (recent >= 6) return { ok: false, error: '핑이 너무 많습니다. 잠시 후 다시 시도하세요.' };
      cmd = { ...cmd, playerId: p.id };
    }
    if (!freeForAll && team.operatorId !== p.id) return { ok: false, error: '이번 라운드의 조작 담당자만 실행할 수 있습니다. 제안은 핑으로 남기세요.' };
    const res = applyTeamCommand(g, team.id, cmd);
    return { ok: res.ok, error: res.error };
  }

  // ---------- 조작 담당자 순환 ----------
  private assignOperators(): void {
    const g = this.game;
    if (!g) return;
    for (const t of Object.values(this.teams)) {
      const gt = g.teams[t.id];
      if (!gt || !t.members.length) continue;
      const n = t.members.length;
      const base = (t.operatorStart + Math.max(0, g.round - 1)) % n;
      let chosen: string | null = null;
      for (let k = 0; k < n; k++) {
        const cand = t.members[(base + k) % n]!;
        if (this.isConnected(cand)) { chosen = cand; break; }
      }
      gt.operatorId = chosen ?? t.members[base]!;
      gt.operatorIndex = base;
      if (chosen) this.toast([chosen], `${g.round}라운드 조작 담당자는 당신입니다.`, 'success');
    }
  }

  private reassignDisconnectedOperators(): void {
    const g = this.game;
    if (!g || g.phase !== 'execute') return;
    for (const t of Object.values(this.teams)) {
      const gt = g.teams[t.id];
      if (!gt || !gt.operatorId || this.isConnected(gt.operatorId)) continue;
      const idx = t.members.indexOf(gt.operatorId);
      for (let k = 1; k <= t.members.length; k++) {
        const cand = t.members[(idx + k) % t.members.length]!;
        if (this.isConnected(cand)) { gt.operatorId = cand; this.toast([cand], '담당자 연결이 끊겨 조작권이 당신에게 넘어왔습니다.', 'warn'); break; }
      }
    }
  }

  // ---------- 타이머·알람 ----------
  private phaseDurationMs(phase: GameState['phase']): number {
    const sec = phase === 'plan' ? PHASE_SECONDS.plan : phase === 'execute' ? PHASE_SECONDS.execute : PHASE_SECONDS.settle;
    return Math.round(sec * 1000 * (this.meta?.timerScale ?? 1));
  }

  private async startPhaseTimer(from?: number): Promise<void> {
    const g = this.game; const meta = this.meta!;
    if (!g || g.phase === 'finished' || g.phase === 'setup') { meta.phaseEndsAt = null; await this.rescheduleAlarm(); return; }
    meta.phaseEndsAt = (from ?? Date.now()) + this.phaseDurationMs(g.phase);
    await this.rescheduleAlarm();
  }

  private async rescheduleAlarm(): Promise<void> {
    const meta = this.meta!;
    const cands: number[] = [];
    if (meta.phaseEndsAt !== null && meta.status === 'playing') cands.push(meta.phaseEndsAt);
    if (meta.operatorGraceAt !== null) cands.push(meta.operatorGraceAt);
    // 만료 점검
    if (meta.status === 'lobby') cands.push(meta.updatedAt + LOBBY_IDLE_MS);
    if (meta.status === 'finished' && meta.finishedAt) cands.push(meta.finishedAt + FINISHED_KEEP_MS);
    cands.push(meta.createdAt + MAX_AGE_MS);
    await this.ctx.storage.setAlarm(Math.min(...cands));
  }

  async alarm(): Promise<void> {
    await this.load();
    const meta = this.meta;
    if (!meta || meta.status === 'expired') return;
    if (await this.maybeExpire()) return;
    const now = Date.now();
    if (meta.operatorGraceAt !== null && now >= meta.operatorGraceAt) {
      meta.operatorGraceAt = null;
      this.reassignDisconnectedOperators();
    }
    // 누락된 단계 경계를 순서대로 한 번씩만 처리 (늦은 알람·휴면 복귀)
    let guard = 0;
    while (this.game && meta.status === 'playing' && meta.phaseEndsAt !== null && now >= meta.phaseEndsAt && guard++ < 6) {
      const boundary = meta.phaseEndsAt;
      advancePhase(this.game);
      if (this.game.phase === 'finished') { await this.onGameFinished(); break; }
      if (this.game.phase === 'plan') this.assignOperators();
      if (this.game.phase === 'execute') this.toast('all', `${this.game.round}라운드 실행 단계 시작`, 'info');
      // 늦게 실행됐으면 밀린 만큼 이어서 계산하되, 실제 시각을 지나치게 뒤처지지 않게 한다
      const next = boundary + this.phaseDurationMs(this.game.phase);
      meta.phaseEndsAt = next > now ? next : now + Math.min(this.phaseDurationMs(this.game.phase), 15_000);
    }
    await this.save();
    await this.rescheduleAlarm();
    this.scheduleBroadcast();
  }

  private async onGameFinished(): Promise<void> {
    const meta = this.meta!;
    meta.status = 'finished';
    meta.finishedAt = Date.now();
    meta.phaseEndsAt = null;
    meta.pausedRemaining = null;
    this.notifyDirectory('finished');
    this.toast('all', '경기가 끝났습니다. 결과를 확인하세요.', 'success');
  }

  private notifyDirectory(status: string): void {
    const meta = this.meta!;
    this.ctx.waitUntil(this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName('main')).fetch(new Request('https://dir/status', { method: 'POST', body: JSON.stringify({ code: meta.code, status }) })).catch(() => {}));
  }

}
