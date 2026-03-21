import "dotenv/config";
import express from "express";
import multer from "multer";
import { startContractExpiryScheduler } from "../contractExpiryScheduler";
import { generatePdfFromHtml } from "../pdfGenerator";
import { getDb } from "../db";
import { employmentElectronicContracts, restaurants } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { generateContractHtml } from "../routers/electronicContracts";
import { generateMonthlyReportHtml } from "../monthlyReportHtml";
import {
  getMonthlySalesTotal,
  getMonthlyPurchasesTotal,
  getMonthlyFixedCostsTotal,
  calculateMonthlyLaborCost,
  calculateMonthlyLaborCostByUser,
  getFixedCostsByCategory,
  getRestaurantById,
} from "../db";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // PDF 다운로드 엔드포인트 (토큰 기반, 공개)
  app.get("/api/contract/pdf/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const db = await getDb();
      if (!db) { res.status(500).json({ error: "DB 연결 실패" }); return; }

      const [row] = await db.select({
        contract: employmentElectronicContracts,
        restaurantName: restaurants.name,
      })
        .from(employmentElectronicContracts)
        .leftJoin(restaurants, eq(employmentElectronicContracts.restaurantId, restaurants.id))
        .where(eq(employmentElectronicContracts.token, token));

      if (!row) { res.status(404).json({ error: "계약서를 찾을 수 없습니다" }); return; }

      const html = generateContractHtml(row.contract, row.restaurantName ?? "");
      const pdfBuffer = await generatePdfFromHtml(html);

      const filename = encodeURIComponent(`근로계약서_${row.contract.employeeName}_${String(row.contract.contractStart).slice(0, 10)}.pdf`);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${filename}`);
      res.send(pdfBuffer);
    } catch (err) {
      console.error("[PDF] 생성 오류:", err);
      res.status(500).json({ error: "PDF 생성 중 오류가 발생했습니다" });
    }
  });

  // 월별 정산 리포트 PDF 다운로드 (세션 쿠키 인증)
  app.get("/api/report/monthly-pdf/:restaurantId/:year/:month", async (req, res) => {
    try {
      const { sdk } = await import("./sdk");
      const user = await sdk.authenticateRequest(req).catch(() => null);
      if (!user) { res.status(401).json({ error: "로그인이 필요합니다" }); return; }
      const restaurantId = parseInt(req.params.restaurantId);
      const year = parseInt(req.params.year);
      const month = parseInt(req.params.month);
      if (isNaN(restaurantId) || isNaN(year) || isNaN(month)) {
        res.status(400).json({ error: "잘못된 파라미터" }); return;
      }
      const monthStr = `${year}-${String(month).padStart(2, "0")}`;
      const [salesTotal, purchasesTotal, fixedCostsTotal, laborCost, restaurant, laborByUser, fixedByCategory] = await Promise.all([
        getMonthlySalesTotal(restaurantId, year, month),
        getMonthlyPurchasesTotal(restaurantId, year, month),
        getMonthlyFixedCostsTotal(restaurantId, monthStr),
        calculateMonthlyLaborCost(restaurantId, year, month),
        getRestaurantById(restaurantId),
        calculateMonthlyLaborCostByUser(restaurantId, year, month),
        getFixedCostsByCategory(restaurantId, monthStr),
      ]);
      if (!restaurant) { res.status(404).json({ error: "매장을 찾을 수 없습니다" }); return; }
      const totalCost = purchasesTotal + fixedCostsTotal + laborCost;
      const profit = salesTotal - totalCost;
      const costRatio = salesTotal > 0 ? (totalCost / salesTotal) * 100 : 0;
      const laborRatio = salesTotal > 0 ? (laborCost / salesTotal) * 100 : 0;
      const purchaseRatio = salesTotal > 0 ? (purchasesTotal / salesTotal) * 100 : 0;
      const fixedRatio = salesTotal > 0 ? (fixedCostsTotal / salesTotal) * 100 : 0;
      const html = generateMonthlyReportHtml({
        restaurantName: restaurant.name,
        year, month,
        salesTotal, purchasesTotal, fixedCostsTotal, laborCost, totalCost, profit,
        costRatio, laborRatio, purchaseRatio, fixedRatio,
        targetCostRatio: parseFloat(restaurant.targetCostRatio ?? "80"),
        targetLaborRatio: parseFloat(restaurant.targetLaborRatio ?? "30"),
        monthlyTargetSales: parseFloat(restaurant.monthlyTargetSales ?? "0"),
        laborByUser,
        fixedByCategory,
      });
      const pdfBuffer = await generatePdfFromHtml(html);
      const filename = encodeURIComponent(`${restaurant.name}_${year}년${month}월_정산리포트.pdf`);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${filename}`);
      res.send(pdfBuffer);
    } catch (err) {
      console.error("[MonthlyReport] PDF 생성 오류:", err);
      res.status(500).json({ error: "PDF 생성 중 오류가 발생했습니다" });
    }
  });

  // ─── 영수증 / 파일 업로드 엔드포인트 (multipart/form-data → S3) ───────────
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
  app.post("/api/upload", upload.single("file"), async (req, res) => {
    try {
      const { sdk } = await import("./sdk");
      const user = await sdk.authenticateRequest(req).catch(() => null);
      if (!user) { res.status(401).json({ error: "로그인이 필요합니다" }); return; }
      if (!req.file) { res.status(400).json({ error: "파일이 없습니다" }); return; }
      const { storagePut } = await import("../storage");
      const ext = req.file.originalname.split(".").pop() ?? "bin";
      const randomSuffix = Math.random().toString(36).slice(2, 10);
      const key = `receipts/${user.id}/${Date.now()}-${randomSuffix}.${ext}`;
      const { url } = await storagePut(key, req.file.buffer, req.file.mimetype);
      res.json({ url });
    } catch (err) {
      console.error("[Upload] 오류:", err);
      res.status(500).json({ error: "파일 업로드 중 오류가 발생했습니다" });
    }
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    // 계약 만료 알림 스케줄러 시작 (D-90, D-60, D-30, D-7)
    startContractExpiryScheduler();
  });
}

startServer().catch(console.error);
