import type { EquipmentDefinition } from '../types';

export const EQUIPMENT: Record<string, EquipmentDefinition> = {
  U01: { id: 'U01', name: '추가 반응기', price: 14, effect: '반응 슬롯 +1 (최대 3)', imageId: 'equipment-reactor', modes: ['classic', 'extended', 'industrial'] },
  U02: { id: 'U02', name: '열회수 모듈', price: 10, effect: '지정 발열 반응 완료 1회당 에너지 1 회수 (라운드당 최대 2)', imageId: 'equipment-heater', modes: ['classic', 'extended', 'industrial'] },
  U03: { id: 'U03', name: '냉각 모듈', price: 8, effect: '응축 공정(P01) 에너지 1 → 0', imageId: 'equipment-cooler', modes: ['classic', 'extended', 'industrial'] },
  U04: { id: 'U04', name: '회수 필터', price: 8, effect: '고체 회수(P02) 수수료 2 → 0', imageId: 'equipment-filter', modes: ['classic', 'extended', 'industrial'] },
  U05: { id: 'U05', name: '전해 모듈', price: 12, effect: '물 전기분해(R02) 활성화', imageId: 'equipment-electrolyzer', modes: ['extended', 'industrial'], leasable: true },
  U06: { id: 'U06', name: '고압 모듈', price: 14, effect: '암모니아 합성(R20) 활성화', imageId: 'equipment-pressure', modes: ['industrial'], leasable: true },
  U07: { id: 'U07', name: '정제 모듈', price: 12, effect: '산업 정제(P04)와 고순도 계약 처리 활성화', imageId: 'equipment-purifier', modes: ['industrial'], leasable: true },
  U08: { id: 'U08', name: 'MnO2 촉매 모듈', price: 8, effect: '과산화수소 분해(R03) 시간 2 → 1 (재사용, 소모되지 않음)', imageId: 'equipment-catalyst', modes: ['classic', 'extended', 'industrial'] },
  U09: { id: 'U09', name: 'Fe 촉매 모듈', price: 8, effect: '암모니아 합성(R20) 시간 3 → 2. 전환량은 바뀌지 않음', imageId: 'equipment-catalyst', modes: ['industrial'] },
  U10: { id: 'U10', name: '산 촉매 모듈', price: 8, effect: '에스터화(R22) 시간 3 → 2. 전환량은 바뀌지 않음', imageId: 'equipment-catalyst', modes: ['industrial'] },
};

export function equipment(id: string): EquipmentDefinition {
  const e = EQUIPMENT[id];
  if (!e) throw new Error(`설비 없음: ${id}`);
  return e;
}
