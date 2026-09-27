import { useEffect, useState } from 'react';
import { ART_ASSETS, MATERIAL_ART } from '../../shared/assets/objectArt';
import { MATERIALS, PHASE_LABEL } from '../../shared/chemistry/materials';
import { MaterialArt, MixtureArt, ObjectArt } from '../components/Art';
import { Formula, Wordmark } from '../components/common';
import { objectStatus } from '../lib/assets';

/**
 * 에셋 검수 화면 (/asset-review). 사용자가 원본을 넣고 `npm run assets:build` 하면 코드 변경 없이 여기서 바로 확인한다.
 * 48·64·96px 식별성, 누락(임시 대체) 여부, 물질 → 그림 매핑과 상태 배지를 한 화면에서 본다.
 */
export function AssetReview({ onLeave }: { onLeave: () => void }) {
  const [, force] = useState(0);
  // 이미지 로드 실패가 기록되면 집계를 다시 그린다
  useEffect(() => { const h = setTimeout(() => force((x) => x + 1), 1500); return () => clearTimeout(h); }, []);
  const statuses = ART_ASSETS.map((a) => ({ a, st: objectStatus(a.id) }));
  const missing = statuses.filter((s) => s.st !== 'ok');
  const kinds: [string, string][] = [['material', '물질·상태 아이콘'], ['aid', '촉매·공정 보조물'], ['mixture', '혼합물 베이스'], ['object', '새 기능 오브젝트']];
  return (
    <div className="asset-review">
      <header className="row-between" style={{ marginBottom: 12 }}>
        <Wordmark compact />
        <div className="row">
          <span className={`tag ${missing.length ? 'tag-danger' : 'tag-teal'}`}>최종 그림 {statuses.length - missing.length}/{statuses.length} · 누락 {missing.length}</span>
          <button className="btn btn-sm btn-ghost" onClick={onLeave}>처음으로</button>
        </div>
      </header>
      <p className="small muted">그림은 게임용 포장·보관 오브젝트예요. 이름·화학식·수량·상태 배지는 코드가 씁니다. 누락된 그림은 점선 임시 대체로 보이며 최종 그림으로 세지 않습니다. 원본은 <code>assets-source/v3/&lt;id&gt;.png</code>, 게임 파일은 <code>public/assets/objects/v3/</code>.</p>
      {kinds.map(([k, title]) => (
        <section key={k} className="card" style={{ marginTop: 12 }}>
          <div className="card-title">{title}</div>
          <div className="ar-grid">
            {statuses.filter((s) => s.a.kind === k).map(({ a, st }) => (
              <div key={a.id} className={`ar-cell ${st !== 'ok' ? 'miss' : ''}`}>
                <div className="ar-sizes">
                  {a.id === 'obj-mission-board' ? <img src="/assets/objects/v3/obj-mission-board.webp" alt="" style={{ width: 200 }} /> : [48, 64, 96].map((px) => <ObjectArt key={px} id={a.id} size={px} variant={px <= 64 ? 's' : 'm'} />)}
                </div>
                <b className="small">{a.label}</b>
                <code className="small">{a.id}</code>
                <span className="small muted">{a.hint} · {st === 'ok' ? '최종 그림' : '누락 → 임시 대체'}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
      <section className="card" style={{ marginTop: 12 }}>
        <div className="card-title">게임 물질 {Object.keys(MATERIALS).length}종 → 그림 매핑</div>
        <table className="ar-table small">
          <thead><tr><th>그림</th><th>materialId</th><th>이름</th><th>화학식</th><th>상태</th><th>그림 ID</th><th>상태 배지</th></tr></thead>
          <tbody>
            {Object.values(MATERIALS).map((m) => (
              <tr key={m.id}><td><MaterialArt materialId={m.id} size={48} /></td><td><code>{m.id}</code></td><td>{m.displayName}</td><td><Formula id={m.id} /></td><td>{PHASE_LABEL[m.phase]}</td><td><code>{MATERIAL_ART[m.id]?.assetId ?? '없음'}</code></td><td>{MATERIAL_ART[m.id]?.badge ?? '-'}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card" style={{ marginTop: 12 }}>
        <div className="card-title">혼합물 합성 예 (베이스 + 성분 아이콘)</div>
        <div className="row">
          <MixtureArt size={96} lot={{ id: 'a', kind: 'mixture', components: [{ materialId: 'CO2_g', units: 1 }, { materialId: 'H2O_g', units: 2 }], units: 3, grade: 'produced', tags: ['gasMixture'], solvent: 0, origin: { type: 'reaction', chain: [] } }} />
          <MixtureArt size={96} lot={{ id: 'b', kind: 'mixture', components: [{ materialId: 'CaCO3_s', units: 1 }, { materialId: 'NaCl_aq', units: 2 }], units: 3, grade: 'produced', tags: ['suspension'], solvent: 2, origin: { type: 'reaction', chain: [] } }} />
          <MixtureArt size={96} lot={{ id: 'c', kind: 'mixture', components: [{ materialId: 'ethylAcetate_l', units: 1 }, { materialId: 'H2O_l', units: 1 }, { materialId: 'aceticAcid_l', units: 1 }], units: 3, grade: 'produced', tags: ['liquidMixture'], solvent: 0, origin: { type: 'reaction', chain: [] } }} />
          <MixtureArt size={96} lot={{ id: 'd', kind: 'mixture', components: [{ materialId: 'ZnSO4_aq', units: 1 }, { materialId: 'Na2SO4_aq', units: 1 }], units: 2, grade: 'produced', tags: ['filtrate'], solvent: 1, origin: { type: 'reaction', chain: [] } }} />
        </div>
      </section>
    </div>
  );
}
