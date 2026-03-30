/**
 * Google Drive 학습 데이터셋 자동 업로드 모듈
 *
 * 환경변수:
 * - GOOGLE_SERVICE_ACCOUNT_KEY: 서비스 계정 JSON 키 (문자열)
 * - GOOGLE_DRIVE_FOLDER_ID: 업로드 대상 폴더 ID
 *
 * 사용: 매입 확정 시 자동으로 JSONL 데이터를 Drive에 업로드
 */

import { google } from "googleapis";
import { Readable } from "stream";
import { db } from "./db";
import {
  ocrCorrections, counterparties, counterpartyOcrProfiles,
  purchaseOrdersV2, purchaseOrderItemsV2, items, restaurants,
} from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";

// ─── Google Drive 인증 ───

function getAuth() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) return null;

  try {
    const key = JSON.parse(keyJson);
    return new google.auth.GoogleAuth({
      credentials: key,
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    });
  } catch (e) {
    console.error("[GDrive] 서비스 계정 키 파싱 실패:", e);
    return null;
  }
}

function getDrive() {
  const auth = getAuth();
  if (!auth) return null;
  return google.drive({ version: "v3", auth });
}

export function isGDriveConfigured(): boolean {
  return !!(process.env.GOOGLE_SERVICE_ACCOUNT_KEY && process.env.GOOGLE_DRIVE_FOLDER_ID);
}

// ─── 파일 업로드 헬퍼 ───

async function uploadJsonFile(
  drive: any,
  folderId: string,
  fileName: string,
  data: any,
): Promise<{ fileId: string; webViewLink: string } | null> {
  try {
    const content = typeof data === "string" ? data : JSON.stringify(data, null, 2);
    const stream = Readable.from(Buffer.from(content, "utf-8"));

    // 같은 이름 파일이 있으면 업데이트, 없으면 생성
    const existing = await drive.files.list({
      q: `name='${fileName}' and '${folderId}' in parents and trashed=false`,
      fields: "files(id)",
    });

    let fileId: string;

    if (existing.data.files?.length > 0) {
      // 업데이트
      fileId = existing.data.files[0].id;
      await drive.files.update({
        fileId,
        media: { mimeType: "application/json", body: stream },
      });
    } else {
      // 새로 생성
      const res = await drive.files.create({
        requestBody: {
          name: fileName,
          mimeType: "application/json",
          parents: [folderId],
        },
        media: { mimeType: "application/json", body: stream },
        fields: "id, webViewLink",
      });
      fileId = res.data.id;
    }

    // webViewLink 가져오기
    const meta = await drive.files.get({
      fileId,
      fields: "webViewLink",
    });

    return { fileId, webViewLink: meta.data.webViewLink || "" };
  } catch (err) {
    console.error(`[GDrive] 파일 업로드 실패 (${fileName}):`, err);
    return null;
  }
}

async function uploadJsonlFile(
  drive: any,
  folderId: string,
  fileName: string,
  records: any[],
): Promise<{ fileId: string; webViewLink: string } | null> {
  const jsonl = records.map((r) => JSON.stringify(r)).join("\n");
  return uploadJsonFile(drive, folderId, fileName, jsonl);
}

// ─── 데이터셋 내보내기 함수들 ───

/** OCR 수정 데이터셋 (원본→수정 쌍) → JSONL */
async function buildCorrectionsDataset() {
  const rows = await db
    .select({
      id: ocrCorrections.id,
      restaurantId: ocrCorrections.restaurantId,
      counterpartyId: ocrCorrections.counterpartyId,
      counterpartyName: counterparties.name,
      imageUrl: ocrCorrections.imageUrl,
      originalItems: ocrCorrections.originalItems,
      correctedItems: ocrCorrections.correctedItems,
      createdAt: ocrCorrections.createdAt,
    })
    .from(ocrCorrections)
    .leftJoin(counterparties, eq(ocrCorrections.counterpartyId, counterparties.id))
    .orderBy(desc(ocrCorrections.createdAt));

  return rows.map((r) => ({
    id: r.id,
    restaurantId: r.restaurantId,
    counterparty: { id: r.counterpartyId, name: r.counterpartyName },
    imageUrl: r.imageUrl,
    original: r.originalItems,
    corrected: r.correctedItems,
    createdAt: r.createdAt,
  }));
}

