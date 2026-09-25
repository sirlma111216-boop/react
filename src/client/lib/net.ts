import type { ClientEnvelope, ClientView, RoomCommand, ServerMessage } from '../../shared/protocol';
import { store } from './store';
import { audio } from './audio';

/** 게임 보드가 사용하는 클라이언트 추상화. 서버(WebSocket)와 연습 모드(로컬)가 같은 인터페이스를 구현한다. */
export interface GameClient {
  send(cmd: RoomCommand): Promise<{ ok: boolean; error?: string }>;
  close(): void;
  readonly kind: 'ws' | 'local';
}

let cmdSeq = 0;
function nextCommandId(): string {
  cmdSeq += 1;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${cmdSeq}`;
}

export class WsClient implements GameClient {
  readonly kind = 'ws' as const;
  private ws: WebSocket | null = null;
  private pending = new Map<string, { resolve: (r: { ok: boolean; error?: string }) => void; envelope: ClientEnvelope; sentAt: number }>();
  private closedByUser = false;
  private retry = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastPhaseKey = '';

  constructor(private code: string, private token: string) {
    this.connect();
  }

  private url(): string {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws?room=${encodeURIComponent(this.code)}&token=${encodeURIComponent(this.token)}`;
  }

  private connect(): void {
    if (this.closedByUser) return;
    store.setConnection(this.retry === 0 ? 'connecting' : 'reconnecting');
    const ws = new WebSocket(this.url());
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      store.setConnection('open');
      // 재연결 시 미응답 명령 재전송 (같은 commandId → 서버가 중복 처리하지 않음)
      for (const p of this.pending.values()) ws.send(JSON.stringify(p.envelope));
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' })); }, 25_000);
    };
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try { msg = JSON.parse(String(ev.data)) as ServerMessage; } catch { return; }
      if (msg.type === 'view') this.onView(msg.view);
      else if (msg.type === 'ack') {
        const p = this.pending.get(msg.id);
        if (p) { this.pending.delete(msg.id); p.resolve({ ok: msg.ok, error: msg.error }); store.setPending(this.pending.size); }
      } else if (msg.type === 'toast') { store.toast(msg.text, msg.level); if (msg.level === 'success') audio.sfx('sfx-turn'); }
      else if (msg.type === 'closed') { this.closedByUser = true; store.setConnection('closed', msg.reason); }
    };
    ws.onclose = (ev) => {
      if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
      if (this.closedByUser) { store.setConnection('closed', store.get().closedReason ?? (ev.code === 4001 ? '다른 기기에서 다시 접속했습니다.' : null)); return; }
      if (ev.code === 4001 || ev.code === 4002 || ev.code === 4000) { this.closedByUser = true; store.setConnection('closed', ev.code === 4002 ? '교사가 내보냈습니다.' : ev.code === 4000 ? '방이 만료되었습니다.' : '세션이 갱신되었습니다. 교사에게 새 접속을 요청하세요.'); return; }
      if (ev.code === 1006 && this.retry === 0 && !store.get().view) {
        // 최초 연결 실패(토큰 불일치 등)
      }
      const delay = Math.min(8000, 500 * 2 ** this.retry++);
      store.setConnection('reconnecting');
      setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => {};
  }

  private onView(view: ClientView): void {
    const g = view.game;
    const key = g ? `${g.round}:${g.phase}` : view.room.status;
    if (key !== this.lastPhaseKey) {
      const prev = this.lastPhaseKey;
      this.lastPhaseKey = key;
      if (prev && g?.phase === 'execute') audio.sfx('sfx-turn');
      if (g?.phase === 'finished') audio.sting('sting-complete');
    }
    store.setView(view);
  }

  send(cmd: RoomCommand): Promise<{ ok: boolean; error?: string }> {
    const id = nextCommandId();
    const envelope: ClientEnvelope = { type: 'cmd', id, cmd };
    return new Promise((resolve) => {
      this.pending.set(id, { resolve, envelope, sentAt: Date.now() });
      store.setPending(this.pending.size);
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(envelope));
      setTimeout(() => {
        const p = this.pending.get(id);
        if (p) { this.pending.delete(id); store.setPending(this.pending.size); resolve({ ok: false, error: '서버 응답이 없습니다. 연결을 확인하세요.' }); }
      }, 12_000);
    });
  }

  close(): void {
    this.closedByUser = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    try { this.ws?.close(1000, 'bye'); } catch {}
    store.setConnection('closed');
  }
}

export async function api<T>(path: string, init: RequestInit & { teacherKey?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.teacherKey) headers['x-teacher-key'] = init.teacherKey;
  const res = await fetch(path, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `요청 실패 (${res.status})`);
  return data;
}
