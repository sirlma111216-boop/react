# Cloudflare 배포

현재 운영 배포: **https://reaction-guild.sirlma.workers.dev** (계정 Sirlma@naver.com, Worker `reaction-guild`, 2026-09-25 `wrangler deploy` 로 배포·검증)

이 앱은 **Cloudflare Workers 하나**로 정적 프런트엔드(Static Assets)와 실시간 서버(Durable Objects)를 함께 배포합니다. 외부 DB·회원가입·Firebase 는 없습니다.

## 구성 (`wrangler.jsonc`)

| 항목 | 값 |
|---|---|
| Worker 이름 | `reaction-guild` (staging: `reaction-guild-staging`) |
| 정적 에셋 | `dist/client` → `ASSETS` 바인딩, SPA fallback, `/api/*`·`/ws` 는 Worker 우선 |
| Durable Objects | `ROOM` → `RoomDurableObject`(학급 방 1개 = 객체 1개), `DIRECTORY` → `DirectoryDurableObject`(교사 방 목록) |
| 마이그레이션 | `v1: new_sqlite_classes` — SQLite-backed storage (무료 요금제 가능) |
| 변수 | `TEACHER_ID`, `TEACHER_PASSWORD`(기본 `guild2026`), `ENVIRONMENT` |
| 호환성 | `compatibility_date 2025-09-20`, `nodejs_compat` |

## 방법 A — 직접 배포 (wrangler)

```bash
npx wrangler login              # 최초 1회 (브라우저 OAuth)
npm run deploy                  # = vite build + wrangler deploy
npm run deploy:staging          # 별도 이름·별도 DO namespace (production 방과 데이터가 섞이지 않음)
```

교사 비밀번호를 바꾸려면:

```bash
npx wrangler secret put TEACHER_PASSWORD
```

같은 이름의 `vars` 가 `wrangler.jsonc` 에 있으면 배포 시 var 값이 우선하므로, secret 을 쓸 때는 `vars.TEACHER_PASSWORD` 줄을 지우세요.

## 방법 B — GitHub 연동 (Workers Builds)

1. Cloudflare 대시보드 → Workers & Pages → `reaction-guild` → Settings → **Builds** → GitHub 저장소 `sirlma111216-boop/react` 연결.
2. Build command `npm run build`, Deploy command `npx wrangler deploy`, root `/`.
3. main 브랜치 push 마다 빌드·배포됩니다. PR 은 preview 로 빌드되지만 **Durable Object 가 포함된 Worker 의 preview 는 production namespace 와 분리되지 않으므로** 실시간 방 검증은 staging 배포(`--env staging`)로 하세요. (지원 범위는 https://developers.cloudflare.com/workers/ci-cd/builds/ 에서 재확인)

## 방법 C — GitHub Actions

`.github/workflows/ci.yml` 은 push/PR 마다 타입·린트·테스트·화학 검증·짧은 시뮬레이션·빌드·`wrangler deploy --dry-run` 을 실행하고, main push 이면 `CLOUDFLARE_API_TOKEN`·`CLOUDFLARE_ACCOUNT_ID` Secrets 가 있을 때만 배포합니다. 토큰 권한: Workers Scripts:Edit, Durable Objects:Edit(Account 범위). 방법 B 와 함께 쓰면 중복 배포이므로 하나만 켜세요.

## 확인

- `https://<worker>.workers.dev/api/health` → `{"ok":true,...}`
- 다른 브라우저 두 개로 교사·학생 접속, 새로고침 후 재접속 복구 확인
- `node scripts/e2e-ws.mjs https://<worker>.workers.dev 12 0` (production 은 빠른 타이머를 허용하지 않으므로 마지막 인자 0)

## 비용·한도

- Workers 무료 요금제: 요청 10만/일, Durable Objects(SQLite) 무료 한도 포함. 학급 1개 경기 = 방 객체 1개, 접속 40개, 명령 수백 건 수준.
- 대시보드 → Workers & Pages → 해당 Worker → **Metrics** 에서 요청·DO 사용량·오류를 봅니다.

## 데이터 보존과 복구·롤백

- 방 데이터는 Durable Object storage 에만 있습니다. 대기실 비활성 2시간, 종료 후 24시간, 생성 후 최대 48시간 뒤 자동 삭제(알람). 결과는 종료 화면에서 JSON/CSV 로 내려받습니다.
- 롤백: `npx wrangler rollback` (대시보드 Deployments 에서도 가능). 스키마가 바뀐 배포 뒤 진행 중 방이 있으면 `docs/KNOWN_LIMITATIONS.md` 의 마이그레이션 원칙을 따르세요.
- 학생이 기기를 바꾸면 교사 화면(로그인) → `/api/rooms/<code>/recover` 흐름(대기실·보드의 "조작권 넘기기"와 별개)으로 토큰을 재발급할 수 있습니다. 현재 UI 에서는 교사가 "내보내기 → 다시 입장"으로 처리하는 것이 가장 간단합니다.
