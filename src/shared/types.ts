/**
 * 리액션 길드 — 공용 타입.
 * 엔진·서버·클라이언트·시뮬레이터가 모두 이 파일을 사용한다.
 */

export type ModeId = 'classic' | 'extended' | 'industrial';
export type Phase = 's' | 'l' | 'g' | 'aq';
export type CompositionClass = 'element' | 'compound' | 'mixture';
export type StructureClass = 'molecular' | 'ionic' | 'metallic' | 'network';

/** 재고 단위: 1칸 = 100,000 µmol (0.1 mol). 정수로만 저장한다. */
export const MICROMOL_PER_UNIT = 100_000;

export interface MaterialDefinition {
  id: string;
  formula: string;
  displayName: string;
  /** 원소 기호 → 화학식 단위당 원자 수 */
  composition: Record<string, number>;
  charge: number;
  phase: Phase;
  compositionClass: CompositionClass;
  structureClass: StructureClass;
  /** 이온성 물질의 이온 구성 (표시용) */
  ions?: { formula: string; charge: number; count: number }[];
  /** 몰질량 (교육용 반올림 원자량 기준, g/mol) */
  molarMass: number;
  tags: string[];
  /** 한 줄 설명 (용도) */
  blurb: string;
  /** 반응에서 수용액 형태로 쓰일 때 공정 용수를 유입해 용해할 수 있는가 */
  soluble?: boolean;
}

export type LotGrade = 'purchased' | 'produced' | 'recovered' | 'contract';

export interface LotComponent {
  materialId: string;
  units: number;
}

export interface LotOrigin {
  type: 'purchase' | 'reaction' | 'process' | 'bundle' | 'lease';
  reactionId?: string;
  processId?: string;
  /** 공정 이력 체인 (예: ['R07','P02']) */
  chain: string[];
}

export interface Lot {
  id: string;
  kind: 'pure' | 'mixture';
  /** kind === 'pure' 일 때 */
  materialId?: string;
  /** kind === 'mixture' 일 때 */
  components?: LotComponent[];
  units: number;
  grade: LotGrade;
  /** 품질/이력 태그: purchased, reaction, condensed, gasCollected, filtered, filtrate, crystallized, refined, recovered, solutionWater */
  tags: string[];
  /** 운반 용매(공정 용수) 칸 수 — 판매 가능한 순수 물이 아니다 */
  solvent: number;
  origin: LotOrigin;
}

export interface ReactantSpec {
  /** 허용 물질 ID 목록 (첫 항목이 표시용 대표) */
  accepts: string[];
  coef: number;
  /** 고체 원료를 공정 용수로 용해하여 투입하는가 */
  dissolve?: boolean;
}

export interface ProductSpec {
  materialId: string;
  coef: number;
}

export interface OutputStream {
  /** 스트림 안의 생성물 (계수는 최소 정수비 기준) */
  products: ProductSpec[];
  /** 순물질 스트림에 부여할 태그 */
  tags: string[];
  /** 혼합물이면 mixture 로트가 된다 */
  mixture?: boolean;
  /** 수용액 스트림이면 용매 칸(최소비 기준)을 기록 */
  solvent?: number;
  grade?: LotGrade;
}

export interface ReactionDefinition {
  id: string;
  name: string;
  equation: string;
  reactants: ReactantSpec[];
  /** 화학량론 생성물 (원소 보존 검증용, 최소 정수비) */
  products: ProductSpec[];
  /** 게임 배치(최소비의 배수). 부분 전환 반응은 배치 기준으로 투입/생성한다. */
  batchMultiplier: number;
  /** 부분 전환 모델: 배치 투입량 중 진행 extent (최소비 배수) */
  extentModel: { type: 'full' } | { type: 'partial'; extent: number; note: string };
  /** 배치 기준 생성 스트림 (부분 전환의 잔류물 포함) */
  outputs: OutputStream[];
  energy: number;
  time: number;
  /** 촉매 모듈이 있을 때의 시간 */
  timeWithCatalyst?: number;
  catalystEquipment?: string;
  requiredEquipment?: string[];
  exothermic: boolean;
  heatRecoverable: boolean;
  conditions: string;
  handling: string;
  gasVolumeRatio?: { label: string; ratio: string; note: string };
  scientificSources: string[];
  simplifications: string[];
  modes: ModeId[];
  path: 'gas' | 'carbonate' | 'metal' | 'bio' | 'water';
}

