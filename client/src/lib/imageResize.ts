/**
 * 이미지 리사이징 유틸리티
 *
 * 기본 설정: 1280px / 0.8 / JPEG
 * OCR 프리셋: OCR_HIGH (2560px/0.92), OCR_STORAGE (1280px/0.7)
 *
 * EXIF orientation을 직접 파싱하여 Canvas에 명시적 회전 적용.
 * 브라우저의 자동 EXIF 처리에 의존하지 않음.
 */

export interface ResizeOptions {
  maxSize?: number;
  quality?: number;
  mimeType?: string;
}

const DEFAULT_OPTIONS: Required<ResizeOptions> = {
  maxSize: 1280,
  quality: 0.8,
  mimeType: "image/jpeg",
};

export const OCR_HIGH: ResizeOptions = {
  maxSize: 2560,
  quality: 0.92,
  mimeType: "image/jpeg",
};

export const OCR_STORAGE: ResizeOptions = {
  maxSize: 1280,
  quality: 0.7,
  mimeType: "image/jpeg",
};

/**
 * JPEG 파일에서 EXIF orientation 태그를 직접 읽는다.
 * 반환값: 1~8 (EXIF 표준), 파싱 실패 시 1
 *
 * orientation 값 의미:
 *  1 = 정상 (회전 불필요)
 *  3 = 180° 회전
 *  6 = 시계방향 90° 회전 (세로 촬영 시 가장 흔함)
 *  8 = 반시계방향 90° 회전
 */
export function getExifOrientation(file: File): Promise<number> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const view = new DataView(e.target?.result as ArrayBuffer);
        // JPEG 매직넘버 확인 (0xFFD8)
        if (view.getUint16(0, false) !== 0xFFD8) { resolve(1); return; }

        let offset = 2;
        while (offset < view.byteLength - 2) {
          const marker = view.getUint16(offset, false);
          offset += 2;

          if (marker === 0xFFE1) {
            // APP1 (EXIF) 세그먼트 발견
            const exifStart = offset + 2; // length 필드 뒤
            // "Exif\0\0" 시그니처 확인
            if (
              view.getUint8(exifStart) !== 0x45 ||     // E
              view.getUint8(exifStart + 1) !== 0x78 || // x
              view.getUint8(exifStart + 2) !== 0x69 || // i
              view.getUint8(exifStart + 3) !== 0x66    // f
            ) {
              resolve(1);
              return;
            }

            const tiffStart = exifStart + 6; // "Exif\0\0" 뒤
            const bigEndian = view.getUint16(tiffStart, false) === 0x4D4D; // "MM"

            const ifdOffset = view.getUint32(tiffStart + 4, !bigEndian);
            const ifdStart = tiffStart + ifdOffset;
            const tagCount = view.getUint16(ifdStart, !bigEndian);

            for (let i = 0; i < tagCount; i++) {
              const tagAddr = ifdStart + 2 + i * 12;
              if (tagAddr + 12 > view.byteLength) break;
              const tagId = view.getUint16(tagAddr, !bigEndian);
              if (tagId === 0x0112) {
                // Orientation 태그 (0x0112)
                const orientation = view.getUint16(tagAddr + 8, !bigEndian);
                resolve(orientation);
                return;
              }
            }
            resolve(1);
            return;
          } else if ((marker & 0xFF00) !== 0xFF00) {
            break; // 유효하지 않은 마커
          } else {
            // 다른 세그먼트 건너뛰기
            offset += view.getUint16(offset, false);
          }
        }
        resolve(1);
      } catch {
        resolve(1);
      }
    };
    reader.onerror = () => resolve(1);
    // EXIF는 보통 앞 64KB 안에 있음
    reader.readAsArrayBuffer(file.slice(0, 65536));
  });
}

/**
 * File → 리사이징 + EXIF 회전 적용된 File 반환
 * 브라우저 자동 EXIF 처리에 의존하지 않고 직접 회전.
 */
export async function resizeImage(
  file: File,
  opts?: ResizeOptions
): Promise<File> {
  const { maxSize, quality, mimeType } = { ...DEFAULT_OPTIONS, ...opts };

  // 1. EXIF orientation 직접 읽기
  const orientation = await getExifOrientation(file);

  // 2. 이미지 로드 (브라우저가 EXIF 적용할 수도, 안 할 수도 있음)
  const img = await loadImage(file);

  // 3. EXIF 기반 실제 크기 결정
  //    orientation 5~8이면 가로/세로가 뒤바뀜
  const swapDimensions = orientation >= 5 && orientation <= 8;
  const srcWidth = swapDimensions ? img.height : img.width;
  const srcHeight = swapDimensions ? img.width : img.height;

  // 4. 리사이즈 계산 (회전 후 기준)
  let newWidth = srcWidth;
  let newHeight = srcHeight;
  if (srcWidth > maxSize || srcHeight > maxSize) {
    const ratio = Math.min(maxSize / srcWidth, maxSize / srcHeight);
    newWidth = Math.round(srcWidth * ratio);
    newHeight = Math.round(srcHeight * ratio);
  }

  // 5. Canvas 생성 (회전 후 크기 기준)
  const canvas = document.createElement("canvas");
  canvas.width = newWidth;
  canvas.height = newHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context 생성 실패");

  // 6. EXIF orientation에 따라 Canvas 변환 적용
  //    브라우저가 이미 EXIF를 적용했으면 img.width === 올바른 너비
  //    적용 안 했으면 img.width === 원본(회전 전) 너비
  //    → 직접 변환을 적용해서 확실히 맞춤
  ctx.save();
  switch (orientation) {
    case 2: // 좌우 반전
      ctx.scale(-1, 1);
      ctx.drawImage(img, -newWidth, 0, newWidth, newHeight);
      break;
    case 3: // 180° 회전
      ctx.translate(newWidth, newHeight);
      ctx.rotate(Math.PI);
      ctx.drawImage(img, 0, 0, newWidth, newHeight);
      break;
    case 4: // 상하 반전
      ctx.scale(1, -1);
      ctx.drawImage(img, 0, -newHeight, newWidth, newHeight);
      break;
    case 5: // 좌우반전 + 90° CW
      ctx.translate(newWidth, 0);
      ctx.rotate(Math.PI / 2);
      ctx.scale(1, -1);
      ctx.drawImage(img, 0, -newHeight, newHeight, newWidth);
      break;
    case 6: // 90° CW (가장 흔함: 세로 촬영)
      ctx.translate(newWidth, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, 0, 0, newHeight, newWidth);
      break;
    case 7: // 좌우반전 + 90° CCW
      ctx.translate(0, newHeight);
      ctx.rotate(-Math.PI / 2);
      ctx.scale(1, -1);
      ctx.drawImage(img, 0, -newWidth, newHeight, newWidth);
      break;
    case 8: // 90° CCW
      ctx.translate(0, newHeight);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(img, 0, 0, newHeight, newWidth);
      break;
    default: // 1 또는 알 수 없는 값: 회전 없이 그대로
      ctx.drawImage(img, 0, 0, newWidth, newHeight);
      break;
  }
  ctx.restore();

  // 7. Blob → File
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas toBlob 실패"))),
      mimeType,
      quality
    );
  });

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
