# UX 개정 V2 — 4개 장소 · 수동 라운드 · 시세

2026-09-26. 기존 대시보드형 보드를 **의뢰소 → 공방 ↔ 상점 → 출하장** 네 장소를 오가는 구조로 바꾸고, 모든 게임플레이 제한시간을 없앴다. 규칙 엔진·화학 데이터·서버 권위·재접속·팀 권한은 그대로다.

## 기존 흐름 → 새 흐름

| 기존 | 새 |
|---|---|
| 한 화면에 주문·가게·만들기·창고·팀 정보 동시 배치, 휴대전화는 4탭 | 장소 4개, 장소마다 배경·NPC·주된 조작이 다름. 상단 HUD(코인/에너지/행동)와 장소 탐색은 어디서나 같은 위치 |
| 상의 30초 → 행동 90초 → 마무리 30초 타이머 | 제한시간 없음. 라운드는 `roundOpen` 하나. 차례인 사람이 **준비 완료**를 누르고, 모든 팀이 준비되면 서버가 정산 1회 |
| 반응 카드 8~16장을 항상 펼침 | 공방에서 빈 작업 자리를 누르면 집중 의뢰 관련·지금 가능한 카드 3~5장 먼저, 전체 카드는 버튼으로 |
| 재료 상점·장비 상점 모달 두 개 | 상점 한 곳, 추천/전체/재료/장비 필터, 거래 카운터 하나 (재료는 한 조달 행동, 장비는 별도 거래) |
| 주문 카드의 납품 버튼 | 출하장에서 주문을 고르면 출하대에 상자가 올라오고 기본금+시장 가감액=수령액 분해, "지금 배달 / 보관하고 다음 라운드에 보기" |
| 계약 보상 고정 | 새 계약은 `pricingVersion: 2` = 기본금 + 카테고리 시세(±8%). 구버전 계약은 고정가 이행 |
| 💡 안내 줄(탭 기준) | 집중 의뢰 + 추천 행동 1개(장소 기준). 우선순위: 배달 가능 → 정리 필요 → 만들 수 있음 → 재료 부족 → 완성 대기 → 준비 완료 |

## 장소별 화면

- **의뢰소** (`scene-orders-v2` + `npc-scientist-v2`): 새 주문 3장(활용처 그림·필요량·기본금·시세 범위·단계 수), 지금 시작할 수 있는 주문 추천, 선택한 카드만 상세, 보유 서류철(집중 의뢰 지정, 공방/출하장 링크), 특별 주문 초대장(비공개 입찰).
- **공방** (`scene-workshop-v2`, NPC 없음): 작업대(작업 자리 = 빈 윤곽/가동 중 반응기 + "이번 마무리 때 완성"/"N회 마무리 남음", 추가 반응기 자리 → 상점 링크), 장비 선반(설치된 것만 표시), 재료 선반(집중 의뢰 재료 먼저, 용기 형태·묶음 수·정확한 개수), 완성품 트레이("정리 필요"/"출하 가능" 구분 → 정리하기 / 출하장 링크).
- **상점** (`scene-store-v2` + `npc-merchant-v2`): 상품 그리드 한 개, 추천에 부족 재료·유용 장비, 장비는 배치 미리보기 문장, "부족한 재료 담기"(자동 결제 없음), 살 수 없는 이유(코인/행동/이미 설치/차례) 근처 표시, 성공 시 "공방에 도착했어요" + 링크.
- **출하장** (`scene-shipping-v2` + `npc-receiver-v2`): 운송 서류(주문 선택), 출하대(서버와 같은 규칙으로 고른 로트 미리보기, 검수 통과/부족 한 줄), 수령액 분해와 지난 라운드 대비 화살표, 최근 4라운드 추이(선택), 지금 배달(`quoteVersion=round`)/보관, 마지막 라운드 안내.

가짜 실시간 진행 바·타이머·10초 경고음·임박 점멸은 모두 제거했다. 진행 표시는 "이번 마무리 때 완성"처럼 정산 횟수 기준이다.

## 수동 라운드 정산 순서 (서버 `RoomDurableObject.tryAdvanceRound`)