export interface ProcessDefinition {
  id: string;
  name: string;
  energy: number;
  fee: number;
  time: number;
  requiredEquipment?: string;
  description: string;
}

export interface EquipmentDefinition {
  id: string;
  name: string;
  price: number;
  effect: string;
  imageId: string;
  modes: ModeId[];
  /** 임대 가능 (산업 모드 무료 임대 후보) */
  leasable?: boolean;
}

export interface ContractRequirement {
  materialId: string;
  units: number;
  /** 허용 태그 중 하나가 있어야 한다. 구매 로트는 항상 불가. */
  tags: string[];
}

export interface ContractTemplate {
  id: string;
  title: string;
  blurb: string;
  requirements: ContractRequirement[];
  reward: number;
  modes: ModeId[];
  category: 'water' | 'gas' | 'ceramics' | 'paper' | 'salt' | 'metal' | 'nitrogen' | 'bio';
  byproductOnly?: boolean;
  /** 최소 소요 라운드(반응·가공·납품 포함) — 도달 가능성/기한 계산 */
  minRounds: number;
  imageId: string;
}

export interface ContractInstance {
  id: string;
  templateId: string;
  title: string;
  requirements: ContractRequirement[];
  /** 기본금 (pricingVersion 2) 또는 고정 지급액 (구버전) */
  reward: number;
  deadlineRound: number;
  acquiredRound: number;
  special?: boolean;
  bidPaid?: number;
  /** 2 = 기본금 + 시장 가감액. 없으면 구버전 고정가 */
  pricingVersion?: number;
  /** 시장 카테고리 (생성 시 명시) */
  category?: string;
  /** 고정 특별 보너스 (시세와 무관) */
  bonus?: number;
}

export type EventType = 'energy' | 'discount' | 'paperDemand' | 'metalDemand' | 'gasDemand' | 'transport';

export interface MarketEvent {
  id: string;
  type: EventType;
  announceRound: number;
  applyRound: number;
  materials?: string[];
  applied: boolean;
  label: string;
}

export interface StartBundle {
  id: string;
  name: string;
  items: { materialId: string; units: number }[];
  extraCoins: number;
  blurb: string;
}

export interface EconomyConfig {
  version: string;
  startCoins: number;
  startEnergy: number;
  energyCap: number;
  energyPerRound: number;
  actionsPerRound: number;
  reactionSlots: number;
  processSlots: number;
  contractLimit: number;
  procureMaxKinds: number;
  procureMaxTotal: number;
  procureMaxPerKindPerRound: number;
  energyBundleCost: number;
  energyBundleAmount: number;
  energyBundleMax: number;
  heatRecoveryPerRound: number;
  equipmentSalvageRate: number;
  auctionRounds: number[];
  auctionMaxBid: number;
  auctionBonus: number;
  eventMaxPerGame: number;
  sameTemplateLimit: number;
  byproductTemplateLimit: number;
  offersPerRound: number;
  deadlineSlack: number;
  prices: Record<string, number>;
  contractRewards: Record<string, number>;
  equipmentPrices: Record<string, number>;
  reactionEnergy: Record<string, number>;
  reactionTime: Record<string, number>;
  bundles: StartBundle[];
}

export interface RunningProcess {
  id: string;
  kind: 'reaction' | 'process';
  defId: string;
  scale: number;
  startedRound: number;
  completesRound: number;
  /** 완료 시 추가될 로트 (시작 시 확정) */
  outputs: Lot[];
  /** 표시용 투입 요약 */
  inputSummary: string;
  heatRecoverable: boolean;
  energySpent: number;
  feePaid: number;
  /** 완료 시 용매 원장(회수수)으로 돌아가는 공정 용수 */
  solventReleased: number;
}

export interface OwnedEquipment {
  id: string;
  paid: number;
  leased: boolean;
  round: number;
}

export interface Pin {
  playerId: string;
  target: string;
  label: string;
  at: number;
}

