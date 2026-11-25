# 하이쿠 — AI와 대화하며 게임 만들기

학생이 AI(Claude Haiku)와 대화하면서 게임을 만들고, 그 자리에서 바로 실행해 보는 수업 도구예요.
누구나 가져가서 자기 Cloudflare 계정에 올려 쓸 수 있어요.

- 운영 예시: https://haiku-effort-chat.yoon2566.workers.dev
- "간단한 공룡 게임 만들어줘"처럼 말하면 게임(HTML 파일 하나)을 만들어 줘요. `▶ 게임 미리보기`로 바로 해 보고, `↓ HTML 다운로드`로 파일을 받아 갈 수 있어요.
- "점프를 더 높게 해줘"처럼 이어서 말하면 만든 게임을 고쳐 줘요.
- `이미지` 스위치를 켜면 글로 설명한 그림을 만들어 줘요.
- 이미지나 HTML 파일을 첨부해서 물어볼 수 있어요.
- 프롬프트 캔버스: 선생님이 올려 둔 글(예: 오늘 쓸 프롬프트)을 학생 모두가 보고 입력창으로 옮겨 쓸 수 있어요.
- 로그인이나 수업 코드 없이 주소만 열면 바로 써요.

## 내 계정에 올리기 (Cloudflare)

준비물: Node.js 22 이상, Cloudflare 계정, OpenRouter 키

1. 내려받고 설치
   ```
   npm install
   npx wrangler login
   ```
2. `wrangler.json`의 `name`을 원하는 주소 이름으로 바꿔요.
3. 배포
   ```
   npm run deploy
   ```
   주소: `https://<name>.<내 계정>.workers.dev`
4. 비밀값 넣기 (값은 저장소에 없어요)
   ```
   npx wrangler secret put HAIKU_OPENROUTER_KEY
   ```
   - `HAIKU_OPENROUTER_KEY`: 대화와 그림에 쓰는 OpenRouter 키예요. 넣기 전에는 "서버의 API 연결 설정을 확인해 주세요"라고 나와요.
5. (선택) 프롬프트 캔버스에 글을 올리려면 관리자 비밀번호도 넣어요.
   ```
   npm run password:hash
   npx wrangler secret put HAIKU_CANVAS_PASSWORD_HASH
   ```
   첫 명령에 비밀번호를 입력하면 64자 값이 나와요. 그 값을 둘째 명령에 붙여 넣어요. 서버에는 비밀번호가 아니라 이 바꾼 값만 들어가요. 길고 추측하기 어려운 비밀번호를 써 주세요. 입력하는 비밀번호가 화면에 그대로 보이니 주변을 확인하고 입력해 주세요.

## 내 컴퓨터에서 먼저 돌려 보기

폴더에 `.dev.vars` 파일을 만들어 아래 한 줄을 적고 `npm run dev`를 실행해요. 이 파일은 저장소에 올라가지 않아요.

```
HAIKU_OPENROUTER_KEY=내_OpenRouter_키
```

캔버스 관리자 로그인까지 해 보려면 `HAIKU_CANVAS_PASSWORD_HASH=64자_값` 줄도 넣어요.

## 쓰는 법

- 학생: 주소를 열고 만들고 싶은 게임을 말해요. 답에 게임이 나오면 `▶ 게임 미리보기`로 해 보고, 고치고 싶은 점을 이어서 말해요.
- 선생님: 오른쪽 위 `프롬프트 캔버스` → `관리자 로그인` → 글을 쓰고 `저장`. 학생은 같은 곳에서 `입력창에 옮기기`나 `복사`를 눌러요.
- 에포트(Medium·High)와 추론 스위치로 답을 얼마나 깊이 생각하게 할지 고를 수 있어요.

## 알아 둘 것

- AI 사용료는 넣은 키의 계정에서 나가요. OpenRouter에서 키에 사용 한도를 정해 두는 것을 권해요.
- 로그인이 없어서 주소를 아는 사람은 누구나 쓸 수 있어요. 요청은 대화와 그림을 따로 세어, 각각 모든 사용자를 합쳐 1분에 600번까지만 받아요(`worker/minimal-worker.js`의 `REQUESTS_PER_MINUTE`). 한 사람이 그 한도를 다 쓸 수도 있어요.
- 키와 비밀번호는 코드에 적지 말고 위처럼 `wrangler secret`으로만 넣어요. 이 저장소에는 운영 키, 비밀번호, 학생 대화가 들어 있지 않아요.
- 학생이 쓴 글과 첨부한 그림은 답을 만들기 위해 OpenRouter를 거쳐 AI 모델 회사로 전달돼요. 이름·연락처 같은 개인정보는 적지 않도록 안내해 주세요.
- 이 서버는 대화를 저장하지 않아요. 서버에 남는 것은 캔버스 글, 관리자 로그인 상태(1시간 뒤 지워져요), 그리고 접속 주소(IP)를 해시 값으로 바꿔 그 값별로 세는 요청 횟수예요. 횟수는 다음 요청이 오면 덮어써요.
- 공개 GitHub 주소를 붙여 넣으면 AI가 그 저장소를 읽고 답해요. 이때 OpenRouter의 웹 읽기 도구를 써서 요금이 더 들 수 있어요.
- 글 모델(`anthropic/claude-haiku-5.5`)과 AI에게 주는 안내문은 `worker/minimal-worker.js`의 `MODEL`·`SYSTEM`, 그림 모델은 `worker/image-generation.js`의 `IMAGE_MODEL`에서 바꿔요. 화면에 보이는 모델 이름은 `public/index.html`과 `public/app.js`에서 따로 바꿔요.
- 화면과 서버 코드는 운영 중인 사이트와 같고, 입구 파일(`worker/index.js`)만 이 저장소용으로 더했어요. 내 컴퓨터에서 실행되는 것까지 확인했고, 새 계정에 실제로 올려 보는 것은 확인하지 못했어요.

## 참고한 자료

게임 설계 안내문은 abagames의 [agentic-gamedev-skills](https://github.com/abagames/agentic-gamedev-skills) 중 designing-mini-games(MIT)를 참고해 한국어로 고쳐 넣었어요. 출처와 라이선스는 `third_party/abagames/`에 있어요.

## 라이선스

MIT 라이선스예요. 학교 수업은 물론 상업적 용도까지 누구나 자유롭게 쓰고, 고치고, 다시 배포할 수 있어요. 저작권 표시와 라이선스 문구만 함께 남겨 주세요. 자세한 내용은 [LICENSE](LICENSE)를 보세요.
