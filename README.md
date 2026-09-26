# 리액션 길드 · REACTION GUILD

**배포 주소: https://react.labbitory.com** (workers.dev 주소: https://reaction-guild.sirlma.workers.dev) · 저장소: https://github.com/sirlma111216-boop/react

학급(교사 1명 + 학생 최대 40명)이 팀을 이루어 **화학 공방을 운영하는 실시간 웹 보드게임**입니다. 원료를 사고(조달), 반응 카드를 실행해(생산), 가공으로 제품을 분리하고(가공), 도시의 주문에 납품(납품)하며, 설비에 투자(설비)합니다. 최종 자산(코인 + 유료 설비 잔존가치 50%)이 가장 높은 길드가 승리합니다. 퀴즈·정답 입력·개인 성적표는 없습니다.

- 스택: TypeScript strict · React + Vite · Cloudflare Workers(Static Assets) · Durable Objects(SQLite storage, WebSocket Hibernation)
- 인증: 학생은 방 코드/QR + 닉네임(계정 없음). 교사는 아이디 `teacher` + 비밀번호(기본값 `guild2026`, `wrangler secret put TEACHER_PASSWORD` 로 변경).
- 모드: 클래식(반응 8장) · 확장(14장, 프리셋 3종) · 산업(14~16장, 검증된 시나리오 프리셋 3종). 반응 22개, 계약 14종, 설비 10종.

## 로컬 실행

```bash
npm install
npm run build          # 클라이언트를 dist/client 로 빌드 (Worker 가 정적 에셋으로 서빙)
npm run dev:worker     # http://127.0.0.1:8787 — Worker + Durable Object + 정적 에셋 (프로덕션과 같은 구조)
```