/** 확정 매입 데이터셋 → JSONL */
async function buildPurchasesDataset() {
  const orders = await db
    .select({
      orderId: purchaseOrdersV2.id,
      restaurantId: purchaseOrdersV2.restaurantId,
      restaurantName: restaurants.name,
      counterpartyId: purchaseOrdersV2.counterpartyId,
      counterpartyName: counterparties.name,
      purchaseDate: purchaseOrdersV2.purchaseDate,
      status: purchaseOrdersV2.status,
      totalAmount: purchaseOrdersV2.totalAmount,
      createdAt: purchaseOrdersV2.createdAt,
    })
    .from(purchaseOrdersV2)
    .leftJoin(counterparties, eq(purchaseOrdersV2.counterpartyId, counterparties.id))
    .leftJoin(restaurants, eq(purchaseOrdersV2.restaurantId, restaurants.id))
    .orderBy(desc(purchaseOrdersV2.purchaseDate));

  let allItems: any[] = [];
  if (orders.length > 0) {
    allItems = await db
      .select({
        purchaseOrderId: purchaseOrderItemsV2.purchaseOrderId,
        itemId: purchaseOrderItemsV2.itemId,
        rawItemName: purchaseOrderItemsV2.rawItemName,
        itemType: purchaseOrderItemsV2.itemType,
        quantity: purchaseOrderItemsV2.quantity,
        unitName: purchaseOrderItemsV2.unitName,
        unitPrice: purchaseOrderItemsV2.unitPrice,
        lineTotal: purchaseOrderItemsV2.lineTotal,
        costingCategory: purchaseOrderItemsV2.costingCategory,
        standardItemName: items.name,
      })
      .from(purchaseOrderItemsV2)
      .leftJoin(items, eq(purchaseOrderItemsV2.itemId, items.id))
      .orderBy(purchaseOrderItemsV2.purchaseOrderId);
  }

  const itemsByOrder = new Map<number, any[]>();
  for (const it of allItems) {
    const list = itemsByOrder.get(it.purchaseOrderId) || [];
    list.push({
      itemId: it.itemId,
      rawName: it.rawItemName,
      standardName: it.standardItemName,
      type: it.itemType,
      quantity: it.quantity ? Number(it.quantity) : null,
      unit: it.unitName,
      unitPrice: it.unitPrice ? Number(it.unitPrice) : null,
      lineTotal: it.lineTotal ? Number(it.lineTotal) : null,
      category: it.costingCategory,
    });
    itemsByOrder.set(it.purchaseOrderId, list);
  }

  return orders.map((o) => ({
    orderId: o.orderId,
    restaurant: { id: o.restaurantId, name: o.restaurantName },
    counterparty: { id: o.counterpartyId, name: o.counterpartyName },
    purchaseDate: o.purchaseDate,
    status: o.status,
    totalAmount: o.totalAmount ? Number(o.totalAmount) : null,
    items: itemsByOrder.get(o.orderId) || [],
    createdAt: o.createdAt,
  }));
}

/** 거래처 프로파일 + 품목 마스터 */
async function buildProfilesDataset() {
  const profiles = await db
    .select({
      counterpartyId: counterpartyOcrProfiles.counterpartyId,
      counterpartyName: counterparties.name,
      documentType: counterpartyOcrProfiles.documentType,
      columnOrder: counterpartyOcrProfiles.columnOrder,
      frequentItems: counterpartyOcrProfiles.frequentItems,
      sampleCount: counterpartyOcrProfiles.sampleCount,
      lastUsedAt: counterpartyOcrProfiles.lastUsedAt,
    })
    .from(counterpartyOcrProfiles)
    .leftJoin(counterparties, eq(counterpartyOcrProfiles.counterpartyId, counterparties.id))
    .orderBy(desc(counterpartyOcrProfiles.sampleCount));

  const itemMaster = await db
    .select({
      id: items.id,
      restaurantId: items.restaurantId,
      name: items.name,
      itemType: items.itemType,
      costingCategory: items.costingCategory,
      baseUnit: items.baseUnit,
      isActive: items.isActive,
    })
    .from(items)
    .orderBy(items.restaurantId, items.name);

  return { profiles, itemMaster };
}

