import multer from "multer";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import { Request, Response, Router } from "express";

// ─── 업로드 디렉토리 ──────────────────────────────────────────────────────────

const UPLOAD_ROOT = path.resolve(process.cwd(), "uploads");
const CHECKLIST_DIR = path.join(UPLOAD_ROOT, "checklists");
const ORDERS_DIR = path.join(UPLOAD_ROOT, "orders");

// 디렉토리 자동 생성
[UPLOAD_ROOT, CHECKLIST_DIR, ORDERS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─── Multer 설정 ──────────────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    // 날짜별 하위 폴더
    const today = new Date().toISOString().slice(0, 10);
    const dayDir = path.join(CHECKLIST_DIR, today);
    if (!fs.existsSync(dayDir)) fs.mkdirSync(dayDir, { recursive: true });
    cb(null, dayDir);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname) || ".jpg";
    const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, unique);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB 제한
  fileFilter(_req, file, cb) {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("이미지 파일만 업로드 가능합니다"));
      return;
    }
    cb(null, true);
  },
});

// ─── 라우터 ───────────────────────────────────────────────────────────────────

export const uploadRouter = Router();

/**
 * POST /api/upload/checklist-photo
 * multipart/form-data: field name = "photo"
 * 응답: { url: "/uploads/checklists/2026-03-23/abc123.jpg" }
 */
uploadRouter.post("/checklist-photo", upload.single("photo"), (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "파일이 없습니다" });
    return;
  }
  // 상대 경로 반환 (정적 서빙 기준)
  const relativePath = path.relative(UPLOAD_ROOT, req.file.path).replace(/\\/g, "/");
  const url = `/uploads/${relativePath}`;
  res.json({ url });
});

/**
 * POST /api/upload/order-image
 * multipart/form-data: field name = "photo"
 * 발주 이미지 업로드 (카메라/앨범 모두 허용)
 */
const orderStorage = multer.diskStorage({
  destination(_req, _file, cb) {
    const today = new Date().toISOString().slice(0, 10);
    const dayDir = path.join(ORDERS_DIR, today);
    if (!fs.existsSync(dayDir)) fs.mkdirSync(dayDir, { recursive: true });
    cb(null, dayDir);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname) || ".jpg";
    const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, unique);
  },
});

const orderUpload = multer({
  storage: orderStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 발주 이미지 10MB 허용
  fileFilter(_req, file, cb) {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("이미지 파일만 업로드 가능합니다"));
      return;
    }
    cb(null, true);
  },
});

uploadRouter.post("/order-image", orderUpload.single("photo"), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "파일이 없습니다" });
    return;
  }

  // EXIF orientation 기반 자동 회전 → 파일 덮어쓰기
  // 이후 OCR, 프리뷰, 저장 모두 정방향 이미지 사용
  try {
    const rotated = await sharp(req.file.path).rotate().toBuffer();
    fs.writeFileSync(req.file.path, rotated);
    console.log(`[upload] EXIF 회전 적용: ${path.basename(req.file.path)} (${(rotated.length / 1024).toFixed(0)}KB)`);
  } catch (err) {
    console.warn(`[upload] EXIF 회전 실패 (원본 유지): ${path.basename(req.file.path)}`, err);
  }

  const relativePath = path.relative(UPLOAD_ROOT, req.file.path).replace(/\\/g, "/");
  const url = `/uploads/${relativePath}`;
  res.json({ url });
});

/**
 * POST /api/upload/fixed-cost-attachment
 * multipart/form-data: field name = "file"
 * 고정비 첨부파일 (이미지 + PDF 허용, 10MB)
 */
const FIXED_COST_DIR = path.join(UPLOAD_ROOT, "fixed-costs");
if (!fs.existsSync(FIXED_COST_DIR)) fs.mkdirSync(FIXED_COST_DIR, { recursive: true });

const fixedCostStorage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, FIXED_COST_DIR);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname) || ".pdf";
    const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, unique);
  },
});

const fixedCostUpload = multer({
  storage: fixedCostStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const allowed = file.mimetype.startsWith("image/") || file.mimetype === "application/pdf";
    if (!allowed) {
      cb(new Error("이미지 또는 PDF 파일만 업로드 가능합니다"));
      return;
    }
    cb(null, true);
  },
});

uploadRouter.post("/fixed-cost-attachment", fixedCostUpload.single("file"), (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "파일이 없습니다" });
    return;
  }
  const relativePath = path.relative(UPLOAD_ROOT, req.file.path).replace(/\\/g, "/");
  const url = `/uploads/${relativePath}`;
  res.json({ url });
});

/**
 * POST /api/upload/order-image-replace
 * OCR 분석 완료 후 고품질 이미지를 저품질로 교체 (저장 공간 절약)
 * Body: multipart { photo: File, replaceUrl: string }
 */
uploadRouter.post("/order-image-replace", orderUpload.single("photo"), (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "파일이 없습니다" });
    return;
  }
  const replaceUrl = req.body?.replaceUrl;
  if (!replaceUrl || typeof replaceUrl !== "string") {
    // 교체 대상 없으면 새 파일만 삭제하고 종료
    fs.unlinkSync(req.file.path);
    res.status(400).json({ error: "replaceUrl이 필요합니다" });
    return;
  }
  try {
    const relativePath = replaceUrl.replace(/^\/uploads\//, "");
    const targetPath = path.join(UPLOAD_ROOT, relativePath);
    if (fs.existsSync(targetPath)) {
      // 새 저품질 파일로 기존 고품질 파일 교체
      fs.copyFileSync(req.file.path, targetPath);
    }
    // 임시 업로드 파일 삭제
    fs.unlinkSync(req.file.path);
    res.json({ ok: true });
  } catch (err: any) {
    // 교체 실패해도 치명적이지 않음
    try { fs.unlinkSync(req.file.path); } catch {}
    res.json({ ok: false, error: err.message });
  }
});

// ─── 2주 지난 체크리스트 사진 자동삭제 ────────────────────────────────────────

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

export function cleanupOldChecklistPhotos() {
  if (!fs.existsSync(CHECKLIST_DIR)) return;

  const now = Date.now();
  const entries = fs.readdirSync(CHECKLIST_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    // 폴더명이 날짜 형식(YYYY-MM-DD)인 경우만 처리
    const folderDate = new Date(entry.name + "T00:00:00");
    if (isNaN(folderDate.getTime())) continue;

    const age = now - folderDate.getTime();
    if (age > TWO_WEEKS_MS) {
      const dirPath = path.join(CHECKLIST_DIR, entry.name);
      fs.rmSync(dirPath, { recursive: true, force: true });
      console.log(`[cleanup] 체크리스트 사진 삭제: ${entry.name} (${Math.floor(age / 86400000)}일 경과)`);
    }
  }
}

// 서버 시작 시 1회 + 24시간마다 실행
export function startCleanupScheduler() {
  cleanupOldChecklistPhotos();
  setInterval(cleanupOldChecklistPhotos, 24 * 60 * 60 * 1000);
}

export { UPLOAD_ROOT };
