/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from 'cloudflare:workers';

export interface RoomSummary {
  code: string;
  createdAt: number;
  mode: string;
  presetId: string;
  rounds: number;
  status: string;
  teacherNick: string;
}

const MAX_AGE = 48 * 60 * 60 * 1000;

/** 교사용 방 목록. 방 자체의 권위는 각 Room DO 에 있다. */
export class DirectoryDurableObject extends DurableObject {
  private list: RoomSummary[] | null = null;

  private async load(): Promise<RoomSummary[]> {
    if (!this.list) this.list = (await this.ctx.storage.get<RoomSummary[]>('rooms')) ?? [];
    return this.list;
  }
  private async save(): Promise<void> {
    await this.ctx.storage.put('rooms', this.list ?? []);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const list = await this.load();
    const now = Date.now();
    const fresh = list.filter((r) => now - r.createdAt < MAX_AGE);
    if (fresh.length !== list.length) { this.list = fresh; await this.save(); }
    if (url.pathname === '/register' && request.method === 'POST') {
      const body = (await request.json()) as RoomSummary;
      this.list = [body, ...fresh.filter((r) => r.code !== body.code)].slice(0, 200);
      await this.save();
      return Response.json({ ok: true });
    }
    if (url.pathname === '/status' && request.method === 'POST') {
      const body = (await request.json()) as { code: string; status: string };
      const r = fresh.find((x) => x.code === body.code);
      if (r) { r.status = body.status; await this.save(); }
      return Response.json({ ok: true });
    }
    if (url.pathname === '/list') return Response.json({ rooms: fresh });
    return new Response('not found', { status: 404 });
  }
}