export interface TeamState {
  id: string;
  name: string;
  color: string;
  emblem: string;
  bundleId: string | null;
  leaseId: string | null;
  coins: number;
  energy: number;
  actionsLeft: number;
  lots: Lot[];
  processes: RunningProcess[];
  equipment: OwnedEquipment[];
  contracts: ContractInstance[];
  offers: ContractInstance[];
  templateCounts: Record<string, number>;
  cancelledThisRound: boolean;
  lastCancelRound: number;
  bid: number;
  purchasesThisRound: Record<string, number>;
  heatRecoveredThisRound: number;
  delivered: number;
  deliveredContracts: { round: number; templateId: string; reward: number; special: boolean }[];
  revenue: number;
  assetHistory: number[];
  solventLedger: { inflow: number; recovered: number; disposed: number };
  /** 원소 원장: 외부에서 들어온 원자 수(칸 단위)와 납품으로 나간 원자 수 */
  elementLedger: { inflow: Record<string, number>; outflow: Record<string, number> };
  memo: string;
  pins: Pin[];
  /** 서버가 지정하는 이번 라운드 조작 담당자 */
  operatorId: string | null;
  operatorIndex: number;
  /** 수동 라운드: 이번 라운드 준비 완료 */
  roundReady: boolean;
  /** 연출용 배지 */
  badges: string[];
  stalledRounds: number;
  firstDeliveryRound: number | null;
  producedCount: number;
  processedCount: number;
  reactionUse: Record<string, number>;
}

export interface Auction {
  id: string;
  round: number;
  contract: ContractInstance;
  bids: Record<string, number>;
  resolved: boolean;
  winnerId: string | null;
  priorityOrder: string[];
}

export interface GameEvent {
  at: number;
  round: number;
  teamId?: string;
  type: string;
  text: string;
}

export interface FinalTeamResult {
  teamId: string;
  name: string;
  coins: number;
  salvage: number;
  asset: number;
  delivered: number;
  rank: number;
  badges: string[];
  topReaction: string | null;
  revenue: number;
}

export interface GameState {
  version: number;
  seed: string;
  mode: ModeId;
  presetId: string;
  roundsTotal: number;
  round: number;
  phase: 'setup' | 'plan' | 'execute' | 'settle' | 'finished';
  config: EconomyConfig;
  scienceVersion: string;
  buildHash: string;
  teamOrder: string[];
  teams: Record<string, TeamState>;
  activeReactions: string[];
  activeContracts: string[];
  activeEquipment: string[];
  shopMaterials: string[];
  priceAdjust: Record<string, number>;
  rewardAdjust: Record<string, number>;
  events: MarketEvent[];
  auctions: Auction[];
  log: GameEvent[];
  results: FinalTeamResult[] | null;
  transportBonusRound: number | null;
  /** 수동(준비 완료로 진행) 또는 시간제(구버전) */
  turnMode: 'manual' | 'timed';
  /** 카테고리별 시장 단계 z */
  market: Record<string, number>;
  /** 라운드별 z 기록 (index 0 = 1라운드) */
  marketHistory: Record<string, number[]>;
  /** 정산 1회마다 +1 */
  roundVersion: number;
}

export type TeamCommand =
  | { type: 'procure'; items: { materialId: string; units: number }[] }
  | { type: 'buyEnergy'; bundles: number }
  | { type: 'react'; reactionId: string; scale: 1 | 2 }
  | { type: 'process'; processId: string; lotId: string }
  | { type: 'deliver'; contractId: string; quoteVersion?: number }
  | { type: 'readyRound'; on: boolean }
  | { type: 'equip'; equipmentId: string }
  | { type: 'takeContract'; offerId: string }
  | { type: 'cancelContract'; contractId: string }
  | { type: 'bid'; amount: number }
  | { type: 'chooseBundle'; bundleId: string }
  | { type: 'chooseLease'; equipmentId: string }
  | { type: 'memo'; text: string }
  | { type: 'pin'; playerId: string; target: string; label: string };

export interface CommandResult {
  ok: boolean;
  error?: string;
  /** 실행 행동을 소비했는가 */
  consumedAction?: boolean;
  events?: GameEvent[];
}

export interface Preset {
  id: string;
  mode: ModeId;
  name: string;
  blurb: string;
  reactions: string[];
  contracts: string[];
  equipment: string[];
}

export interface ModePack {
  id: ModeId;
  name: string;
  blurb: string;
  presets: Preset[];
}
