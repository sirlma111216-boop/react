import type { MaterialDefinition, Phase, CompositionClass, StructureClass } from '../types';
import { parseFormula, molarMassOf, subscriptFormula } from './atoms';

interface Def {
  id: string;
  formula: string;
  name: string;
  phase: Phase;
  cls: CompositionClass;
  str: StructureClass;
  charge?: number;
  ions?: { formula: string; charge: number; count: number }[];
  tags?: string[];
  blurb: string;
  soluble?: boolean;
}

const defs: Def[] = [
  // 기체
  { id: 'H2_g', formula: 'H2', name: '수소', phase: 'g', cls: 'element', str: 'molecular', blurb: '가장 가벼운 기체. 물·암모니아를 만들고, 산화구리에서 산소를 떼어 내 구리를 얻는 데 쓴다.' },
  { id: 'O2_g', formula: 'O2', name: '산소', phase: 'g', cls: 'element', str: 'molecular', blurb: '물질이 탈 때 꼭 필요한 기체. 모아서 산소 배달 의뢰에 쓸 수 있다.' },
  { id: 'N2_g', formula: 'N2', name: '질소', phase: 'g', cls: 'element', str: 'molecular', blurb: '공기의 주성분. 암모니아 합성의 원료.' },
  { id: 'CH4_g', formula: 'CH4', name: '메테인', phase: 'g', cls: 'compound', str: 'molecular', blurb: '천연가스의 주성분. 완전 연소로 물과 이산화탄소를 만든다.' },
  { id: 'CO2_g', formula: 'CO2', name: '이산화탄소', phase: 'g', cls: 'compound', str: 'molecular', blurb: '연소·분해 때 함께 생기는 기체. 따로 모아 배달할 수 있다.' },
  { id: 'NH3_g', formula: 'NH3', name: '암모니아', phase: 'g', cls: 'compound', str: 'molecular', blurb: '질소 비료·화학 원료의 출발 물질.' },
  { id: 'HCl_g', formula: 'HCl', name: '염화수소(기체)', phase: 'g', cls: 'compound', str: 'molecular', blurb: '기체 상태의 염화수소. 물에 녹인 염산과는 다른 재료다.' },
  { id: 'H2O_g', formula: 'H2O', name: '수증기', phase: 'g', cls: 'compound', str: 'molecular', blurb: '기체 상태의 물. 응축해야 액체 물이 된다.' },
  // 물·용액
  { id: 'H2O_l', formula: 'H2O', name: '물', phase: 'l', cls: 'compound', str: 'molecular', blurb: '액체 물. 깨끗한 물(냉각 장치용) 의뢰에는 수증기를 응축하기로 식혀 얻은 물이 필요하다.' },
  { id: 'H2O2_aq', formula: 'H2O2', name: '과산화수소수', phase: 'aq', cls: 'compound', str: 'molecular', blurb: '분해하면 산소와 물이 된다.' },
  { id: 'HCl_aq', formula: 'HCl', name: '염산', phase: 'aq', cls: 'compound', str: 'molecular', ions: [{ formula: 'H+', charge: 1, count: 1 }, { formula: 'Cl-', charge: -1, count: 1 }], blurb: '염화수소를 물에 녹인 산. 염기와 섞으면 중화되고, 마그네슘·탄산칼슘과 반응해 기체가 나온다.' },
  { id: 'NaOH_aq', formula: 'NaOH', name: '수산화나트륨 수용액', phase: 'aq', cls: 'compound', str: 'ionic', ions: [{ formula: 'Na+', charge: 1, count: 1 }, { formula: 'OH-', charge: -1, count: 1 }], blurb: '물에 녹아 염기성을 띠는 용액. 산과 섞으면 중화되고, 황산구리 수용액과 섞으면 파란 앙금이 생긴다.' },
  { id: 'NaCl_aq', formula: 'NaCl', name: '염화나트륨 수용액', phase: 'aq', cls: 'compound', str: 'ionic', ions: [{ formula: 'Na+', charge: 1, count: 1 }, { formula: 'Cl-', charge: -1, count: 1 }], blurb: '소금물. 결정화하면 고체 소금이 된다.' },
  { id: 'CaCl2_aq', formula: 'CaCl2', name: '염화칼슘 수용액', phase: 'aq', cls: 'compound', str: 'ionic', ions: [{ formula: 'Ca2+', charge: 2, count: 1 }, { formula: 'Cl-', charge: -1, count: 2 }], blurb: '염화칼슘이 녹은 용액. 탄산나트륨과 섞으면 흰 앙금이 생긴다.' },
  { id: 'MgCl2_aq', formula: 'MgCl2', name: '염화마그네슘 수용액', phase: 'aq', cls: 'compound', str: 'ionic', ions: [{ formula: 'Mg2+', charge: 2, count: 1 }, { formula: 'Cl-', charge: -1, count: 2 }], blurb: '마그네슘과 염산 반응의 용액 생성물.' },
  { id: 'ZnSO4_aq', formula: 'ZnSO4', name: '황산아연 수용액', phase: 'aq', cls: 'compound', str: 'ionic', ions: [{ formula: 'Zn2+', charge: 2, count: 1 }, { formula: 'SO4 2-', charge: -2, count: 1 }], blurb: '아연이 구리 이온을 밀어낸 뒤 남는 용액.' },
  { id: 'CuSO4_aq', formula: 'CuSO4', name: '황산구리(II) 수용액', phase: 'aq', cls: 'compound', str: 'ionic', ions: [{ formula: 'Cu2+', charge: 2, count: 1 }, { formula: 'SO4 2-', charge: -2, count: 1 }], blurb: '푸른 구리 이온 용액. 구리 회수의 출발 물질.' },
  { id: 'Na2SO4_aq', formula: 'Na2SO4', name: '황산나트륨 수용액', phase: 'aq', cls: 'compound', str: 'ionic', ions: [{ formula: 'Na+', charge: 1, count: 2 }, { formula: 'SO4 2-', charge: -2, count: 1 }], blurb: '파란 앙금(수산화구리)을 거르고 남은 용액.' },
  { id: 'FeSO4_aq', formula: 'FeSO4', name: '황산철(II) 수용액', phase: 'aq', cls: 'compound', str: 'ionic', ions: [{ formula: 'Fe2+', charge: 2, count: 1 }, { formula: 'SO4 2-', charge: -2, count: 1 }], blurb: '철이 구리 이온을 밀어낸 뒤 남는 용액.' },
  { id: 'glucose_aq', formula: 'C6H12O6', name: '포도당 수용액', phase: 'aq', cls: 'compound', str: 'molecular', blurb: '발효 원료. 효모가 에탄올과 이산화탄소로 바꾼다.' },
  { id: 'ethanol_aq', formula: 'C2H5OH', name: '발효액(에탄올 수용액)', phase: 'aq', cls: 'compound', str: 'molecular', blurb: '발효 직후의 묽은 에탄올. 정제하기를 해야 에탄올만 얻는다.' },
  // 고체
  { id: 'Mg_s', formula: 'Mg', name: '마그네슘', phase: 's', cls: 'element', str: 'metallic', blurb: '가벼운 금속. 태우면 밝은 빛을 내며 산화마그네슘이 된다.' },
  { id: 'MgO_s', formula: 'MgO', name: '산화마그네슘', phase: 's', cls: 'compound', str: 'ionic', ions: [{ formula: 'Mg2+', charge: 2, count: 1 }, { formula: 'O2-', charge: -2, count: 1 }], blurb: '열에 강한 흰 가루. 세라믹 타일 재료.' },
  { id: 'NaHCO3_s', formula: 'NaHCO3', name: '탄산수소나트륨', phase: 's', cls: 'compound', str: 'ionic', ions: [{ formula: 'Na+', charge: 1, count: 1 }, { formula: 'HCO3-', charge: -1, count: 1 }], blurb: '베이킹소다. 가열하면 탄산나트륨·이산화탄소·물로 분해.', soluble: true },
  { id: 'Na2CO3_s', formula: 'Na2CO3', name: '탄산나트륨', phase: 's', cls: 'compound', str: 'ionic', ions: [{ formula: 'Na+', charge: 1, count: 2 }, { formula: 'CO3 2-', charge: -2, count: 1 }], blurb: '세탁 소다. 염화칼슘 수용액과 섞으면 탄산칼슘 앙금이 생긴다.', soluble: true },
  { id: 'CaCl2_s', formula: 'CaCl2', name: '염화칼슘', phase: 's', cls: 'compound', str: 'ionic', ions: [{ formula: 'Ca2+', charge: 2, count: 1 }, { formula: 'Cl-', charge: -1, count: 2 }], blurb: '제습제·제설제. 물에 잘 녹는다.', soluble: true },
  { id: 'CaO_s', formula: 'CaO', name: '산화칼슘', phase: 's', cls: 'compound', str: 'ionic', ions: [{ formula: 'Ca2+', charge: 2, count: 1 }, { formula: 'O2-', charge: -2, count: 1 }], blurb: '생석회. 물과 만나면 열을 내며 수산화칼슘이 된다.' },
  { id: 'CaOH2_s', formula: 'Ca(OH)2', name: '수산화칼슘', phase: 's', cls: 'compound', str: 'ionic', ions: [{ formula: 'Ca2+', charge: 2, count: 1 }, { formula: 'OH-', charge: -1, count: 2 }], blurb: '소석회. 물에 녹인 것이 석회수이고, 이산화탄소와 만나면 탄산칼슘 앙금이 생긴다.' },
  { id: 'CaCO3_s', formula: 'CaCO3', name: '탄산칼슘', phase: 's', cls: 'compound', str: 'ionic', ions: [{ formula: 'Ca2+', charge: 2, count: 1 }, { formula: 'CO3 2-', charge: -2, count: 1 }], blurb: '석회석·대리석·조개껍데기의 주성분. 종이를 희고 매끈하게 만드는 데 넣는 가루.' },
  { id: 'NaCl_s', formula: 'NaCl', name: '염화나트륨(결정)', phase: 's', cls: 'compound', str: 'ionic', ions: [{ formula: 'Na+', charge: 1, count: 1 }, { formula: 'Cl-', charge: -1, count: 1 }], blurb: '소금. Na⁺와 Cl⁻가 1:1로 번갈아 쌓인 이온 결정.' },
  { id: 'Zn_s', formula: 'Zn', name: '아연', phase: 's', cls: 'element', str: 'metallic', blurb: '구리보다 반응성이 큰 금속. 구리 이온을 밀어낸다.' },
  { id: 'Cu_s', formula: 'Cu', name: '구리', phase: 's', cls: 'element', str: 'metallic', blurb: '전선·배관에 쓰는 붉은 금속.' },
  { id: 'CuO_s', formula: 'CuO', name: '산화구리(II)', phase: 's', cls: 'compound', str: 'ionic', ions: [{ formula: 'Cu2+', charge: 2, count: 1 }, { formula: 'O2-', charge: -2, count: 1 }], blurb: '검은 산화물. 유약·촉매 소재.' },
  { id: 'CuOH2_s', formula: 'Cu(OH)2', name: '수산화구리(II)', phase: 's', cls: 'compound', str: 'ionic', ions: [{ formula: 'Cu2+', charge: 2, count: 1 }, { formula: 'OH-', charge: -1, count: 2 }], blurb: '파란 앙금. 가열하면 검은 산화구리가 된다.' },
  { id: 'Fe_s', formula: 'Fe', name: '철', phase: 's', cls: 'element', str: 'metallic', blurb: '흔한 금속. 구리보다 반응성이 커서 구리 이온을 밀어낸다.' },
  { id: 'NH4Cl_s', formula: 'NH4Cl', name: '염화암모늄', phase: 's', cls: 'compound', str: 'ionic', ions: [{ formula: 'NH4+', charge: 1, count: 1 }, { formula: 'Cl-', charge: -1, count: 1 }], blurb: '건전지·납땜용 원료.' },
  // 액체 (유기)
  { id: 'ethanol_l', formula: 'C2H5OH', name: '에탄올(정제)', phase: 'l', cls: 'compound', str: 'molecular', blurb: '정제하기로 골라낸 에탄올. 소독약·연료로 쓰인다.' },
  { id: 'aceticAcid_l', formula: 'CH3COOH', name: '아세트산', phase: 'l', cls: 'compound', str: 'molecular', blurb: '식초의 산 성분. 에스터 합성의 원료.' },
  { id: 'ethylAcetate_l', formula: 'CH3COOC2H5', name: '아세트산에틸', phase: 'l', cls: 'compound', str: 'molecular', blurb: '용매·향료 원료로 쓰이는 에스터.' },
];