// ─── 메인 내보내기 함수 ───

export interface ExportResult {
  success: boolean;
  files: Array<{ name: string; fileId?: string; link?: string; records: number }>;
  error?: string;
}

/**
 * 전체 학습 데이터셋을 Google Drive에 업로드
 * SystemPage에서 호출하거나, 크론으로 자동 실행
 */
export async function exportDatasetToGDrive(): Promise<ExportResult> {
  const drive = getDrive();
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!drive || !folderId) {
    return {
      success: false,
      files: [],
      error: "Google Drive 연동 미설정. GOOGLE_SERVICE_ACCOUNT_KEY와 GOOGLE_DRIVE_FOLDER_ID 환경변수를 확인하세요.",
    };
  }

  const results: ExportResult["files"] = [];
  const today = new Date().toISOString().slice(0, 10);

  try {
    // 1. OCR 수정 데이터셋
    const corrections = await buildCorrectionsDataset();
    const corrResult = await uploadJsonlFile(
      drive, folderId, `ocr-corrections-${today}.jsonl`, corrections,
    );
    results.push({
      name: `ocr-corrections-${today}.jsonl`,
      fileId: corrResult?.fileId,
      link: corrResult?.webViewLink,
      records: corrections.length,
    });

    // 2. 확정 매입 데이터셋
    const purchases = await buildPurchasesDataset();
    const purchResult = await uploadJsonlFile(
      drive, folderId, `purchases-${today}.jsonl`, purchases,
    );
    results.push({
      name: `purchases-${today}.jsonl`,
      fileId: purchResult?.fileId,
      link: purchResult?.webViewLink,
      records: purchases.length,
    });

    // 3. 프로파일 + 품목 마스터
    const { profiles, itemMaster } = await buildProfilesDataset();
    const profResult = await uploadJsonFile(
      drive, folderId, `profiles-items-${today}.json`,
      { exportedAt: new Date().toISOString(), profiles, itemMaster },
    );
    results.push({
      name: `profiles-items-${today}.json`,
      fileId: profResult?.fileId,
      link: profResult?.webViewLink,
      records: profiles.length + itemMaster.length,
    });

    // 4. 메타데이터 (데이터셋 설명)
    const meta = {
      exportedAt: new Date().toISOString(),
      description: "331매장관리 요식업 학습 데이터셋",
      dataset: {
        corrections: {
          file: `ocr-corrections-${today}.jsonl`,
          format: "JSONL",
          description: "OCR 원본→사용자 수정 쌍. 요식업 전표 인식 학습용.",
          records: corrections.length,
        },
        purchases: {
          file: `purchases-${today}.jsonl`,
          format: "JSONL",
          description: "사람이 검증한 요식업 식자재 매입 데이터. 품목명/단가/수량/거래처/날짜.",
          records: purchases.length,
        },
        profiles: {
          file: `profiles-items-${today}.json`,
          format: "JSON",
          description: "거래처별 OCR 프로파일 + 품목 마스터.",
          profiles: profiles.length,
          items: itemMaster.length,
        },
      },
      schema: {
        correction: "{ id, restaurantId, counterparty: {id, name}, imageUrl, original: [...items], corrected: [...items], createdAt }",
        purchase: "{ orderId, restaurant: {id, name}, counterparty: {id, name}, purchaseDate, status, totalAmount, items: [{rawName, standardName, quantity, unit, unitPrice, lineTotal, category}], createdAt }",
        profile: "{ counterpartyId, counterpartyName, documentType, columnOrder, frequentItems: [{name, avgPrice, unit}], sampleCount }",
      },
    };

    const metaResult = await uploadJsonFile(drive, folderId, "dataset-metadata.json", meta);
    results.push({
      name: "dataset-metadata.json",
      fileId: metaResult?.fileId,
      link: metaResult?.webViewLink,
      records: 1,
    });

    console.log(`[GDrive] 데이터셋 내보내기 완료: ${results.length}개 파일`);
    return { success: true, files: results };
  } catch (err: any) {
    console.error("[GDrive] 데이터셋 내보내기 실패:", err);
    return { success: false, files: results, error: err.message };
  }
}
