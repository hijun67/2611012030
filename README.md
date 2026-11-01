# 블로거 → 카드뉴스 → Threads 예약 (Netlify 버전)

## 폴더 구조 (이 경로 그대로 GitHub에 올리세요)
```
netlify.toml
package.json
public/index.html
lib/shared.mjs
netlify/functions/api.mjs
netlify/functions/tick.mjs
```

## 배포
1. GitHub 저장소에 위 파일을 올립니다. (아이폰은 "Add file → Create new file"에서 파일명에 `netlify/functions/api.mjs`처럼 경로를 직접 입력하고 내용을 붙여넣기)
2. Netlify → Add new site → Import from Git → 저장소 선택 (Build command 비워두기)
3. Site configuration → Environment variables 에 추가
   - `THREADS_ACCESS_TOKEN` : Threads API 토큰
   - `ACCESS_CODE` : 접속 코드 (꼭 설정)
   - `ANTHROPIC_API_KEY` : 카드 문구 AI 요약 (선택)
4. 배포된 `https://….netlify.app` 주소로 접속

## 동작 방식
- 카드 이미지와 예약 목록은 Netlify Blobs에 저장됩니다.
- `tick` 함수가 매 분 실행되어, 시각이 된 예약의 Threads 컨테이너를 만들고, 35초 이상 지난 다음 실행에서 게시합니다.
- 따라서 실제 게시 시각은 예약 시각보다 대개 1~2분 늦습니다.
- 스케줄 함수는 게시된(production) 배포에서만 동작합니다. 브랜치 미리보기에서는 동작하지 않습니다.
