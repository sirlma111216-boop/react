/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from 'cloudflare:workers';
import type { GameState, ModeId, TeamCommand, TeamState } from '../shared/types';
import type { ClientEnvelope, ClientView, PlayerPublic, PlayerRole, RoomCommand, ServerMessage, TeamPublic } from '../shared/protocol';
import { sanitizeName, TEAM_NAME_MAX } from '../shared/protocol';
import { createGame, TEAM_COLORS, TEAM_EMBLEMS } from '../shared/engine/state';
import { advancePhase, startGame, settleAndOpenNextRound, allTeamsReady } from '../shared/engine/phases';
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

/** 관측 기록 (제한시간을 부과하지 않는 진단용). 개인 공개 순위에 쓰지 않는다. */
interface ObsEvent {
  t: number;
  round: number;
  teamId: string | null;
  playerId: string | null;
  type: string;
  detail: string;
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
  /** manual: 준비 완료로 진행 (새 방 기본). timed: 구버전 시간제 방 */
  turnMode: 'manual' | 'timed';
  timerScale: number;
  phaseEndsAt: number | null;
  pausedRemaining: number | null;
  origin: string;
  finishedAt: number | null;
  cmdLog: Record<string, { ok: boolean; error?: string }>;
  cmdOrder: string[];
  joinTimes: number[];
  operatorGraceAt: number | null;
  /** 정산 진행 중 플래그 (경합 방지) */
  settling: boolean;
  obs: ObsEvent[];
  schemaVersion: number;
}

