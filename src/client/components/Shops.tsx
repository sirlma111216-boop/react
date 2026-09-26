import { useMemo, useState } from 'react';
import type { GameView } from '../../shared/protocol';
import type { TeamState } from '../../shared/types';
import { MATERIALS } from '../../shared/chemistry/materials';
import { EQUIPMENT } from '../../shared/chemistry/equipment';
import { REACTIONS } from '../../shared/chemistry/reactions';
import { Modal, Mat, CoinIcon, EnergyIcon, AssetImage } from './common';

/** 재료 가게: 한 번에 최대 3종류·모두 6개, 한 종류는 라운드당 4개 */
export function ShopModal({ game, team, canAct, onBuy, onBuyEnergy, onClose }: { game: GameView; team: TeamState; canAct: boolean; onBuy: (items: { materialId: string; units: number }[]) => void; onBuyEnergy: (bundles: number) => void; onClose: () => void }) {
  const [cart, setCart] = useState<Record<string, number>>({});
  const cfg = game.config;
  const items = Object.entries(cart).filter(([, u]) => u > 0).map(([materialId, units]) => ({ materialId, units }));
  const total = items.reduce((a, i) => a + i.units, 0);
  const cost = items.reduce((a, i) => a + (game.prices[i.materialId] ?? 0) * i.units, 0);
  const avail = team.coins - team.bid;
  const usedIn = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const rid of game.activeReactions) for (const s of REACTIONS[rid]!.reactants) for (const m of s.accepts) (map[m] ??= []).push(REACTIONS[rid]!.name);
    return map;
  }, [game.activeReactions]);
  const change = (m: string, d: number) => {
    setCart((c) => {
      const cur = c[m] ?? 0;
      const roomKind = cfg.procureMaxPerKindPerRound - (team.purchasesThisRound[m] ?? 0);
      const kinds = Object.entries(c).filter(([k, u]) => u > 0 && k !== m).length;
      let next = Math.max(0, Math.min(cur + d, roomKind));
      if (d > 0 && cur === 0 && kinds >= cfg.procureMaxKinds) next = 0;
      if (d > 0 && total + d > cfg.procureMaxTotal) next = cur;
      return { ...c, [m]: next };
    });
  };
  const bundleCost = cfg.energyBundleCost;
  return (
    <Modal title="재료 가게" onClose={onClose}>
      <p className="muted small">한 번 사러 갈 때(행동 1) 최대 {cfg.procureMaxKinds}종류, 모두 {cfg.procureMaxTotal}개까지. 한 종류는 라운드당 {cfg.procureMaxPerKindPerRound}개까지예요. 모든 팀에 같은 양이 준비되어 있어서 먼저 산다고 없어지지 않아요.</p>
      <div className="shop-list" style={{ marginTop: 8, maxHeight: '50vh', overflow: 'auto' }}>
        {game.shopMaterials.map((m) => {
          const def = MATERIALS[m]!;
          const price = game.prices[m] ?? 0;
          const roomKind = cfg.procureMaxPerKindPerRound - (team.purchasesThisRound[m] ?? 0);
          return (
            <div key={m} className="shop-row">
              <div>
                <div><Mat id={m} /> <span className="tag tag-copper"><CoinIcon size={12} /> {price}/개</span>{roomKind < cfg.procureMaxPerKindPerRound && <span className="muted small"> 이번 라운드 {roomKind}개 더 살 수 있음</span>}</div>
                <div className="muted small">{def.blurb} {usedIn[m]?.length ? `· 쓰이는 곳: ${[...new Set(usedIn[m])].slice(0, 3).join(', ')}` : ''}</div>
              </div>
              <div className="stepper"><button onClick={() => change(m, -1)} aria-label={`${def.displayName} 빼기`}>−</button><span>{cart[m] ?? 0}</span><button onClick={() => change(m, 1)} aria-label={`${def.displayName} 더하기`} disabled={roomKind <= 0}>+</button></div>
            </div>
          );
        })}
      </div>
      <div className="divider" />
      <div className="row-between">
        <div><b>합계</b> {total}개 · <span className="reward"><CoinIcon size={14} /> {cost}</span> / 쓸 수 있는 코인 {avail}</div>
        <button className="btn btn-primary" disabled={!canAct || items.length === 0 || cost > avail || team.actionsLeft <= 0} onClick={() => onBuy(items)}>사기 (행동 1)</button>
      </div>
      <div className="divider" />
      <div className="row-between">
        <div><b>에너지 충전</b> <span className="muted small">{bundleCost}코인 → 에너지 {cfg.energyBundleAmount} (한 번에 {cfg.energyBundleMax}묶음까지, 행동 1)</span><div className="muted small">지금 <EnergyIcon size={12} /> {team.energy}/{cfg.energyCap}</div></div>
        <div className="row">{[1, 2].slice(0, cfg.energyBundleMax).map((n) => <button key={n} className="btn btn-ghost" disabled={!canAct || team.actionsLeft <= 0 || avail < n * bundleCost || team.energy >= cfg.energyCap} onClick={() => onBuyEnergy(n)}>{n}묶음 ({n * bundleCost}코인)</button>)}</div>
      </div>
    </Modal>
  );
}

function EquipmentFallback({ id }: { id: string }) {
  const color = id.startsWith('equipment-catalyst') ? '#B87346' : '#1F6F78';
  return <svg className="eq-img" viewBox="0 0 64 64" aria-hidden><rect x="14" y="16" width="36" height="36" rx="8" fill={color} /><circle cx="32" cy="34" r="9" fill="#F5F0E6" /><rect x="26" y="8" width="12" height="10" rx="3" fill="#B87346" /></svg>;
}

export function EquipmentModal({ game, team, canAct, onBuy, onClose }: { game: GameView; team: TeamState; canAct: boolean; onBuy: (id: string) => void; onClose: () => void }) {
  const avail = team.coins - team.bid;
  return (
    <Modal title="장비 가게" onClose={onClose}>
      <p className="muted small">사면 바로 효과가 납니다. 게임이 끝날 때 산 값의 절반을 돌려받아요(무료로 빌린 장비는 0).</p>
      <div className="stack" style={{ marginTop: 8 }}>
        {game.activeEquipment.map((id) => {
          const e = EQUIPMENT[id]!;
          const price = game.prices[`__eq_${id}`] ?? e.price;
          const owned = team.equipment.find((x) => x.id === id);
          return (
            <div key={id} className="card" style={{ padding: 10, display: 'grid', gridTemplateColumns: '64px 1fr auto', gap: 10, alignItems: 'center' }}>
              <AssetImage id={e.imageId} alt={e.name} className="eq-img" fallback={<EquipmentFallback id={e.imageId} />} />
              <div><b>{e.name}</b><div className="small">{e.effect}</div></div>
              <div className="stack" style={{ alignItems: 'flex-end' }}>
                {owned ? <span className="tag tag-teal">{owned.leased ? '빌려 쓰는 중' : '있음'}</span> : <>
                  <span className="reward"><CoinIcon size={14} /> {price}</span>
                  <button className="btn btn-sm btn-primary" disabled={!canAct || team.actionsLeft <= 0 || avail < price} onClick={() => onBuy(id)}>사기 (행동 1)</button>
                </>}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
