import { useEffect } from 'react';
import type { ClientView } from '../../shared/protocol';
import { REACTIONS } from '../../shared/chemistry/reactions';
import { CONTRACTS } from '../../shared/chemistry/contracts';
import { Emblem } from '../components/Emblem';
import { imageUrl } from '../lib/assets';
import { audio } from '../lib/audio';

export function ResultsScreen({ view, onLeave, teacherExport }: { view: ClientView; onLeave: () => void; teacherExport?: () => void }) {
  const results = view.game?.results ?? [];
  const bg = imageUrl('bg-results');
  useEffect(() => { audio.stopBgm(); }, []);
  const myTeamId = view.me.teamId;
  const series = view.teams.map((t) => ({ name: t.name, color: t.color, data: t.assetHistory }));
  const myTeam = view.game?.myTeam;
  const download = (kind: 'json' | 'csv') => {
    const rows = results.map((r) => ({ rank: r.rank, team: r.name, asset: r.asset, coins: r.coins, salvage: r.salvage, delivered: r.delivered, revenue: r.revenue, badges: r.badges.join('|') }));
    const text = kind === 'json' ? JSON.stringify({ code: view.room.code, mode: view.room.mode, rounds: view.room.rounds, results: rows, assetHistory: series }, null, 2) : ['rank,team,asset,coins,salvage,delivered,revenue,badges', ...rows.map((r) => [r.rank, r.team, r.asset, r.coins, r.salvage, r.delivered, r.revenue, r.badges].join(','))].join('\n');
    const blob = new Blob([text], { type: kind === 'json' ? 'application/json' : 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `reaction-guild-${view.room.code}.${kind}`; a.click();
  };
  return (
    <div className="screen">
      <div className={`bg-full ${bg ? '' : 'bg-fallback-results'}`} style={bg ? { backgroundImage: `url(${bg})` } : undefined} />
      <div className="bg-content results">
        <div className="center" style={{ marginBottom: 16 }}><h1 style={{ color: 'var(--teal)', fontSize: 30 }}>오늘의 공방 문을 닫습니다</h1><p className="muted">최종 점수 = 코인 + 산 장비 값의 절반. 개인 순위는 없어요.</p></div>
        {results.map((r) => {
          const t = view.teams.find((x) => x.id === r.teamId);
          return (
            <div key={r.teamId} className={`rank-row ${r.rank === 1 ? 'first' : ''}`} style={myTeamId === r.teamId ? { outline: '2px solid var(--teal-2)' } : undefined}>
              <span className="rank-num">{r.rank}</span>
              <Emblem shape={t?.emblem ?? 'circle'} color={t?.color ?? '#888'} size={30} />
              <div><b style={{ fontSize: 16 }}>{r.name}</b><div className="muted small">배달 {r.delivered}건 · 번 코인 {r.revenue} · 가장 많이 만든 것 {r.topReaction ? REACTIONS[r.topReaction]?.name ?? r.topReaction : '-'}{r.badges.length ? ` · ${r.badges.join(', ')}` : ''}</div></div>
              <div className="center"><div className="muted small">코인 {r.coins} + 장비 {r.salvage}</div></div>
              <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--copper)', fontFamily: 'var(--mono)' }}>{r.asset}</div>
            </div>
          );
        })}
        <AssetChart series={series} />
        {myTeam && myTeam.deliveredContracts.length > 0 && (
          <div className="card" style={{ marginTop: 12 }}><div className="card-title">우리 팀의 배달 기록</div><ul className="small" style={{ margin: 0, paddingLeft: 16 }}>{myTeam.deliveredContracts.map((d, i) => <li key={i}>R{d.round} {CONTRACTS[d.templateId]?.title ?? d.templateId} +{d.reward}{d.special ? ' (특별 주문)' : ''}</li>)}</ul></div>
        )}
        <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={() => download('json')}>JSON 내려받기</button>
          <button className="btn btn-ghost" onClick={() => download('csv')}>CSV 내려받기</button>
          {teacherExport && <button className="btn btn-ghost" onClick={teacherExport}>전체 기록(교사)</button>}
          <button className="btn btn-primary" onClick={onLeave}>처음으로</button>
        </div>
        <p className="muted small center" style={{ marginTop: 10 }}>이 방의 결과는 종료 후 24시간(생성 후 최대 48시간) 보존된 뒤 삭제됩니다. 필요하면 지금 내려받으세요.</p>
      </div>
    </div>
  );
}

function AssetChart({ series }: { series: { name: string; color: string; data: number[] }[] }) {
  const w = 640, h = 220, pad = 30;
  const maxLen = Math.max(1, ...series.map((s) => s.data.length));
  const maxV = Math.max(10, ...series.flatMap((s) => s.data));
  const x = (i: number) => pad + (i / Math.max(1, maxLen - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - (v / maxV) * (h - pad * 2);
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="팀별 코인 변화" style={{ marginTop: 12 }}>
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#c9c1b0" />
      <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="#c9c1b0" />
      {[0, 0.5, 1].map((f) => <text key={f} x={pad - 4} y={y(maxV * f) + 4} fontSize="10" textAnchor="end" fill="#7d8889">{Math.round(maxV * f)}</text>)}
      {Array.from({ length: maxLen }, (_, i) => <text key={i} x={x(i)} y={h - pad + 12} fontSize="10" textAnchor="middle" fill="#7d8889">R{i + 1}</text>)}
      {series.map((s) => <polyline key={s.name} points={s.data.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" />)}
      {series.map((s, k) => <g key={s.name}><rect x={pad + k * 100} y={6} width="10" height="10" fill={s.color} /><text x={pad + k * 100 + 14} y={15} fontSize="11" fill="#1f2a2b">{s.name}</text></g>)}
    </svg>
  );
}