export const MATERIALS: Record<string, MaterialDefinition> = {};
for (const d of defs) {
  const composition = parseFormula(d.formula);
  MATERIALS[d.id] = {
    id: d.id,
    formula: d.formula,
    displayName: d.name,
    composition,
    charge: d.charge ?? 0,
    phase: d.phase,
    compositionClass: d.cls,
    structureClass: d.str,
    ions: d.ions,
    molarMass: molarMassOf(composition),
    tags: d.tags ?? [],
    blurb: d.blurb,
    soluble: d.soluble,
  };
}

export const PHASE_LABEL: Record<Phase, string> = { s: '고체', l: '액체', g: '기체', aq: '수용액' };

export function material(id: string): MaterialDefinition {
  const m = MATERIALS[id];
  if (!m) throw new Error(`물질 없음: ${id}`);
  return m;
}

export function formulaWithPhase(id: string): string {
  const m = material(id);
  return `${m.formula}(${m.phase})`;
}

/** 첨자가 적용된 화학식 (상태 포함) 예: H₂O(g) */
export function formulaText(id: string, withPhase = true): string {
  const m = MATERIALS[id];
  if (!m) return id;
  return subscriptFormula(m.formula) + (withPhase ? `(${m.phase})` : '');
}

/** 학생용 표시명: "물(수증기) H₂O" 처럼 이름을 먼저 */
export function materialLabel(id: string): string {
  const m = MATERIALS[id];
  if (!m) return id;
  return `${m.displayName} ${subscriptFormula(m.formula)}`;
}

export const nameOf = (id: string): string => MATERIALS[id]?.displayName ?? id;