const LOBBY_IDLE_MS = 2 * 60 * 60 * 1000;
const FINISHED_KEEP_MS = 24 * 60 * 60 * 1000;
const MAX_AGE_MS = 48 * 60 * 60 * 1000;
const MAX_PLAYERS = 40;
const MAX_TEAMS = 8;
const TEAM_MAX_MEMBERS = 8;
const OPERATOR_GRACE_MS = 15_000;
const BROADCAST_DELAY_MS = 120;
const OBS_MAX = 600;
const SCHEMA_VERSION = 2;

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
      this.meta = meta ? this.migrateMeta(meta) : null;
      this.players = players ?? {};
      this.teams = teams ?? {};
      if (core) {
        const teamsMap: Record<string, TeamState> = {};
        for (const id of core.teamOrder) {
          const t = await this.ctx.storage.get<TeamState>(`game:team:${id}`);
          if (t) teamsMap[id] = { ...t, roundReady: t.roundReady ?? false } as TeamState;
        }
        const g = { ...core, teams: teamsMap } as GameState;
        // 구버전 저장 상태 보정 (자동 리셋 없이 기본값만 채운다)
        g.turnMode ??= 'timed';
        g.market ??= {};
        g.marketHistory ??= {};
        g.roundVersion ??= 0;
        this.game = g;
      }
      this.loaded = true;
    });
  }

  private migrateMeta(m: RoomMeta): RoomMeta {
    const out = { ...m } as RoomMeta;
    if (!out.turnMode) out.turnMode = 'timed'; // schemaVersion 1 방은 시간제였다
    out.settling ??= false;
    out.obs ??= [];
    out.schemaVersion ??= 1;
    return out;
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

  private observe(type: string, detail: string, playerId: string | null = null, teamId: string | null = null): void {
    const meta = this.meta;
    if (!meta) return;
    meta.obs.push({ t: Date.now(), round: this.game?.round ?? 0, teamId, playerId, type, detail: detail.slice(0, 80) });
    if (meta.obs.length > OBS_MAX) meta.obs.splice(0, meta.obs.length - OBS_MAX);
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
        teacherNick: body.nick, teacherToken: randomToken(), teacherPlayerId, turnMode: 'manual', timerScale: 1, phaseEndsAt: null, pausedRemaining: null, origin: body.origin, finishedAt: null,
        cmdLog: {}, cmdOrder: [], joinTimes: [], operatorGraceAt: null, settling: false, obs: [], schemaVersion: SCHEMA_VERSION,
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
      return Response.json({ exists: true, code: this.meta.code, status: this.meta.status, locked: this.meta.locked, mode: this.meta.mode, presetId: this.meta.presetId, rounds: this.meta.rounds, players: Object.keys(this.players).length - 1, teams: Object.keys(this.teams).length, teacherNick: this.meta.teacherNick, turnMode: this.meta.turnMode });
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
    const obs = this.meta?.obs ?? [];
    // 장소별 체류·막힘 사유·준비 대기: 팀 단위 요약 (개인 공개 순위 없음)
    const byTeam: Record<string, { placeMoves: Record<string, number>; blocked: Record<string, number>; ready: number; unready: number; skipped: number; disconnects: number }> = {};
    for (const e of obs) {
      const key = e.teamId ?? '-';
      const b = (byTeam[key] ??= { placeMoves: {}, blocked: {}, ready: 0, unready: 0, skipped: 0, disconnects: 0 });
      if (e.type === 'place') b.placeMoves[e.detail] = (b.placeMoves[e.detail] ?? 0) + 1;
      else if (e.type === 'blocked') b.blocked[e.detail] = (b.blocked[e.detail] ?? 0) + 1;
      else if (e.type === 'ready') b.ready++;
      else if (e.type === 'unready') b.unready++;
      else if (e.type === 'skip') b.skipped++;
      else if (e.type === 'disconnect') b.disconnects++;
    }
    return {
      code: this.meta?.code, mode: this.meta?.mode, presetId: this.meta?.presetId, rounds: this.meta?.rounds, createdAt: this.meta?.createdAt, status: this.meta?.status, turnMode: this.meta?.turnMode,
      scienceVersion: g?.scienceVersion, buildHash: g?.buildHash, configVersion: g?.config.version, seed: g?.seed,
      teams: Object.values(this.teams).map((t) => ({ id: t.id, name: t.name, emblem: t.emblem, color: t.color, members: t.members.map((m) => this.players[m]?.nick ?? '?') })),
      results: g?.results ?? null,
      assetHistory: g ? Object.fromEntries(Object.values(g.teams).map((t) => [t.name, t.assetHistory])) : null,
      deliveries: g ? Object.fromEntries(Object.values(g.teams).map((t) => [t.name, t.deliveredContracts])) : null,
      marketHistory: g?.marketHistory ?? null,
      observation: { byTeam, note: '실제 경과시간은 진단용이며 게임 결과·생산·가격을 바꾸지 않는다.' },
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
    if (env.cmd.type !== 'observe') {
      this.meta.cmdLog[key] = res;
      this.meta.cmdOrder.push(key);
      if (this.meta.cmdOrder.length > 400) { const old = this.meta.cmdOrder.splice(0, 100); for (const k of old) delete this.meta.cmdLog[k]; }
    }
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
      if (this.connectedCount(player.id) === 0) this.observe('disconnect', player.role, player.id, player.teamId);
      // 시간제(구버전) 방에서만 15초 뒤 자동 이전. 수동 모드는 교사/팀장이 명시적으로 넘긴다.
      if (this.meta.turnMode === 'timed' && this.game && this.game.phase === 'execute' && player.teamId) {
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
        roundReady: gt?.roundReady ?? false, actionsLeft: gt?.actionsLeft ?? 0, connectedCount: t.members.filter((m) => this.isConnected(m)).length,
      };
    });
    const myTeamId = p.teamId;
    const view: ClientView = {
      serverNow: Date.now(),
      me: { playerId: p.id, nick: p.nick, role: p.role, teamId: myTeamId, isLeader: p.isLeader, isOperator: !!(g && myTeamId && g.teams[myTeamId]?.operatorId === p.id) },
      room: {
        code: meta.code, status: meta.status, locked: meta.locked, mode: meta.mode, presetId: meta.presetId, rounds: meta.rounds, teacherNick: meta.teacherNick, teacherPlayerId: meta.teacherPlayerId,
        timerScale: meta.timerScale, turnMode: meta.turnMode, phaseEndsAt: meta.turnMode === 'manual' ? null : meta.phaseEndsAt, pausedRemaining: meta.pausedRemaining, createdAt: meta.createdAt, expiresAt: meta.createdAt + MAX_AGE_MS,
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
        case 'observe': {
          const place = String(cmd.place ?? '').slice(0, 20);
          if (place) this.observe('place', place, p.id, p.teamId);
          return { ok: true };
        }
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
            seed: `${meta.code}-${meta.createdAt}`, mode: meta.mode, presetId: meta.presetId, roundsTotal: meta.rounds, config: DEFAULT_ECONOMY, turnMode: meta.turnMode,
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
          if (meta.turnMode === 'timed') await this.startPhaseTimer();
          else await this.rescheduleAlarm();
          this.observe('start', meta.turnMode);
          this.notifyDirectory('playing');
          return { ok: true };
        }
        case 'pause': {
          if (!isTeacher) return fail('교사만 멈출 수 있습니다.');
          if (meta.status !== 'playing') return fail('진행 중이 아닙니다.');
          if (meta.turnMode === 'timed') {
            if (meta.phaseEndsAt === null) return fail('진행 중이 아닙니다.');
            meta.pausedRemaining = Math.max(0, meta.phaseEndsAt - Date.now());
            meta.phaseEndsAt = null;
          }
          meta.status = 'paused';
          await this.rescheduleAlarm();
          this.observe('pause', '');
          this.toast('all', '선생님이 게임을 잠시 멈췄습니다.', 'warn');
          return { ok: true };
        }
        case 'resume': {
          if (!isTeacher) return fail('교사만 재개할 수 있습니다.');
          if (meta.status !== 'paused') return fail('멈춤 상태가 아닙니다.');
          meta.status = 'playing';
          if (meta.turnMode === 'timed') { meta.phaseEndsAt = Date.now() + (meta.pausedRemaining ?? 0); meta.pausedRemaining = null; }
          await this.rescheduleAlarm();
          this.toast('all', '게임을 다시 시작합니다.', 'info');
          // 멈춤 중에 모든 팀이 준비되었을 수 있다
          await this.tryAdvanceRound();
          return { ok: true };
        }
        case 'extend': {
          if (!isTeacher) return fail('교사만 시간을 연장할 수 있습니다.');
          if (meta.turnMode !== 'timed') return fail('수동 진행 방에는 제한시간이 없습니다.');
          const sec = Math.max(5, Math.min(120, Math.floor(Number(cmd.seconds) || 0)));
          if (meta.status === 'paused') meta.pausedRemaining = (meta.pausedRemaining ?? 0) + sec * 1000;
          else if (meta.phaseEndsAt !== null) { meta.phaseEndsAt += sec * 1000; await this.rescheduleAlarm(); }
          else return fail('진행 중이 아닙니다.');
          return { ok: true };
        }
        case 'setTimerScale': {
          if (!isTeacher) return fail('교사만 조정할 수 있습니다.');
          if (meta.turnMode !== 'timed') return fail('수동 진행 방에는 제한시간이 없습니다.');
          const s = Number(cmd.scale);
          const minScale = this.env.ENVIRONMENT === 'production' ? 0.75 : 0.05;
          if (!(s >= minScale && s <= 2)) return fail('배율은 0.75~2 사이입니다.');
          meta.timerScale = s;
          return { ok: true };
        }
        case 'switchToManual': {
          if (!isTeacher) return fail('교사만 전환할 수 있습니다.');
          if (meta.turnMode === 'manual') return fail('이미 수동 진행입니다.');
          // 안전한 경계: 행동 단계(execute) 또는 대기실에서만 전환
          if (this.game && this.game.phase !== 'execute' && this.game.phase !== 'finished') return fail('행동 단계에서만 수동 진행으로 바꿀 수 있습니다.');
          meta.turnMode = 'manual';
          meta.phaseEndsAt = null; meta.pausedRemaining = null; meta.operatorGraceAt = null;
          if (this.game) { this.game.turnMode = 'manual'; for (const t of Object.values(this.game.teams)) t.roundReady = false; }
          await this.rescheduleAlarm();
          this.observe('switchToManual', '');
          this.toast('all', '이제 제한시간 없이 "준비 완료"로 진행합니다.', 'info');
          return { ok: true };
        }
        case 'setOperator': {
          if (!isTeacher && !(p.teamId === cmd.teamId && this.teams[cmd.teamId]?.leaderId === p.id)) return fail('교사나 팀장만 차례를 넘길 수 있습니다.');
          const g = this.game; const team = this.teams[cmd.teamId];
          if (!g || !team || !g.teams[team.id]) return fail('없는 팀입니다.');
          if (!team.members.includes(cmd.playerId)) return fail('그 팀의 팀원이 아닙니다.');
          g.teams[team.id]!.operatorId = cmd.playerId;
          g.version += 1;
          this.observe('setOperator', cmd.playerId, p.id, team.id);
          this.toast([cmd.playerId], '차례가 당신에게 넘어왔어요. 지금부터 행동할 수 있어요.', 'success');
          return { ok: true };
        }
        case 'skipTeam': {
          if (!isTeacher) return fail('교사만 건너뛸 수 있습니다.');
          const g = this.game;
          if (!g || g.phase !== 'execute' || meta.turnMode !== 'manual') return fail('지금은 건너뛸 수 없습니다.');
          const gt = g.teams[cmd.teamId];
          if (!gt) return fail('없는 팀입니다.');
          // 남은 행동은 포기시키되, 이미 실행된 행동·예약된 입찰은 그대로 둔다
          gt.roundReady = true;
          g.version += 1;
          this.observe('skip', `actionsLeft=${gt.actionsLeft}`, p.id, gt.id);
          this.toast(this.teams[gt.id]?.members ?? [], '선생님이 이번 라운드를 건너뛰었어요.', 'warn');
          await this.tryAdvanceRound();
          return { ok: true };
        }
        case 'endGame': {
          if (!isTeacher) return fail('교사만 종료할 수 있습니다.');
          if (!this.game || this.game.phase === 'finished') return fail('진행 중인 경기가 없습니다.');
          this.game.roundsTotal = Math.max(1, this.game.round);
          runToFinish(this.game);
          await this.onGameFinished();
          return { ok: true };
        }
        case 'teacherJoinTeam': {
          if (!isTeacher) return fail('교사 전용입니다.');
          if (meta.status !== 'lobby') return fail('대기실에서만 참가할 수 있습니다.');
          if (p.teamId) return fail('이미 팀에 참가했습니다.');
          return this.createTeamFor(p, cmd.name, cmd.color, cmd.emblem);
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
          if (!team) return fail('팀장만 시작 재료를 고를 수 있습니다.');
          if (meta.status !== 'lobby') return fail('시작 전에만 고를 수 있습니다.');
          if (!DEFAULT_ECONOMY.bundles.some((b) => b.id === cmd.bundleId)) return fail('없는 시작 재료예요.');
          team.bundleId = cmd.bundleId;
          return { ok: true };
        }
        case 'setLease': {
          const team = this.leaderTeam(p);
          if (!team) return fail('팀장만 빌릴 장비를 고를 수 있습니다.');
          if (meta.mode !== 'industrial') return fail('산업 공방에서만 빌릴 수 있습니다.');
          if (!EQUIPMENT[cmd.equipmentId]?.leasable) return fail('빌릴 수 없는 장비예요.');
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
          if (meta.status !== 'lobby') return fail('차례 순서는 시작 전에만 정할 수 있습니다.');
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
    if (this.meta!.status === 'paused') return { ok: false, error: '선생님이 게임을 멈췄어요.' };
    const team = g.teams[p.teamId]!;
    const freeForAll = cmd.type === 'memo' || cmd.type === 'pin';
    if (cmd.type === 'pin') {
      const recent = team.pins.filter((x) => Date.now() - x.at < 10_000).length;
      if (recent >= 6) return { ok: false, error: '추천이 너무 많아요. 잠시 후 다시 해 주세요.' };
      cmd = { ...cmd, playerId: p.id };
    }
    if (!freeForAll && team.operatorId !== p.id) return { ok: false, error: `이번 차례는 ${this.players[team.operatorId ?? '']?.nick ?? '다른 팀원'}이에요. 👍 추천으로 제안할 수 있어요.` };
    if (cmd.type === 'readyRound' && this.meta!.settling) return { ok: false, error: '정산 중이에요. 잠시 후 최신 상태를 보내드릴게요.' };
    const res = applyTeamCommand(g, team.id, cmd);
    if (!res.ok) this.observe('blocked', `${cmd.type}:${(res.error ?? '').slice(0, 30)}`, p.id, team.id);
    else if (cmd.type === 'readyRound') this.observe(cmd.on ? 'ready' : 'unready', `actionsLeft=${team.actionsLeft}`, p.id, team.id);
    else if (cmd.type !== 'memo' && cmd.type !== 'pin') this.observe('action', cmd.type, p.id, team.id);
    if (res.ok && cmd.type === 'readyRound' && cmd.on) await this.tryAdvanceRound();
    return { ok: res.ok, error: res.error };
  }

  /** 수동 모드: 모든 참가 팀이 준비되면 정산을 정확히 한 번 수행하고 다음 라운드를 연다. */
  private async tryAdvanceRound(): Promise<boolean> {
    const meta = this.meta!;
    const g = this.game;
    if (!g || meta.turnMode !== 'manual' || meta.status !== 'playing' || g.phase !== 'execute' || meta.settling) return false;
    const teamIds = Object.values(this.teams).filter((t) => t.members.length > 0).map((t) => t.id);
    if (!allTeamsReady(g, teamIds)) return false;
    meta.settling = true;
    try {
      const done = g.round;
      settleAndOpenNextRound(g);
      if ((g.phase as string) === 'finished') { await this.onGameFinished(); }
      else {
        this.assignOperators();
        this.observe('settle', `round=${done}`);
        this.toast('all', `${done}라운드 마무리! ${g.round}라운드가 시작됐어요.`, 'info');
      }
    } finally {
      meta.settling = false;
    }
    return true;
  }

  // ---------- 차례 순환 ----------
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
      if (chosen) this.toast([chosen], `${g.round}라운드는 당신 차례예요.`, 'success');
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
        if (this.isConnected(cand)) { gt.operatorId = cand; this.toast([cand], '담당자 연결이 끊겨 차례가 당신에게 넘어왔어요.', 'warn'); break; }
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

  /** 알람은 시간제(구버전) 진행과 방 정리에만 쓴다. 수동 모드에서는 정리 알람만 남는다. */
  private async rescheduleAlarm(): Promise<void> {
    const meta = this.meta!;
    const cands: number[] = [];
    if (meta.turnMode === 'timed') {
      if (meta.phaseEndsAt !== null && meta.status === 'playing') cands.push(meta.phaseEndsAt);
      if (meta.operatorGraceAt !== null) cands.push(meta.operatorGraceAt);
    }
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
    // 수동 모드: 잔존 알람이 호출되어도 라운드를 진행하지 않는다
    if (meta.turnMode === 'timed') {
      const now = Date.now();
      if (meta.operatorGraceAt !== null && now >= meta.operatorGraceAt) {
        meta.operatorGraceAt = null;
        this.reassignDisconnectedOperators();
      }
      let guard = 0;
      while (this.game && meta.status === 'playing' && meta.phaseEndsAt !== null && now >= meta.phaseEndsAt && guard++ < 6) {
        const boundary = meta.phaseEndsAt;
        advancePhase(this.game);
        if (this.game.phase === 'finished') { await this.onGameFinished(); break; }
        if (this.game.phase === 'plan') this.assignOperators();
        const next = boundary + this.phaseDurationMs(this.game.phase);
        meta.phaseEndsAt = next > now ? next : now + Math.min(this.phaseDurationMs(this.game.phase), 15_000);
      }
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
    await this.rescheduleAlarm();
    this.notifyDirectory('finished');
    this.observe('finish', '');
    this.toast('all', '게임이 끝났어요. 결과를 확인하세요.', 'success');
  }

  private notifyDirectory(status: string): void {
    const meta = this.meta!;
    this.ctx.waitUntil(this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName('main')).fetch(new Request('https://dir/status', { method: 'POST', body: JSON.stringify({ code: meta.code, status }) })).catch(() => {}));
  }
}