프런트엔드를 고치며 핫리로드가 필요하면 두 터미널로: `npm run dev:worker` 와 `npm run dev`(Vite, http://localhost:5173, `/api`·`/ws` 는 8787 로 프록시).

## 게임 열기 (교사)

1. 첫 화면 → **교사** 탭 → 아이디 `teacher`, 비밀번호 입력 → 로그인.
2. 닉네임·모드·프리셋·게임 길이(6/10/12라운드) 선택 → **게임 열기**. 방 코드와 QR, 입장 링크(`/?room=코드`)가 표시됩니다.
3. 학생이 들어오면 참가자 목록에서 **팀장**을 임명합니다. 팀장이 팀(이름·색·문양)을 만들고 시작 묶음을 고르면 학생들이 팀에 참가합니다.
4. 교사는 관전만 하거나 **교사가 팀으로 참가**로 한 팀의 팀장이 되어 함께 플레이할 수 있습니다.
5. 팀장이 **준비 완료** → 교사가 **게임 시작**. 경기 중 교사 화면에는 팀별 준비·접속·남은 행동이 보이고, 잠시 멈춤·이번 라운드 건너뛰기·차례 넘기기·조기 종료를 쓸 수 있습니다. 교사 창이 닫혀도 게임은 서버에서 계속됩니다(로그인 후 "최근 방"에서 복귀).

## 기본 조작 (학생)

- **제한시간이 없습니다.** 차례인 사람이 네 장소(📋 의뢰소 · ⚗️ 공방 · 🧺 상점 · 📦 출하장)를 오가며 행동 3번을 쓰고 **준비 완료**를 누르면, 모든 팀이 준비됐을 때 서버가 라운드를 마무리합니다(완성품 도착·시세 변화·차례 교대). 차례가 아니면 👍 추천으로 돕습니다.
- 공방에서 빈 작업 자리를 누르면 만들기 카드가 나옵니다(집중 의뢰 관련·지금 가능한 카드 먼저). 카드의 "왜 이만큼 필요할까?"에서 원자 수·질량·기체 부피비를 봅니다.
- 공방 트레이의 완성품을 눌러 **정리하기**(응축하기·거르기·결정 만들기·정제하기, 즉시). 섞여 나온 것은 정리해야 배달할 수 있고, 상점에서 산 재료는 그대로 배달할 수 없습니다.
- 의뢰소에서 주문을 **받기**(행동 소모 없음), 출하장에서 **지금 배달** 또는 **보관하고 다음 라운드에 보기**. 수령액 = 기본금 ± 카테고리 시세(최대 ±8%, 라운드마다 변동). 3·6라운드에는 도시 특별 주문에 0~6코인 비공개 입찰.
- 휴대전화에서는 하단 4개 버튼으로 장소를 옮깁니다. HUD 아래 💡 안내가 집중 의뢰와 지금 할 일을 알려줍니다. 개정 상세: [docs/UX_REVISION_V2.md](docs/UX_REVISION_V2.md)
- **연습** 탭에서 서버 없이 AI 공방과 6라운드 연습. 시간이 저절로 흐르지 않고 "다음 ▶" 버튼으로 진행합니다.

## 검증·시뮬레이션

```bash
npm run typecheck && npm run lint && npm run test   # 타입·린트·단위/통합 테스트(vitest)
npm run verify:chemistry                            # 원소·전하·질량·기체 조건·촉매·분리 원장·도달 가능성 검사
npm run sim:smoke                                   # 100경기 세 모드 완주 점검
npm run sim:balance                                 # 학습 시드 2,000경기 기준선 + 후보 탐색(최대 10회)
npm run sim:validate                                # 검증 시드 2,000경기로 현재 economy.ts 검증 → reports/balance/
npm run sim:replay -- reports/balance/runs/x.json   # 경기 재현
node scripts/e2e-ws.mjs http://127.0.0.1:8787 30 1  # 실서버 통합 테스트(교사·학생 30명·팀 구성·명령·재접속·완주)
```

밸런스 결과는 [reports/balance/BALANCE_REPORT.md](reports/balance/BALANCE_REPORT.md), 설계 결정은 [docs/DECISIONS.md](docs/DECISIONS.md), 과학 데이터 출처는 [docs/CHEMISTRY.md](docs/CHEMISTRY.md), 배포는 [docs/DEPLOY_CLOUDFLARE.md](docs/DEPLOY_CLOUDFLARE.md), 알려진 한계는 [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) 를 보세요.

## 구조

```
src/shared/chemistry   물질 39·반응 22·공정 4·설비 10·계약 14·모드/프리셋 (변경 금지 영역: 화학식·계수·보존)
src/shared/config      economy.ts — 밸런스 조정 대상 (가격·보상·시작 묶음·설비 가격…)
src/shared/engine      순수 상태 전이 엔진: 명령 검증·정산·입찰·이벤트·원장 검증 (서버·시뮬레이터·연습 모드 공용)
src/shared/protocol.ts, projection.ts   클라이언트-서버 메시지와 역할별 투영
src/worker             Cloudflare Worker + RoomDurableObject(방) + DirectoryDurableObject(교사 방 목록)
src/client             React 앱 (타이틀/교사/대기실/게임 보드/교사 관전/결과/연습/도감)
src/sim                정책 봇 6종·헤드리스 러너·지표·밸런스 CLI
public/assets          이미지 WebP 19장 + manifest.json (오디오는 미제작, 무음 fallback)
scripts                build-assets.mjs(원본→WebP), verify-chemistry.ts, e2e-ws.mjs
tests                  vitest (화학·엔진·경제·헤드리스 경기)
```

## 미디어 교체

원본 PNG 를 `assets-source/images/<id>.png` 에 두고 `npm run assets:build` 를 실행하면 `public/assets/images/<id>.webp` 와 `index.json` 이 갱신됩니다. 오디오는 `public/assets/audio/<id>.mp3`(+`.opus`)를 넣고 `public/assets/manifest.json` 의 해당 항목 `status` 를 `"ok"` 로 바꾸면 앱 코드 수정 없이 재생됩니다. 파일이 없으면 코드 대체/무음으로 동작합니다.

## 확장

새 콘텐츠 팩은 `src/shared/chemistry` 에 물질·반응·계약을 추가하고 `modes.ts` 에 프리셋을 등록한 뒤 `npm run verify:chemistry` 를 통과시키면 됩니다. UI·서버 코드는 데이터에서 자동으로 카드·도감·상점을 구성합니다. 진행 중인 방은 시작 시점의 규칙(엔진 버전·경제 버전·과학 데이터 버전·시드)을 기록하며 hot reload 로 바꾸지 않습니다.
