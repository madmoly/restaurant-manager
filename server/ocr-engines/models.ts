/**
 * OCR 모델 설정 일원화
 *
 * 전 OCR 엔드포인트가 참조하는 단일 소스. process.env.OCR_*_MODEL로 오버라이드 가능
 * (코드 수정 없이 모델 실험/교체 토글).
 *
 * text: 매입전표 텍스트 해석 stage (Upstage 결과 구조화)
 * vision: 매입전표 Vision 폴백 stage (이미지 직접 판독)
 * statement: 월매입정산표 OCR
 * healthCert: 보건증 판독
 * sales: 매출 전표(POS 마감) OCR
 */
export const OCR_MODELS = {
  text: process.env.OCR_TEXT_MODEL ?? "claude-haiku-4-5",
  vision: process.env.OCR_VISION_MODEL ?? "claude-sonnet-4-6",
  statement: process.env.OCR_STATEMENT_MODEL ?? "claude-sonnet-4-6",
  healthCert: process.env.OCR_HEALTH_CERT_MODEL ?? "claude-sonnet-4-6",
  sales: process.env.OCR_SALES_MODEL ?? "claude-sonnet-4-6",
} as const;
