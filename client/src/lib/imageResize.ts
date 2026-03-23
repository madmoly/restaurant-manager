/**
 * 이미지 리사이징 유틸리티
 * 체크리스트 사진 등 업로드 전 Canvas API를 사용해 압축
 *
 * 기본 설정:
 *  - 최대 크기: 1280px (장변 기준)
 *  - JPEG 품질: 0.8
 *  - 출력 포맷: image/jpeg
 */

export interface ResizeOptions {
  /** 장변 최대 px (기본 1280) */
  maxSize?: number;
  /** JPEG 품질 0~1 (기본 0.8) */
  quality?: number;
  /** 출력 MIME (기본 image/jpeg) */
  mimeType?: string;
}

const DEFAULT_OPTIONS: Required<ResizeOptions> = {
  maxSize: 1280,
  quality: 0.8,
  mimeType: "image/jpeg",
};

/**
 * File → 리사이징된 File 반환
 * 이미 작은 이미지는 그대로 반환 (불필요한 재인코딩 방지)
 */
export async function resizeImage(
  file: File,
  opts?: ResizeOptions
): Promise<File> {
  const { maxSize, quality, mimeType } = { ...DEFAULT_OPTIONS, ...opts };

  // 이미지 로드
  const img = await loadImage(file);
  const { width, height } = img;

  // 리사이징 불필요 시 원본 반환
  if (width <= maxSize && height <= maxSize) {
    // 단, JPEG 변환/품질 압축은 수행
    if (file.type === mimeType && file.size < 1024 * 1024) {
      return file;
    }
  }

  // 비율 유지 축소 계산
  let newWidth = width;
  let newHeight = height;
  if (width > maxSize || height > maxSize) {
    const ratio = Math.min(maxSize / width, maxSize / height);
    newWidth = Math.round(width * ratio);
    newHeight = Math.round(height * ratio);
  }

  // Canvas 리사이징
  const canvas = document.createElement("canvas");
  canvas.width = newWidth;
  canvas.height = newHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context 생성 실패");

  ctx.drawImage(img, 0, 0, newWidth, newHeight);

  // Blob → File 변환
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas toBlob 실패"))),
      mimeType,
      quality
    );
  });

  // 원본 파일명 유지하되 확장자를 jpg로
  const ext = mimeType === "image/png" ? ".png" : ".jpg";
  const baseName = file.name.replace(/\.[^.]+$/, "");
  return new File([blob], `${baseName}${ext}`, { type: mimeType });
}

/** File → HTMLImageElement 로드 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지 로드 실패"));
    };
    img.src = url;
  });
}
