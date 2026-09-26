import type { GameState } from '../../shared/types';
import type { ClientView, RoomCommand } from '../../shared/protocol';
import type { GameClient } from './net';
import { createGame } from '../../shared/engine/state';
import { startGame, settleAndOpenNextRound, cachedReachability } from '../../shared/engine/phases';
import { applyTeamCommand } from '../../shared/engine/commands';
import { projectGame, stripTeam, teamCategory } from '../../shared/projection';
import { BOTS, makeExec } from '../../sim/bots';
import { subRng } from '../../shared/engine/rng';
import { store } from './store';

/**
 * 연습 모드: 서버 없이 브라우저 안에서 같은 엔진으로 1인 vs AI 공방.
 * 수동 라운드: 내가 '준비 완료'를 누르면 AI 팀이 행동하고 정산 1회 → 다음 라운드.
 */
export class LocalClient implements GameClient {
  readonly kind = 'local' as const;
  private state: GameState;
  private paused = false;
  private readonly me = { playerId: 'me', nick: '연습생', teamId: 'T1' };

  constructor(mode: 'classic' | 'extended' | 'industrial' = 'classic', rounds = 6) {
    this.state = createGame({
      seed: `practice-${Date.now()}`, mode, roundsTotal: rounds, turnMode: 'manual',
      teams: [
        { id: 'T1', name: '우리 공방', color: '#1F6F78', emblem: 'circle', bundleId: 'gas' },
        { id: 'T2', name: 'AI 공방', color: '#B87346', emblem: 'hexagon', bundleId: 'material' },
      ],
    });
    this.emit();
  }

  private emit(): void {
    const g = this.state;
    const teams = g.teamOrder.map((id) => {
      const t = g.teams[id]!;
      return { id, name: t.name, color: t.color, emblem: t.emblem, leaderId: id === 'T1' ? 'me' : 'ai', members: id === 'T1' ? ['me'] : ['ai'], ready: true, bundleId: t.bundleId, leaseId: t.leaseId, contractsHeld: t.contracts.length, delivered: t.delivered, assetHistory: t.assetHistory, category: teamCategory(t), operatorId: id === 'T1' ? 'me' : 'ai', badges: t.badges, roundReady: t.roundReady, actionsLeft: t.actionsLeft, connectedCount: 1 };
    });
    const view: ClientView = {
      serverNow: Date.now(),
      me: { playerId: 'me', nick: this.me.nick, role: 'student', teamId: 'T1', isLeader: true, isOperator: true },
      room: { code: 'PRACTC', status: g.phase === 'setup' ? 'lobby' : g.phase === 'finished' ? 'finished' : this.paused ? 'paused' : 'playing', locked: true, mode: g.mode, presetId: g.presetId, rounds: g.roundsTotal, teacherNick: '연습', teacherPlayerId: 'ai', timerScale: 1, turnMode: 'manual', phaseEndsAt: null, pausedRemaining: null, createdAt: Date.now(), expiresAt: Date.now() + 3600_000, joinUrl: '' },
      players: [{ id: 'me', nick: this.me.nick, role: 'student', teamId: 'T1', isLeader: true, connected: true }, { id: 'ai', nick: 'AI 공방장', role: 'student', teamId: 'T2', isLeader: true, connected: true }],
      teams,
      game: g.phase === 'setup' ? null : projectGame(g, 'T1'),
      teacherTeams: [stripTeam(g.teams['T2']!)],
    };
    store.setView(view);
  }

  refresh(): void {
    this.emit();
  }

  private botTurn(): void {
    const g = this.state;
    const map = cachedReachability(g);
    BOTS.planner.plan(g, 'T2', { rng: subRng(g.seed, 'ai', g.round, 'plan'), map, exec: makeExec(g, 'T2') });
    BOTS.planner.execute(g, 'T2', { rng: subRng(g.seed, 'ai', g.round, 'exec'), map, exec: makeExec(g, 'T2') });
    applyTeamCommand(g, 'T2', { type: 'readyRound', on: true });
  }

  async send(cmd: RoomCommand): Promise<{ ok: boolean; error?: string }> {
    const g = this.state;
    if (cmd.type === 'start') {
      if (g.phase !== 'setup') return { ok: false, error: '이미 시작했어요.' };
      applyTeamCommand(g, 'T2', { type: 'chooseBundle', bundleId: 'material' });
      startGame(g);
      g.teams['T1']!.operatorId = 'me';
      g.teams['T2']!.operatorId = 'ai';
      this.emit();
      return { ok: true };
    }
    if (cmd.type === 'setBundle') { const r = applyTeamCommand(g, 'T1', { type: 'chooseBundle', bundleId: cmd.bundleId }); this.emit(); return r; }
    if (cmd.type === 'observe') return { ok: true };
    if (cmd.type === 'team') {
      if (this.paused) return { ok: false, error: '멈춤 상태예요.' };
      const c = cmd.cmd.type === 'pin' ? { ...cmd.cmd, playerId: 'me' } : cmd.cmd;
      const r = applyTeamCommand(g, 'T1', c);
      if (r.ok && c.type === 'readyRound' && c.on && g.phase === 'execute') {
        this.botTurn();
        settleAndOpenNextRound(g);
        if ((g.phase as string) !== 'finished') { g.teams['T1']!.operatorId = 'me'; g.teams['T2']!.operatorId = 'ai'; }
      }
      this.emit();
      return { ok: r.ok, error: r.error };
    }
    return { ok: false, error: '연습 모드에서는 지원하지 않는 명령이에요.' };
  }

  close(): void {
    store.reset();
  }
}
