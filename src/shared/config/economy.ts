import type { EconomyConfig } from '../types';

/**
 * 경제 설정. 밸런스 에이전트가 조정하는 대상이다. 화학 데이터는 여기에 없다.
 * `docs/DECISIONS.md` 와 `reports/balance/` 에 조정 이력을 남긴다.
 */
export const DEFAULT_ECONOMY: EconomyConfig = {
  version: 'econ-1.2',
  startCoins: 40,
  startEnergy: 6,
  energyCap: 12,
  energyPerRound: 2,
  actionsPerRound: 2,
  reactionSlots: 2,
  processSlots: 1,
  contractLimit: 2,
  procureMaxKinds: 3,
  procureMaxTotal: 6,
  procureMaxPerKindPerRound: 4,
  energyBundleCost: 2,
  energyBundleAmount: 3,
  energyBundleMax: 2,
  heatRecoveryPerRound: 2,
  equipmentSalvageRate: 0.5,
  auctionRounds: [3, 6],
  auctionMaxBid: 6,
  auctionBonus: 8,
  eventMaxPerGame: 3,
  sameTemplateLimit: 2,
  byproductTemplateLimit: 2,
  offersPerRound: 3,
  deadlineSlack: 2,
  prices: {
    H2_g: 2, O2_g: 1, H2O_l: 1, H2O2_aq: 3, CH4_g: 3, Mg_s: 3, NaHCO3_s: 1, Na2CO3_s: 3, CaCl2_s: 2, CaO_s: 3, CaOH2_s: 3,
    HCl_aq: 2, NaOH_aq: 2, CaCO3_s: 2, Zn_s: 4, CuSO4_aq: 4, CuO_s: 4, Fe_s: 3, N2_g: 1, glucose_aq: 4, ethanol_l: 4, aceticAcid_l: 3, HCl_g: 3,
  },
  contractRewards: {
    C01: 30, C02: 24, C03: 26, C04: 30, C05: 18, C06: 12, C07: 48, C08: 24, C09: 36, C10: 32, C11: 42, C12: 56, C13: 36, C14: 54,
  },
  equipmentPrices: { U01: 14, U02: 10, U03: 10, U04: 10, U05: 12, U06: 14, U07: 12, U08: 8, U09: 8, U10: 6 },
  reactionEnergy: {},
  reactionTime: {},
  bundles: [
    { id: 'gas', name: '기체 공방', items: [{ materialId: 'H2_g', units: 4 }, { materialId: 'O2_g', units: 2 }, { materialId: 'H2O2_aq', units: 4 }], extraCoins: 0, blurb: '물 합성으로 정제수 계약을 바로 노린다.' },
    { id: 'carbonate', name: '탄산 공방', items: [{ materialId: 'NaHCO3_s', units: 4 }, { materialId: 'CaCl2_s', units: 2 }, { materialId: 'Na2CO3_s', units: 1 }], extraCoins: 2, blurb: '열분해와 침전으로 제지 계약을 노린다.' },
    { id: 'material', name: '소재 공방', items: [{ materialId: 'Mg_s', units: 2 }, { materialId: 'O2_g', units: 2 }, { materialId: 'CaO_s', units: 1 }, { materialId: 'H2O_l', units: 2 }], extraCoins: 0, blurb: '마그네슘 연소로 세라믹 계약을 빠르게 완료한다.' },
  ],
};

/** 모드별 사용 가능 상점 원료 */
export const SHOP_BY_MODE: Record<string, string[]> = {
  classic: ['H2_g', 'O2_g', 'H2O_l', 'H2O2_aq', 'CH4_g', 'Mg_s', 'NaHCO3_s', 'Na2CO3_s', 'CaCl2_s', 'CaO_s', 'CaOH2_s', 'CaCO3_s'],
  extended: ['H2_g', 'O2_g', 'H2O_l', 'H2O2_aq', 'CH4_g', 'Mg_s', 'NaHCO3_s', 'Na2CO3_s', 'CaCl2_s', 'CaO_s', 'CaOH2_s', 'HCl_aq', 'NaOH_aq', 'CaCO3_s', 'Zn_s', 'CuSO4_aq', 'CuO_s', 'Fe_s'],
  industrial: ['H2_g', 'O2_g', 'H2O_l', 'H2O2_aq', 'CH4_g', 'Mg_s', 'NaHCO3_s', 'Na2CO3_s', 'CaCl2_s', 'CaO_s', 'CaOH2_s', 'HCl_aq', 'NaOH_aq', 'CaCO3_s', 'Zn_s', 'CuSO4_aq', 'CuO_s', 'Fe_s', 'N2_g', 'glucose_aq', 'ethanol_l', 'aceticAcid_l', 'HCl_g'],
};

export const ROUND_PRESETS: Record<string, { rounds: number; label: string }> = {
  quick: { rounds: 6, label: '빠른 게임 (6라운드, 약 15분)' },
  standard: { rounds: 10, label: '정규전 (10라운드, 약 25분)' },
  long: { rounds: 12, label: '긴 게임 (12라운드, 약 30분)' },
};

export const PHASE_SECONDS = { plan: 30, execute: 90, settle: 30 } as const;

export function cloneConfig(c: EconomyConfig): EconomyConfig {
  return JSON.parse(JSON.stringify(c)) as EconomyConfig;
}
