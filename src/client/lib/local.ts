import type { GameState } from '../../shared/types';
import type { ClientView, RoomCommand } from '../../shared/protocol';
import type { GameClient } from './net';
import { createGame } from '../../shared/engine/state';
import { startGame, beginExecute, settleRound, beginPlan, cachedReachability } from '../../shared/engine/phases';
import { applyTeamCommand } from '../../shared/engine/commands';
import { projectGame, stripTeam, teamCategory } from '../../shared/projection';
import { BOTS, makeExec } from '../../sim/bots';
import { subRng } from '../../shared/engine/rng';
import { store } from './store';

const PLAN_MS = 20_000;
const EXEC_MS = 60_000;
const SETTLE_MS = 8_000;

/**
 * 연습 모드: 서버 없이 브라우저 안에서 같은 엔진으로 1인 vs AI 공방.
 * 서버 projection 과 같은 ClientView 를 만들어 게임 보드를 그대로 사용한다.
 */
export class LocalClient implements GameClient {
  readonly kind = 'local' as const;
  private state: GameState;
  private phaseEndsAt: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private paused = false;
  private pausedRemaining: number | null = null;
  private readonly me = { playerId: 'me', nick: '연습생', teamId: 'T1' };

  constructor(private mode: 'classic' | 'extended' | 'industrial' = 'classic', rounds = 6) {
    this.state = createGame({
      seed: `practice-${Date.now()}`, mode, roundsTotal: rounds,
      teams: [
        { id: 'T1', name: '내 공방', color: '#1F6F78', emblem: 'circle', bundleId: 'gas' },
        { id: 'T2', name: 'AI 공방', color: '#B87346', emblem: 'hexagon', bundleId: 'material' },
      ],
    });
    void this.mode;
    this.emit();
  }

  private emit(): void {
    const g = this.state;
    const teams = g.teamOrder.map((id) => {
      const t = g.teams[id]!;
      return { id, name: t.name, color: t.color, emblem: t.emblem, leaderId: id === 'T1' ? 'me' : 'ai', members: id === 'T1' ? ['me'] : ['ai'], ready: true, bundleId: t.bundleId, leaseId: t.leaseId, contractsHeld: t.contracts.length, delivered: t.delivered, assetHistory: t.assetHistory, category: teamCategory(t), operatorId: id === 'T1' ? 'me' : 'ai', badges: t.badges };
    });
    const view: ClientView = {
      serverNow: Date.now(),
      me: { playerId: 'me', nick: this.me.nick, role: 'student', teamId: 'T1', isLeader: true, isOperator: true },
      room: { code: 'PRACTC', status: g.phase === 'setup' ? 'lobby' : g.phase === 'finished' ? 'finished' : this.paused ? 'paused' : 'playing', locked: true, mode: g.mode, presetId: g.presetId, rounds: g.roundsTotal, teacherNick: '연습', teacherPlayerId: 'ai', timerScale: 1, phaseEndsAt: this.phaseEndsAt, pausedRemaining: this.pausedRemaining, createdAt: Date.now(), expiresAt: Date.now() + 3600_000, joinUrl: '' },
      players: [{ id: 'me', nick: this.me.nick, role: 'student', teamId: 'T1', isLeader: true, connected: true }, { id: 'ai', nick: 'AI 공방장', role: 'student', teamId: 'T2', isLeader: true, connected: true }],
      teams,
      game: g.phase === 'setup' ? null : projectGame(g, 'T1'),
      teacherTeams: [stripTeam(g.teams['T2']!)],
    };
    store.setView(view);
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.phaseEndsAt = Date.now() + ms;
    this.timer = setTimeout(() => this.advance(), ms);
    this.emit();
  }

  private botPlan(): void {
    const map = cachedReachability(this.state);
    BOTS.planner.plan(this.state, 'T2', { rng: subRng(this.state.seed, 'ai', this.state.round, 'plan'), map, exec: makeExec(this.state, 'T2') });
  }
  private botExecute(): void {
    const map = cachedReachability(this.state);
    BOTS.planner.execute(this.state, 'T2', { rng: subRng(this.state.seed, 'ai', this.state.round, 'exec'), map, exec: makeExec(this.state, 'T2') });
  }

  /** 다음 단계로 (타이머 또는 사용자의 "다음 단계" 버튼) */
  advance(): void {
    const g = this.state;
    if (g.phase === 'finished') return;
    if (g.phase === 'plan') { this.botPlan(); beginExecute(g); this.botExecute(); this.schedule(EXEC_MS); }
    else if (g.phase === 'execute') { settleRound(g); if ((g.phase as string) === 'finished') { this.phaseEndsAt = null; if (this.timer) clearTimeout(this.timer); this.emit(); } else this.schedule(SETTLE_MS); }
    else if (g.phase === 'settle') { beginPlan(g); this.schedule(PLAN_MS); }
  }

  async send(cmd: RoomCommand): Promise<{ ok: boolean; error?: string }> {
    const g = this.state;
    if (cmd.type === 'start') {
      if (g.phase !== 'setup') return { ok: false, error: '이미 시작했습니다.' };
      applyTeamCommand(g, 'T2', { type: 'chooseBundle', bundleId: 'material' });
      startGame(g);
      this.schedule(PLAN_MS);
      return { ok: true };
    }
    if (cmd.type === 'setBundle') { const r = applyTeamCommand(g, 'T1', { type: 'chooseBundle', bundleId: cmd.bundleId }); this.emit(); return r; }
    if (cmd.type === 'pause') { if (this.timer) clearTimeout(this.timer); this.paused = true; this.pausedRemaining = Math.max(0, (this.phaseEndsAt ?? Date.now()) - Date.now()); this.phaseEndsAt = null; this.emit(); return { ok: true }; }
    if (cmd.type === 'resume') { this.paused = false; const ms = this.pausedRemaining ?? 1000; this.pausedRemaining = null; this.schedule(ms); return { ok: true }; }
    if (cmd.type === 'extend') { this.advance(); return { ok: true }; }
    if (cmd.type === 'team') {
      if (this.paused) return { ok: false, error: '일시정지 중입니다.' };
      const c = cmd.cmd.type === 'pin' ? { ...cmd.cmd, playerId: 'me' } : cmd.cmd;
      const r = applyTeamCommand(g, 'T1', c);
      this.emit();
      return { ok: r.ok, error: r.error };
    }
    return { ok: false, error: '연습 모드에서는 지원하지 않는 명령입니다.' };
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    store.reset();
  }
}
