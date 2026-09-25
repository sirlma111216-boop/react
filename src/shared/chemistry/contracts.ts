import type { ContractTemplate } from '../types';

/** 계약 템플릿 14종. reward 는 게임 보상이며 시세가 아니다. economy config 가 덮어쓴다. */
export const CONTRACTS: Record<string, ContractTemplate> = {
  C01: { id: 'C01', title: '냉각 장치용 정제수', blurb: '도시 냉각 설비에 쓸 응축 정제수', requirements: [{ materialId: 'H2O_l', units: 4, tags: ['condensed', 'refined'] }], reward: 24, modes: ['classic', 'extended', 'industrial'], category: 'water', minRounds: 3, imageId: 'district-water' },
  C02: { id: 'C02', title: '공방 산소 공급', blurb: '이웃 공방의 연소로에 넣을 산소', requirements: [{ materialId: 'O2_g', units: 2, tags: ['gasCollected'] }], reward: 22, modes: ['classic', 'extended', 'industrial'], category: 'gas', minRounds: 2, imageId: 'district-energy' },
  C03: { id: 'C03', title: '세라믹 원료', blurb: '내열 타일 공방의 산화마그네슘', requirements: [{ materialId: 'MgO_s', units: 2, tags: ['reaction'] }], reward: 26, modes: ['classic', 'extended', 'industrial'], category: 'ceramics', minRounds: 2, imageId: 'district-ceramics' },
  C04: { id: 'C04', title: '종이 공장 충전재', blurb: '종이를 희고 매끈하게 만드는 탄산칼슘', requirements: [{ materialId: 'CaCO3_s', units: 2, tags: ['filtered'] }], reward: 30, modes: ['classic', 'extended', 'industrial'], category: 'paper', minRounds: 3, imageId: 'district-paper' },
  C05: { id: 'C05', title: '결정 소금 원료', blurb: '결정화한 염화나트륨', requirements: [{ materialId: 'NaCl_s', units: 4, tags: ['crystallized'] }], reward: 18, modes: ['classic', 'extended', 'industrial'], category: 'salt', minRounds: 4, imageId: 'district-ceramics' },
  C06: { id: 'C06', title: '공정용 CO2', blurb: '분리 회수한 이산화탄소', requirements: [{ materialId: 'CO2_g', units: 2, tags: ['gasCollected'] }], reward: 12, modes: ['classic', 'extended', 'industrial'], category: 'gas', byproductOnly: true, minRounds: 2, imageId: 'district-energy' },
  C07: { id: 'C07', title: '제지 공장 묶음 주문', blurb: '충전재와 공정용 기체를 함께 납품', requirements: [{ materialId: 'CaCO3_s', units: 2, tags: ['filtered'] }, { materialId: 'CO2_g', units: 2, tags: ['gasCollected'] }], reward: 44, modes: ['classic', 'extended', 'industrial'], category: 'paper', minRounds: 4, imageId: 'district-paper' },
  C08: { id: 'C08', title: '수소 공정 공급', blurb: '수소 공정에 쓸 분리 수집 수소', requirements: [{ materialId: 'H2_g', units: 2, tags: ['gasCollected'] }], reward: 24, modes: ['extended', 'industrial'], category: 'gas', minRounds: 2, imageId: 'district-energy' },
  C09: { id: 'C09', title: '금속 공방 구리', blurb: '회수 등급 구리', requirements: [{ materialId: 'Cu_s', units: 2, tags: ['filtered', 'reaction'] }], reward: 36, modes: ['extended', 'industrial'], category: 'metal', minRounds: 3, imageId: 'district-metals' },
  C10: { id: 'C10', title: '산화구리 소재', blurb: '생산 이력이 있는 산화구리', requirements: [{ materialId: 'CuO_s', units: 2, tags: ['reaction'] }], reward: 32, modes: ['extended', 'industrial'], category: 'metal', minRounds: 4, imageId: 'district-metals' },
  C11: { id: 'C11', title: '질소 화학 원료', blurb: '산업 회수 암모니아', requirements: [{ materialId: 'NH3_g', units: 2, tags: ['refined'] }], reward: 42, modes: ['industrial'], category: 'nitrogen', minRounds: 5, imageId: 'district-energy' },
  C12: { id: 'C12', title: '염화암모늄 원료', blurb: '회수 등급 염화암모늄', requirements: [{ materialId: 'NH4Cl_s', units: 2, tags: ['reaction'] }], reward: 52, modes: ['industrial'], category: 'nitrogen', minRounds: 6, imageId: 'district-bioprocess' },
  C13: { id: 'C13', title: '바이오 공정 용매', blurb: '지정 정제 등급 에탄올', requirements: [{ materialId: 'ethanol_l', units: 2, tags: ['refined'] }], reward: 36, modes: ['industrial'], category: 'bio', minRounds: 4, imageId: 'district-bioprocess' },
  C14: { id: 'C14', title: '에스터 용매 원료', blurb: '지정 분리 등급 아세트산에틸', requirements: [{ materialId: 'ethylAcetate_l', units: 1, tags: ['refined'] }], reward: 54, modes: ['industrial'], category: 'bio', minRounds: 5, imageId: 'district-bioprocess' },
};

export function contractTemplate(id: string): ContractTemplate {
  const c = CONTRACTS[id];
  if (!c) throw new Error(`계약 없음: ${id}`);
  return c;
}

export const CATEGORY_LABEL: Record<ContractTemplate['category'], string> = {
  water: '물·냉각', gas: '기체·에너지', ceramics: '세라믹', paper: '제지', salt: '소금', metal: '금속', nitrogen: '질소 화학', bio: '바이오',
};
