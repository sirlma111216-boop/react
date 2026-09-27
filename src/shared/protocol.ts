import type { Auction, ContractInstance, FinalTeamResult, GameEvent, MarketEvent, ModeId, TeamCommand, TeamState } from './types';

/** 방(Room) 수준 명령. 팀 게임 명령은 `team` 으로 감싼다. */
export type RoomCommand =
  // 교사
  | { type: 'appointLeader'; playerId: string; on: boolean }
  | { type: 'movePlayer'; playerId: string; teamId: string | null }
  | { type: 'kickPlayer'; playerId: string }
  | { type: 'setTeamLeader'; teamId: string; playerId: string }
  | { type: 'lock'; on: boolean }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'extend'; seconds: number }
  | { type: 'setTimerScale'; scale: number }
  | { type: 'setOperator'; teamId: string; playerId: string }
  | { type: 'skipTeam'; teamId: string }
  | { type: 'switchToManual' }
  | { type: 'endGame' }
  | { type: 'teacherJoinTeam'; name: string; color: string; emblem: string }
  | { type: 'teacherLeaveTeam' }
  | { type: 'disbandTeam'; teamId: string }
  /** V3: 교사가 멈춘 팀의 지원품을 대신 고름(기록됨) 또는 이번 라운드 수령 포기 */
  | { type: 'teacherSupport'; teamId: string; returnIndex: number }
  | { type: 'forfeitSupport'; teamId: string }
  // 팀장
  | { type: 'createTeam'; name: string; color: string; emblem: string }
  | { type: 'setBundle'; bundleId: string }
  | { type: 'setLease'; equipmentId: string }
  | { type: 'ready'; on: boolean }
  | { type: 'reorderMembers'; order: string[] }
  // 학생
  | { type: 'joinTeam'; teamId: string }
  | { type: 'leaveTeam' }
  | { type: 'team'; cmd: TeamCommand }
  /** 관측 기록용 (경제 명령 아님): 장소 이동 */
  | { type: 'observe'; place: string };

export interface ClientMessage {
  type: 'cmd';
  id: string;
  cmd: RoomCommand;
}
export type ClientEnvelope = ClientMessage | { type: 'ping' };

export type ServerMessage =
  | { type: 'view'; view: ClientView }
  | { type: 'ack'; id: string; ok: boolean; error?: string }
  | { type: 'toast'; text: string; level: 'info' | 'warn' | 'success' }
  | { type: 'pong'; now: number }
  | { type: 'closed'; reason: string };

export type PlayerRole = 'teacher' | 'student' | 'spectator';

export interface PlayerPublic {
  id: string;
  nick: string;
  role: PlayerRole;
  teamId: string | null;
  isLeader: boolean;
  connected: boolean;
}

export interface TeamPublic {
  id: string;
  name: string;
  color: string;
  emblem: string;
  leaderId: string | null;
  members: string[];
  ready: boolean;
  bundleId: string | null;
  leaseId: string | null;
  /** 경기 중 공개 정보 */
  contractsHeld: number;
  delivered: number;
  assetHistory: number[];
  category: string | null;
  operatorId: string | null;
  badges: string[];
  roundReady: boolean;
  actionsLeft: number;
  connectedCount: number;
  /** V3: 이번 라운드 지원품을 아직 고르지 않음 */
  supportPending: boolean;
}

export interface AuctionPublic {
  id: string;
  round: number;
  contract: ContractInstance;
  myBid: number;
  resolved: boolean;
  winnerId: string | null;
  bidderCount: number;
}

export interface GameView {
  round: number;
  roundsTotal: number;
  phase: 'setup' | 'plan' | 'execute' | 'settle' | 'finished';
  mode: ModeId;
  presetId: string;
  activeReactions: string[];
  activeEquipment: string[];
  shopMaterials: string[];
  prices: Record<string, number>;
  rewardAdjust: Record<string, number>;
  transportBonusRound: number | null;
  events: MarketEvent[];
  auction: AuctionPublic | null;
  log: GameEvent[];
  myTeam: TeamState | null;
  results: FinalTeamResult[] | null;
  turnMode: 'manual' | 'timed';
  market: Record<string, number>;
  marketHistory: Record<string, number[]>;
  roundVersion: number;
  /** 준비 완료한 팀 수 / 참가 팀 수 */
  readyCount: number;
  teamCount: number;
  config: { contractLimit: number; actionsPerRound: number; energyCap: number; procureMaxKinds: number; procureMaxTotal: number; procureMaxPerKindPerRound: number; energyBundleCost: number; energyBundleAmount: number; energyBundleMax: number; auctionMaxBid: number; bundles: { id: string; name: string; blurb: string; items: { materialId: string; units: number }[]; extraCoins: number }[] };
  /** 규칙 버전 (3 = 연구지원품·재고 매입) */
  rules: number;
  /** V3: 경기 중 고정된 기준 회수가치·매입 규칙 (화면 견적용, 서버가 같은 함수로 다시 계산) */
  materialValues: Record<string, number>;
  buyback: { rate: number; roundCap: number; gameCap: number; perRound: number } | null;
  reactionSlots: number;
}

export interface ClientView {
  serverNow: number;
  me: { playerId: string; nick: string; role: PlayerRole; teamId: string | null; isLeader: boolean; isOperator: boolean };
  room: {
    code: string;
    status: 'lobby' | 'playing' | 'paused' | 'finished' | 'expired';
    locked: boolean;
    mode: ModeId;
    presetId: string;
    rounds: number;
    teacherNick: string;
    teacherPlayerId: string;
    timerScale: number;
    turnMode: 'manual' | 'timed';
    phaseEndsAt: number | null;
    pausedRemaining: number | null;
    createdAt: number;
    expiresAt: number;
    joinUrl: string;
  };
  players: PlayerPublic[];
  teams: TeamPublic[];
  game: GameView | null;
  /** 교사 관전용: 모든 팀의 전체 상태 (입찰액은 개봉 전까지 제외) */
  teacherTeams?: TeamState[];
  auctionsAll?: Auction[];
}

export const NICK_MAX = 12;
export const TEAM_NAME_MAX = 12;

export function sanitizeName(raw: unknown, max: number): string {
  return String(raw ?? '')
    .replace(/[<>&"'`\\/]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
