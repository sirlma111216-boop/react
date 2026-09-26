import type { ContractTemplate } from '../types';

/** 계약 템플릿 14종. reward 는 게임 보상이며 시세가 아니다. economy config 가 덮어쓴다. */
export const CONTRACTS: Record<string, ContractTemplate> = {
  C01: { id: 'C01', title: '냉각 장치용 깨끗한 물', blurb: '도시 냉각 장치에 쓸 응축한 물', requirements: [{ materialId: 'H2O_l', units: 4, tags: ['condensed', 'refined'] }], reward: 24, modes: ['classic', 'extended', 'industrial'], category: 'water', minRounds: 3, imageId: 'district-water' },
  C02: { id: 'C02', title: '이웃 공방에 산소 배달', blurb: '이웃 공방의 가마에 넣을 산소', requirements: [{ materialId: 'O2_g', units: 2, tags: ['gasCollected'] }], reward: 22, modes: ['classic', 'extended', 'industrial'], category: 'gas', minRounds: 2, imageId: 'district-energy' },
  C03: { id: 'C03', title: '세라믹 타일 재료', blurb: '뜨거워도 견디는 타일을 만드는 산화마그네슘', requirements: [{ materialId: 'MgO_s', units: 2, tags: ['reaction'] }], reward: 26, modes: ['classic', 'extended', 'industrial'], category: 'ceramics', minRounds: 2, imageId: 'district-ceramics' },
  C04: { id: 'C04', title: '종이 공장 탄산칼슘', blurb: '종이를 희고 매끈하게 만드는 가루', requirements: [{ materialId: 'CaCO3_s', units: 2, tags: ['filtered'] }], reward: 30, modes: ['classic', 'extended', 'industrial'], category: 'paper', minRounds: 3, imageId: 'district-paper' },
  C05: { id: 'C05', title: '소금 결정', blurb: '소금물에서 만든 소금 결정', requirements: [{ materialId: 'NaCl_s', units: 4, tags: ['crystallized'] }], reward: 18, modes: ['classic', 'extended', 'industrial'], category: 'salt', minRounds: 4, imageId: 'district-ceramics' },
  C06: { id: 'C06', title: '이산화탄소 통', blurb: '따로 모아 둔 이산화탄소', requirements: [{ materialId: 'CO2_g', units: 2, tags: ['gasCollected'] }], reward: 12, modes: ['classic', 'extended', 'industrial'], category: 'gas', byproductOnly: true, minRounds: 2, imageId: 'district-energy' },
  C07: { id: 'C07', title: '종이 공장 묶음 주문', blurb: '탄산칼슘과 이산화탄소를 함께 배달', requirements: [{ materialId: 'CaCO3_s', units: 2, tags: ['filtered'] }, { materialId: 'CO2_g', units: 2, tags: ['gasCollected'] }], reward: 44, modes: ['classic', 'extended', 'industrial'], category: 'paper', minRounds: 4, imageId: 'district-paper' },
  C08: { id: 'C08', title: '수소 통', blurb: '따로 모아 둔 수소', requirements: [{ materialId: 'H2_g', units: 2, tags: ['gasCollected'] }], reward: 24, modes: ['extended', 'industrial'], category: 'gas', minRounds: 2, imageId: 'district-energy' },
  C09: { id: 'C09', title: '금속 공방 구리', blurb: '건져 내어 말린 구리', requirements: [{ materialId: 'Cu_s', units: 2, tags: ['filtered', 'reaction'] }], reward: 36, modes: ['extended', 'industrial'], category: 'metal', minRounds: 3, imageId: 'district-metals' },
  C10: { id: 'C10', title: '산화구리 가루', blurb: '직접 만든 산화구리', requirements: [{ materialId: 'CuO_s', units: 2, tags: ['reaction'] }], reward: 32, modes: ['extended', 'industrial'], category: 'metal', minRounds: 4, imageId: 'district-metals' },
  C11: { id: 'C11', title: '암모니아 통', blurb: '정제한 암모니아', requirements: [{ materialId: 'NH3_g', units: 2, tags: ['refined'] }], reward: 42, modes: ['industrial'], category: 'nitrogen', minRounds: 5, imageId: 'district-energy' },
  C12: { id: 'C12', title: '염화암모늄 가루', blurb: '직접 만든 염화암모늄', requirements: [{ materialId: 'NH4Cl_s', units: 2, tags: ['reaction'] }], reward: 52, modes: ['industrial'], category: 'nitrogen', minRounds: 6, imageId: 'district-bioprocess' },
  C13: { id: 'C13', title: '에탄올 병', blurb: '발효한 뒤 정제한 에탄올', requirements: [{ materialId: 'ethanol_l', units: 2, tags: ['refined'] }], reward: 36, modes: ['industrial'], category: 'bio', minRounds: 4, imageId: 'district-bioprocess' },
  C14: { id: 'C14', title: '아세트산에틸 병', blurb: '정제한 에스터', requirements: [{ materialId: 'ethylAcetate_l', units: 1, tags: ['refined'] }], reward: 54, modes: ['industrial'], category: 'bio', minRounds: 5, imageId: 'district-bioprocess' },
};

export function contractTemplate(id: string): ContractTemplate {
  const c = CONTRACTS[id];
  if (!c) throw new Error(`계약 없음: ${id}`);
  return c;
}

export const CATEGORY_LABEL: Record<ContractTemplate['category'], string> = {
  water: '물·냉각', gas: '기체·에너지', ceramics: '세라믹', paper: '제지', salt: '소금', metal: '금속', nitrogen: '질소 화학', bio: '바이오',
};
