import type { EquipmentDefinition } from '../types';

export const EQUIPMENT: Record<string, EquipmentDefinition> = {
  U01: { id: 'U01', name: '추가 반응기', price: 14, effect: '작업 자리 +1 (최대 3개) — 동시에 더 많이 만들 수 있어요', imageId: 'equipment-reactor', modes: ['classic', 'extended', 'industrial'] },
  U02: { id: 'U02', name: '열회수 모듈', price: 10, effect: '열이 나는 반응이 완성될 때마다 에너지 1 회수 (라운드당 최대 2)', imageId: 'equipment-heater', modes: ['classic', 'extended', 'industrial'] },
  U03: { id: 'U03', name: '냉각 모듈', price: 8, effect: '응축하기에 드는 에너지 1 → 0', imageId: 'equipment-cooler', modes: ['classic', 'extended', 'industrial'] },
  U04: { id: 'U04', name: '회수 필터', price: 8, effect: '거르기 수수료 2코인 → 0', imageId: 'equipment-filter', modes: ['classic', 'extended', 'industrial'] },
  U05: { id: 'U05', name: '전해 모듈', price: 12, effect: '물 전기분해 카드를 쓸 수 있게 됨', imageId: 'equipment-electrolyzer', modes: ['extended', 'industrial'], leasable: true },
  U06: { id: 'U06', name: '고압 모듈', price: 14, effect: '암모니아 합성 카드를 쓸 수 있게 됨', imageId: 'equipment-pressure', modes: ['industrial'], leasable: true },
  U07: { id: 'U07', name: '정제 모듈', price: 12, effect: '정제하기를 쓸 수 있게 됨 (암모니아·에탄올·에스터 주문에 필요)', imageId: 'equipment-purifier', modes: ['industrial'], leasable: true },
  U08: { id: 'U08', name: 'MnO2 촉매 모듈', price: 8, effect: '과산화수소 분해가 2라운드 → 1라운드 (닳지 않고 계속 씀)', imageId: 'equipment-catalyst', modes: ['classic', 'extended', 'industrial'] },
  U09: { id: 'U09', name: 'Fe 촉매 모듈', price: 8, effect: '암모니아 합성이 3라운드 → 2라운드 (만들어지는 양은 그대로)', imageId: 'equipment-catalyst', modes: ['industrial'] },
  U10: { id: 'U10', name: '산 촉매 모듈', price: 8, effect: '에스터 만들기가 3라운드 → 2라운드 (만들어지는 양은 그대로)', imageId: 'equipment-catalyst', modes: ['industrial'] },
};

export function equipment(id: string): EquipmentDefinition {
  const e = EQUIPMENT[id];
  if (!e) throw new Error(`설비 없음: ${id}`);
  return e;
}
