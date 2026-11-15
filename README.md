# 컵체크. — CODEMATE

카메라로 **종이컵 / 플라스틱컵**을 구분하는 고등학교 코딩 동아리 CODEMATE의 웹 프로젝트입니다.

## 사용 방법

1. https://kmc080406.github.io/cup/ 에 접속합니다. (GitHub Pages 활성화 필요)
2. **시작하기**를 누르고 카메라 접근을 허용합니다.
3. 종이컵 또는 플라스틱컵을 카메라 중앙에 하나씩 비춥니다.
4. AI가 추정한 재질을 표시합니다. 모바일은 전·후면 카메라 전환이 가능합니다.

## 작동 원리

- 이미지와 문장을 비교하는 사전 학습 모델 **MobileCLIP-S0** (Hugging Face Transformers.js, \`Xenova/mobileclip_s0\`) 사용
- 브라우저 내부에서 카메라 프레임(중앙부)을 분석하고, 종이컵·플라스틱컵의 설명문과 얼마나 유사한지 비교
- 애매하거나 컵이 보이지 않는 경우 결과를 보류하도록 설계
- 처음 실행 시 모델 파일 수십 MB를 다운로드해야 하므로 인터넷 연결이 필요합니다.
- 두 재질의 **상대 비교 점수**는 분류 모델의 정답 확률이나 실물 재질 검증이 아닙니다.

**주의:** 이 모델은 종이컵·플라스틱컵 전용 학습 모델이 아닙니다. 종이 코팅, 투명하지 않은 플라스틱, 재사용 컵 등은 틀릴 수 있습니다. 실물 컵 여러 종류로 시연 정확도를 검증한 뒤 동아리 발표에 사용하세요.

## 프로젝트 구성

- \`index.html\`: 시작 화면과 카메라·분류 결과 UI
- \`style.css\`: PC·모바일 반응형 디자인
- \`app.js\`: 카메라 제어, MobileCLIP 불러오기, 분류 및 결과 표시

**개인정보:** 카메라 영상은 별도 서버에 업로드·저장하지 않습니다. 사전 학습 모델 파일을 다운로드해 브라우저에서 추론합니다.

## GitHub Pages

저장소 **Settings → Pages → Build and deployment → Deploy from a branch → main / (root)**를 설정합니다. HTTPS에서 카메라 기능을 사용할 수 있습니다.

## 참고

- [Hugging Face Transformers.js](https://huggingface.co/docs/transformers.js/v3.8.1/en/installation)
- [MobileCLIP-S0 Transformers.js ONNX 모델](https://huggingface.co/Xenova/mobileclip_s0)