1. 팀 명령 `readyRound{on:true}`(차례인 사람) 또는 교사 `skipTeam`이 팀의 `roundReady`를 true로.
2. 참가 팀(구성원 있는 팀)이 모두 준비되고 방이 `playing`이며 `settling`이 아니면 → `settling=true`.
3. `settleAndOpenNextRound`: 입찰 개봉 → 공정 완료·열회수 → 기한 만료 → 자산 기록 → `roundVersion+1` → 마지막이면 `finishGame`(자동 배달은 그 라운드 시세) 아니면 `drawNextMarket` → 다음 라운드 열기(에너지 지급, 준비 초기화, 제안 생성, 이벤트) → 차례 배정.
4. `settling=false`, 저장, 전 클라이언트에 새 projection. 플레이어가 보던 장소는 유지되고 한 줄 요약만 보인다.

멈춤(교사) 중에는 준비가 모두 true여도 정산하지 않고, 재개 시 확인한다. 준비 완료 뒤 행동·주문 받기는 서버가 거절한다. 중복 commandId·재접속·동시 마지막 준비에서도 정산은 1회(DO 단일 스레드 + `settling` 플래그). 잔존 알람은 수동 모드에서 라운드를 진행하지 않는다(`alarm()`이 `turnMode==='timed'`일 때만 단계 전이).

기존 시간제 방(`schemaVersion 1`)은 `turnMode:'timed'`로 읽혀 그대로 진행되며, 교사가 행동 단계에서 **수동 진행으로 전환**할 수 있다. 자동 리셋은 없다.

## 가격 정책 (`src/shared/engine/market.ts`)

- 카테고리별 `z ∈ {-2..2}`, 계수 `1+0.04z`. 1라운드 z=0. 정산마다 `subRng(seed,'market',nextRound,category)`로 −1/0/+1을 25/50/25% 확률로 더하고 −2~2로 제한. 새로고침·재접속·재시도로 재추첨되지 않는다.
- 지급액 = `roundHalfUp(기본금 × 계수) + 고정 보너스`(특별 주문 +8). 이벤트 "운송 지원" +2는 그대로. 입찰비는 이미 낸 돈이므로 차감하지 않는다.
- 같은 라운드에는 모든 팀·모든 납품에 같은 시세. 마지막 정산에서는 새로 뽑지 않는다.
- 납품 명령에 `quoteVersion`(= 라운드)을 넣고, 서버 라운드와 다르면 거절하고 새 견적을 보게 한다.
- 시뮬레이션: 검증 2,016경기(`reports/balance/BALANCE_REPORT.md`) — 즉시 배달 정책(quickcash)과 계획 정책의 격차가 ±8% 변동 아래에서도 자리 효과 2%p 이내, 몰아 팔기 우위 없음(마지막 라운드 시세 고정, 기한 만료 존재).

## 변경 파일

- 엔진: `types.ts`(roundReady, turnMode, market, pricingVersion), `engine/market.ts`(신규), `engine/phases.ts`(settleAndOpenNextRound, allTeamsReady, 시세 추첨), `engine/commands.ts`(readyRound, quoteVersion, 준비 후 잠금), `protocol.ts`, `projection.ts`
- 서버: `worker/room.ts`(turnMode, tryAdvanceRound, skipTeam, switchToManual, observe 기록, 알람 분리)
- 클라이언트: `lib/places.ts`, `components/Scene.tsx`, `components/Hud.tsx`, `components/Coach.tsx`, `places/{Orders,Workshop,Store,Shipping}Place.tsx`, `screens/GameScreen.tsx`, `screens/TeacherBoard.tsx`, `screens/PracticeScreen.tsx`, `lib/local.ts`, `App.tsx`(`/game/:code/:place`), `styles.css`
- 에셋: `public/assets/manifest.json`(scene 4 + npc 3), `public/assets/images/*-v2.webp`
- 시뮬레이터/테스트: `sim/runner.ts`(수동 라운드), `tests/manual-round.test.ts`, `scripts/e2e-ws.mjs`

## 관측 기록

서버 `meta.obs`(최대 600건): 장소 이동, 유효 행동, 행동 불가 사유, 준비/취소, 교사 건너뛰기, 연결 이탈, 정산. 교사 내보내기(`/api/rooms/:code/export`)에 팀 단위 요약(`observation.byTeam`)이 들어간다. 경과시간은 진단용이며 게임 결과를 바꾸지 않는다.

## 남은 사람 플레이테스트 항목

- 첫 화면에서 "지금 무엇을 할 수 있는가"가 한 개의 행동으로 읽히는지 (중학생 3~5명).
- 준비 완료 흐름에서 "다른 팀을 기다림"이 지루하게 느껴지는 구간과 교사 개입 빈도.
- 보관/지금 배달 선택이 실제로 고민을 만드는지 (±8% 폭 적정성).
- 모바일(390px)에서 공방 트레이·선반 조작의 오탭.
