import { useEffect, useState } from 'react';
import type { ClientView } from '../../shared/protocol';
import type { SupportBundle, SupportGrant, TeamCommand } from '../../shared/types';
import { MATERIALS } from '../../shared/chemistry/materials';
import { lotTagText } from '../../shared/engine/commands';
import { SUPPORT_KIND_LABEL } from '../../shared/engine/support';
import { MaterialArt, ObjectArt } from './Art';
import { Modal } from './common';

type Send = (cmd: TeamCommand, sfx?: string) => Promise<boolean>;

const KIND_HINT: Record<string, string> = {
  finished: '검수된 완성 소재 1개 — 조건이 맞는 의뢰에 바로 보탤 수 있어요',
  process: '중간물·연결 재료 3~4개 — 몇 단계를 건너뛰게 해 줘요',
  basic: '기초 원료 8~10개 — 여러 번 만들 수 있어요',
};

function BundleItems({ b, size = 44 }: { b: SupportBundle; size?: number }) {
  return (
    <ul className="sp-items">
      {b.items.map((it) => (
        <li key={it.materialId}>
          <MaterialArt materialId={it.materialId} size={size} />
          <span className="sp-item-text">
            <b>{MATERIALS[it.materialId]?.displayName ?? it.materialId}</b> <span className="sp-qty">×{it.units}</span>
            {it.tags.length > 0 && <span className="sp-tag">검수 완료 · {lotTagText({ grade: 'support', tags: it.tags })} · 조건 맞는 의뢰에 바로 보탬</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** 공방의 큰 배송 트레이. 다른 장소에 있는 학생 화면을 강제로 바꾸지 않고, 탭 배지와 이 트레이로 알린다. */
export function SupportTray({ view, onOpen }: { view: ClientView; onOpen: () => void }) {
  const t = view.game!.myTeam!;
  const g = t.support;
  if (!g || g.round !== view.game!.round) return null;
  if (g.status === 'pending') {
    return (
      <section className="sp-tray pending" aria-label="연구지원품 배송 트레이">
        <div className="sp-boxes" aria-hidden>
          {g.bundles.map((b, i) => <span key={i} className="sp-box"><ObjectArt id="obj-support-closed" size={64} variant="s" /><span className="sp-box-label">{SUPPORT_KIND_LABEL[b.kind].replace(' 상자', '')}</span></span>)}
        </div>
        <div className="sp-tray-text">
          <b>길드 연구지원품이 도착했어요</b>
          <span className="small">세 묶음 중 <b>1묶음을 반송</b>하고 나머지 <b>2묶음</b>을 받아요. 고르기 전에는 사기·만들기·준비 완료가 잠겨요. 행동력·코인은 들지 않아요.</span>
        </div>
        <button className="btn btn-copper btn-lg" onClick={onOpen}>지원품 확인</button>
      </section>
    );
  }
  const kept = g.bundles.filter((_, i) => i !== g.returnedIndex);
  return (
    <section className="sp-tray done" aria-label="이번 라운드 연구지원품">
      <ObjectArt id="obj-support-open" size={40} variant="s" />
      <span className="small">
        {g.status === 'received'
          ? <>이번 라운드 지원품을 받았어요{g.resolvedBy === 'teacher' ? ' (선생님이 대신 고름)' : ''}: {kept.flatMap((b) => b.items).map((i) => `${MATERIALS[i.materialId]?.displayName} ${i.units}`).join(', ')} · 반송: {SUPPORT_KIND_LABEL[g.bundles[g.returnedIndex ?? 0]!.kind]}</>
          : <>이번 라운드 연구지원품은 수령을 포기했어요.</>}
      </span>
    </section>
  );
}

/**
 * 지원품 선택 창: 3묶음 전체를 동시에 보여 주고, 반송할 1묶음을 고른 뒤 확정한다.
 * 확정은 이번 차례 담당자만. 팀원은 '이 상자 반송 제안' 핑을 보낼 수 있다. 확정 후 재추첨·되돌리기 없음.
 */
export function SupportModal({ view, send, onClose }: { view: ClientView; send: Send; onClose: () => void }) {
  const t = view.game!.myTeam!;
  const g: SupportGrant | null | undefined = t.support;
  const [opening, setOpening] = useState(true);
  const [ret, setRet] = useState<number | null>(null);
  useEffect(() => { const h = setTimeout(() => setOpening(false), 700); return () => clearTimeout(h); }, []);
  if (!g || g.round !== view.game!.round) return null;
  const isOp = view.me.isOperator;
  const opNick = view.players.find((p) => p.id === t.operatorId)?.nick ?? '담당자';
  const pending = g.status === 'pending';
  const pins = (i: number) => t.pins.filter((p) => p.target === `support:${g.grantId}:${i}`).length;
  const confirm = async () => {
    if (ret === null) return;
    if (await send({ type: 'chooseSupport', grantId: g.grantId, returnIndex: ret }, 'sfx-supply')) onClose();
  };
  return (
    <Modal title="길드 연구지원품 · 1묶음 반송, 2묶음 받기" onClose={onClose} wide>
      {opening ? (
        <button className="sp-opening" onClick={() => setOpening(false)} aria-label="열기 연출 건너뛰기">
          <ObjectArt id="obj-support-closed" size={120} variant="m" className="sp-open-anim" />
          <span className="small muted">배송 상자를 여는 중… (눌러서 건너뛰기)</span>
        </button>
      ) : (
        <div className="stack">
          <p className="small">세 묶음 전체를 보고 <b>반송할 1묶음</b>을 고르세요. 나머지 2묶음만 창고에 들어와요. 낱개로 골라 담을 수 없고, 확정한 뒤에는 바꿀 수 없어요. 행동력·코인은 들지 않아요.</p>
          <div className="sp-cards">
            {g.bundles.map((b, i) => {
              const isRet = (pending ? ret : g.returnedIndex) === i;
              return (
                <div key={i} className={`sp-card ${isRet ? 'ret' : ''}`}>
                  <div className="sp-card-head">
                    <ObjectArt id={isRet ? 'obj-support-return' : 'obj-support-open'} size={72} variant="s" />
                    <div>
                      <b className="sp-kind">{SUPPORT_KIND_LABEL[b.kind]}</b>
                      <div className="small muted">{KIND_HINT[b.kind]}</div>
                    </div>
                    {isRet && <span className="sp-ret-mark">반송</span>}
                  </div>
                  <BundleItems b={b} />
                  <div className="sp-card-foot">
                    <span />
                    {pending && (isOp
                      ? <button className={`btn btn-sm ${isRet ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={isRet} onClick={() => setRet(i)}>{isRet ? '반송할 상자 ✓' : '이 상자 반송'}</button>
                      : <button className="btn btn-sm btn-ghost" onClick={() => send({ type: 'pin', playerId: view.me.playerId, target: `support:${g.grantId}:${i}`, label: `"${SUPPORT_KIND_LABEL[b.kind]}" 반송 제안` }, 'sfx-ping')}>이 상자 반송 제안{pins(i) ? ` (${pins(i)})` : ''}</button>)}
                    {pending && isOp && pins(i) > 0 && <span className="tag tag-amber">반송 제안 {pins(i)}</span>}
                  </div>
                </div>
              );
            })}
          </div>
          {pending ? (
            <div className="sp-confirm">
              {ret === null ? <span className="small">반송할 상자를 하나 고르세요.</span> : (
                <span className="small">반송: <b>{SUPPORT_KIND_LABEL[g.bundles[ret]!.kind]}</b> · 받을 것: {g.bundles.filter((_, i) => i !== ret).flatMap((b) => b.items).map((it) => `${MATERIALS[it.materialId]?.displayName} ${it.units}개`).join(', ')}</span>
              )}
              {isOp ? <button className="btn btn-copper btn-lg" disabled={ret === null} onClick={confirm}>선택한 1묶음 반송 · 나머지 받기</button> : <span className="muted small">확정은 이번 차례 {opNick}만 할 수 있어요. 반송 제안을 보내 도와주세요.</span>}
            </div>
          ) : <p className="small">이번 라운드 지원품은 이미 {g.status === 'received' ? '받았어요' : '수령을 포기했어요'}.</p>}
        </div>
      )}
    </Modal>
  );
}
