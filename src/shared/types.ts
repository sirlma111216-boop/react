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

/** support = 길드 연구지원품(외부 공급). 계약 조건이 allowSupport 를 명시할 때만 납품에 쓸 수 있다. */
export type LotGrade = 'purchased' | 'produced' | 'recovered' | 'contract' | 'support';

export interface LotComponent {
  materialId: string;
  units: number;
}

export interface LotOrigin {
  type: 'purchase' | 'reaction' | 'process' | 'bundle' | 'lease' | 'support';
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
  /**
   * 경제 가치 원장(V3): 이 로트가 담고 있는 회수 원가 풀(밀리코인, 정수).
   * 구매 = 실제 지불액, 지원품 = 명시된 외부지원 가치. 반응·가공은 투입 풀을 산출물에 나눠 줄 뿐 새로 만들지 않는다.
   * 물질량 원장(elementLedger)과 별개다. 없으면 0.
   */
  basis?: number;
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
  /** 검수된 연구지원품(grade 'support') 완성 소재를 이 조건에 보탤 수 있는가. 명시하지 않으면 불가. */
  allowSupport?: boolean;
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
  /** 구버전(rules 2) 고정 시작 묶음. V3 새 경기는 1라운드 연구지원품으로 시작하므로 쓰지 않는다. */
  bundles: StartBundle[];
  /** V3: 물질별 기준 회수가치(코인, 소수 1자리). 경기 시작 시 설정에 고정되어 경기 중 바뀌지 않는다. */
  materialValues?: Record<string, number>;
  support?: SupportConfig;
  buyback?: BuybackConfig;
}

export interface SupportConfig {
  /** 완성 소재 상자: 칸 수 */
  finishedUnits: number;
  /** 공정 재료 상자: 합계 칸 수 범위 */
  processUnits: [number, number];
  /** 기초 원료 상자: 합계 칸 수 범위 */
  basicUnits: [number, number];
  /** 같은 라운드·같은 종류 묶음의 추정 활용가치가 공통 예산에서 벗어나도 되는 비율 */
  tolerance: number;
  /** 종류별 활용가치 가중치 (가공 단계가 적을수록 행동·에너지를 아낀다) */
  weight: { finished: number; process: number; basic: number };
  /** 완성 소재 풀에서 제외할 물질 (1칸이 계약 하나를 통째로 끝내는 것 등) */
  finishedExclude: string[];
}

export interface BuybackConfig {
  /** 기준 회수가치 대비 매입 비율 */
  rate: number;
  /** 한 라운드 매입액 상한(코인) */
  roundCap: number;
  /** 기본 라운드 수(10) 기준 경기 누적 상한. 실제 상한은 경기 길이에 비례해 시작 시 고정 */
  gameCap: number;
  baseRounds: number;
  /** 팀당 라운드 매각 횟수 */
  perRound: number;
}

export type SupportKind = 'finished' | 'process' | 'basic';

export interface SupportItem {
  materialId: string;
  units: number;
  /** 입고될 로트의 품질 태그 (완성 소재는 계약 조건 태그, 원료는 빈 배열) */
  tags: string[];
}

export interface SupportBundle {
  kind: SupportKind;
  items: SupportItem[];
  /** 추정 활용가치 (코인 환산, 공정성 측정·표시용) */
  value: number;
  /** 이 묶음을 만든 기준 반응 (연결성 검사·추천용) */
  recipe?: string;
}

export interface SupportGrant {
  grantId: string;
  round: number;
  bundles: SupportBundle[];
  status: 'pending' | 'received' | 'forfeited';
  returnedIndex: number | null;
  /** 누가 확정했는가: 담당자 / 교사 대리 / 수령 포기 */
  resolvedBy: 'operator' | 'teacher' | 'forfeit' | null;
  /** 같은 라운드 공통 예산 (종류별) */
  budget: Record<SupportKind, number>;
}

export interface SupportRecord {
  round: number;
  grantId: string;
  status: 'received' | 'forfeited';
  returnedKind: SupportKind | null;
  keptValue: number;
  resolvedBy: 'operator' | 'teacher' | 'forfeit';
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
  /** V3: 이번 라운드 연구지원품 (서버가 시드·라운드·팀으로 만들어 저장) */
  support?: SupportGrant | null;
  supportHistory?: SupportRecord[];
  /** V3: 잉여 재고 매입 기록 */
  buyback?: { lastRound: number; totalCoins: number; sales: { round: number; coins: number; units: number }[] };
  /** V3: 경제 가치 원장 (밀리코인). inflow = 보유 basis + delivered + sold 가 항상 성립 */
  valueLedger?: { inflow: number; delivered: number; sold: number };
  /** V3 관측: 납품에 쓰인 칸 중 무가공 지원품 칸 */
  deliveredUnits?: number;
  deliveredSupportUnits?: number;
  supportRevenue?: number;
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
  /** 최종 납품 정산 뒤 남은 물품 요약 (점수에 더하지도 빼지도 않는다) */
  leftover?: { materialId: string | null; label: string; units: number; mixture: boolean }[];
  buybackCoins?: number;
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
  /** 규칙 버전. 3 = 연구지원품·잉여 재고 매입·가치 원장. 없으면(구버전 저장 상태) 2 */
  rules?: number;
  /** V3: 경기 시작 시 고정한 매입 누적 상한 */
  buybackGameCap?: number;
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
  | { type: 'pin'; playerId: string; target: string; label: string }
  /** V3: 연구지원품 1묶음 반송 · 나머지 2묶음 받기 (담당자) */
  | { type: 'chooseSupport'; grantId: string; returnIndex: number }
  /** V3: 잉여 재고 매입. expectCoins 는 화면에 보여 준 견적 — 다르면 거절 */
  | { type: 'sellSurplus'; items: { lotId: string; units: number }[]; expectCoins?: number };

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
