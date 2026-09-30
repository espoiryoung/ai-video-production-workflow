# AI Video Production Workflow

Higgsfield API와 외부 영상 생성 플랫폼을 하나의 제작 흐름으로 연결하는 AI 영상 제작 관리 웹앱입니다.

Scene별 에셋과 제작 조건으로 Prompt를 조립하고, 생성 결과를 Take 단위로 기록합니다. 실패 유형에 맞는 Correction Rule을 적용해 Retry Prompt를 만들고, 재생성 결과까지 하나의 타임라인에서 추적할 수 있습니다.

## 핵심 기능

- Character, Location, Object 에셋 재사용
- Camera Preset과 Continuity Rule 관리
- Scene 정보 기반 Prompt 자동 조립 및 직접 편집
- Higgsfield API 영상 생성과 상태 추적
- 외부 플랫폼용 Prompt 복사 및 결과 영상 등록
- Take 단위 생성 이력과 ACCEPTED/FAILED 평가
- 실패 유형별 Correction Rule과 Retry Prompt 자동 생성
- 재생성 시 기존 결과를 보존하는 제작 타임라인
- 서버 전용 API 자격 증명과 비밀번호 인증

## 로컬 실행

`.env.example`을 `.env.local`로 복사한 뒤 본인의 값을 입력합니다. `.env.local`은 Git에서 제외됩니다.

```dotenv
APP_PASSWORD=내가_사용할_긴_비밀번호
SESSION_SECRET=별도의_충분히_긴_랜덤_문자열
APP_URL=http://localhost:3000
```

```bash
npm install
npm run dev
```

`http://localhost:3000`에서 접속합니다. 로컬 주소의 업로드 파일은 Higgsfield 서버가 가져갈 수 없으므로 텍스트 생성만 로컬에서 바로 사용할 수 있습니다. 프레임/요소 레퍼런스 생성은 공개 HTTPS 주소로 배포한 뒤 사용하세요.

## 두 가지 화면

- `/`: Scene, Prompt Preset, Correction Rule, Take 평가와 재생성을 관리하는 Production Flow
- `/classic`: 기존 단일 영상 생성 화면. 기존 기능과 데이터는 그대로 유지됩니다.

두 화면은 같은 Element 라이브러리, 모델 정의, 서버 전용 `HF_CREDENTIALS`, 생성 기록을 공유합니다. Production Flow의 외부 결과 등록은 MP4, MOV, WebM 파일을 Take로 저장하며 파일당 최대 500MB입니다.

Scene의 Character/Location/Object는 기존 Element ID를 참조합니다. 선택한 모델이 이미지 레퍼런스를 지원하지 않으면 이름과 제작 정보는 Prompt/History에 남지만 이미지 URL은 Higgsfield 요청에 포함되지 않습니다. 로컬 이미지 URL은 Higgsfield가 가져갈 수 없으므로 레퍼런스 모델 테스트는 공개 HTTPS `APP_URL`이 필요합니다.

## 배포

Docker를 실행할 수 있고 영속 볼륨을 제공하는 서비스(VPS, Fly.io, Railway 등)에 배포할 수 있습니다.

- 서버 환경변수: `HF_CREDENTIALS`, `APP_PASSWORD`, `SESSION_SECRET`, `APP_URL`
- `APP_URL`: 배포된 공개 HTTPS origin (예: `https://studio.example.com`)
- 영속 볼륨: `/app/data`, `/app/uploads`
- 리버스 프록시 뒤에서는 `TRUST_PROXY=true`
- 공개 인터넷 배포 시 반드시 HTTPS 사용

앱의 JSON 데이터는 `data/app.json`, 업로드 이미지는 `uploads/`에 저장됩니다. 두 경로를 같은 영속 볼륨에 보관해야 재배포 후에도 다른 기기에서 요소와 생성 기록을 확인할 수 있습니다.

## 구현된 공식 모델

- `bytedance/seedance-2.5/text-to-video`
- `bytedance/seedance-2.5/image-to-video`
- `kling-video/v3.0/std/text-to-video`
- `kling-video/v3.0/std/image-to-video`
- `kling-video/o3/image-reference`

모델 capability와 공식 문서 링크는 [models.ts](./models.ts)에 모여 있습니다. 문서 변경 시 이 파일만 갱신하면 UI와 서버 검증이 함께 바뀝니다.

## 상태와 취소 동작

공식 TypeScript v2 SDK는 `subscribe(..., { withPolling: true })` 방식의 자동 폴링을 제공하지만 기존 request ID의 원격 취소 API는 제공하지 않습니다. 따라서 현재 앱의 취소는 해당 기록을 즉시 `canceled`로 고정하고 늦게 도착한 결과를 무시하는 로컬 취소입니다. 실제 Higgsfield 작업/과금이 중단된다고 보장하지 않습니다.

Higgsfield가 `nsfw` 상태를 반환하면 앱에서는 사용자 친화적인 `Moderated` 상태로 저장합니다. 실패·취소·Moderated 결과는 완료로 취급하지 않습니다.

## 보안 및 데이터

API 자격 증명은 브라우저 코드나 API 응답에 포함되지 않습니다. 실제 환경 파일, 업로드 미디어, Scene/Take 기록과 개인 제작 레퍼런스는 저장소에 포함하지 않습니다. 앱은 최초 실행 시 빈 `data/app.json`과 필요한 디렉터리를 자동 생성합니다.
