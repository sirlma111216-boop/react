/// <reference types="@cloudflare/workers-types" />
import { RoomDurableObject } from './room';
import { DirectoryDurableObject } from './directory';
import { sanitizeName, NICK_MAX } from '../shared/protocol';
import { MODES } from '../shared/chemistry/modes';

export { RoomDurableObject, DirectoryDurableObject };

export interface Env {
  ROOM: DurableObjectNamespace<RoomDurableObject>;
  DIRECTORY: DurableObjectNamespace<DirectoryDurableObject>;
  ASSETS: Fetcher;
  TEACHER_ID: string;
  TEACHER_PASSWORD: string;
  ENVIRONMENT: string;
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode(len = 6): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

async function hmacHex(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** 교사 키: 비밀번호에서 파생한 HMAC. 비밀번호 자체는 클라이언트에 저장하지 않는다. */
export async function teacherKey(env: Env): Promise<string> {
  return hmacHex(env.TEACHER_PASSWORD || 'guild2026', 'reaction-guild-teacher-key-v1');
}

async function isTeacher(request: Request, env: Env): Promise<boolean> {
  const key = request.headers.get('x-teacher-key') ?? '';
  if (!key) return false;
  return timingSafeEqual(key, await teacherKey(env));
}

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });

function roomStub(env: Env, code: string) {
  return env.ROOM.get(env.ROOM.idFromName(code.toUpperCase()));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/ws') {
      const code = (url.searchParams.get('room') ?? '').toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(code)) return json({ error: '잘못된 방 코드' }, 400);
      // Origin 검증: 같은 호스트에서 열린 페이지만 허용 (개발 프록시 포함)
      const origin = request.headers.get('origin');
      if (origin) {
        const o = new URL(origin);
        const sameHost = o.host === url.host || o.hostname === 'localhost' || o.hostname === '127.0.0.1';
        if (!sameHost) return json({ error: 'origin 거부' }, 403);
      }
      return roomStub(env, code).fetch(request);
    }

    if (path.startsWith('/api/')) {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
      if (path === '/api/health') return json({ ok: true, env: env.ENVIRONMENT, now: Date.now() });

      if (path === '/api/teacher/login' && request.method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as { id?: string; password?: string };
        const idOk = timingSafeEqual(String(body.id ?? ''), env.TEACHER_ID || 'teacher');
        const pwOk = timingSafeEqual(String(body.password ?? ''), env.TEACHER_PASSWORD || 'guild2026');
        if (!idOk || !pwOk) return json({ error: '아이디 또는 비밀번호가 맞지 않습니다.' }, 401);
        return json({ ok: true, teacherKey: await teacherKey(env) });
      }

      if (path === '/api/teacher/verify' && request.method === 'GET') {
        return json({ ok: await isTeacher(request, env) });
      }

      if (path === '/api/rooms' && request.method === 'POST') {
        if (!(await isTeacher(request, env))) return json({ error: '교사 인증이 필요합니다.' }, 401);
        const body = (await request.json().catch(() => ({}))) as { nick?: string; mode?: string; presetId?: string; rounds?: number; teacherPlays?: boolean };
        const mode = (['classic', 'extended', 'industrial'] as const).find((m) => m === body.mode) ?? 'classic';
        const preset = MODES[mode].presets.find((p) => p.id === body.presetId) ?? MODES[mode].presets[0]!;
        const rounds = [6, 10, 12].includes(Number(body.rounds)) ? Number(body.rounds) : 10;
        const nick = sanitizeName(body.nick, NICK_MAX) || '선생님';
        // 충돌 없는 코드 찾기
        for (let attempt = 0; attempt < 5; attempt++) {
          const code = randomCode();
          const stub = roomStub(env, code);
          const res = await stub.fetch(new Request('https://room/init', { method: 'POST', body: JSON.stringify({ code, nick, mode, presetId: preset.id, rounds, origin: url.origin }) }));
          if (res.status === 409) continue;
          const data = (await res.json()) as Record<string, unknown>;
          await env.DIRECTORY.get(env.DIRECTORY.idFromName('main')).fetch(new Request('https://dir/register', { method: 'POST', body: JSON.stringify({ code, createdAt: Date.now(), mode, presetId: preset.id, rounds, status: 'lobby', teacherNick: nick }) }));
          return json(data);
        }
        return json({ error: '방 코드를 만들지 못했습니다. 다시 시도하세요.' }, 500);
      }

      if (path === '/api/rooms' && request.method === 'GET') {
        if (!(await isTeacher(request, env))) return json({ error: '교사 인증이 필요합니다.' }, 401);
        const res = await env.DIRECTORY.get(env.DIRECTORY.idFromName('main')).fetch(new Request('https://dir/list'));
        return json(await res.json());
      }

      const m = path.match(/^\/api\/rooms\/([A-Za-z0-9]{6})(\/[a-z]+)?$/);
      if (m) {
        const code = m[1]!.toUpperCase();
        const sub = m[2] ?? '';
        const stub = roomStub(env, code);
        if (sub === '' && request.method === 'GET') return stub.fetch(new Request('https://room/info'));
        if (sub === '/join' && request.method === 'POST') {
          const body = (await request.json().catch(() => ({}))) as { nick?: string };
          return stub.fetch(new Request('https://room/join', { method: 'POST', body: JSON.stringify({ nick: sanitizeName(body.nick, NICK_MAX), ip: request.headers.get('cf-connecting-ip') ?? '' }) }));
        }
        if (sub === '/teacher' && request.method === 'GET') {
          if (!(await isTeacher(request, env))) return json({ error: '교사 인증이 필요합니다.' }, 401);
          return stub.fetch(new Request('https://room/teacher'));
        }
        if (sub === '/recover' && request.method === 'POST') {
          if (!(await isTeacher(request, env))) return json({ error: '교사 인증이 필요합니다.' }, 401);
          const body = await request.text();
          return stub.fetch(new Request('https://room/recover', { method: 'POST', body }));
        }
        if (sub === '/export' && request.method === 'GET') {
          if (!(await isTeacher(request, env))) return json({ error: '교사 인증이 필요합니다.' }, 401);
          return stub.fetch(new Request('https://room/export'));
        }
      }
      return json({ error: 'not found' }, 404);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
