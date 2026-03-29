import fs from 'fs';

const BASE = 'https://restaurant-manager-production-a762.up.railway.app';

// Step 1: Upload image via /api/upload/order-image
const imageBuffer = fs.readFileSync('test-ocr.jpg');
const boundary = '----FormBoundary' + Date.now();

const parts = [
  `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="test-ocr.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
];
const bodyStart = Buffer.from(parts[0]);
const bodyEnd = Buffer.from(`\r\n--${boundary}--\r\n`);
const uploadBody = Buffer.concat([bodyStart, imageBuffer, bodyEnd]);

console.log(`[1/2] Uploading ${(imageBuffer.length / 1024 / 1024).toFixed(1)}MB image...`);
console.time('Upload');

const uploadRes = await fetch(`${BASE}/api/upload/order-image`, {
  method: 'POST',
  headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
  body: uploadBody,
});
console.timeEnd('Upload');

if (!uploadRes.ok) {
  console.error('Upload failed:', uploadRes.status, await uploadRes.text());
  process.exit(1);
}

const uploadData = await uploadRes.json();
console.log('Upload result:', uploadData);
const imageUrl = uploadData.url;

// Step 2: Call OCR API
console.log(`\n[2/2] Calling OCR API with imageUrl: ${imageUrl}`);
console.time('OCR');

const ocrRes = await fetch(`${BASE}/api/ocr/extract-purchase`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ imageUrl }),
});
console.timeEnd('OCR');

if (!ocrRes.ok) {
  console.error('OCR failed:', ocrRes.status, await ocrRes.text());
  process.exit(1);
}

const data = await ocrRes.json();

console.log('\n========================================');
console.log('       OCR 결과 (Phase 1 적용)');
console.log('========================================');
console.log(`거래처명: ${data.counterpartyName || '미추출'}`);
console.log(`문서유형: ${data.documentType || '미분류'}`);
console.log(`품목 수: ${data.items?.length || 0}`);
console.log('');

if (data.items && data.items.length > 0) {
  console.log('품목명           | 수량   | 단가     | 공급가액   | 신뢰도');
  console.log('-'.repeat(70));
  for (const item of data.items) {
    const name = (item.shortName || item.name || '?').slice(0, 15).padEnd(16);
    const qty = (item.quantity || '-').toString().padStart(6);
    const price = (item.unitPrice || '-').toString().padStart(8);
    const total = (item.lineTotal || '-').toString().padStart(10);
    const conf = (item.confidence || '?').padStart(6);
    console.log(`${name} | ${qty} | ${price} | ${total} | ${conf}`);
  }
}

if (data.summary) {
  console.log('');
  console.log(`합계 — 공급가액: ${data.summary.totalSupply || '-'}, 세액: ${data.summary.totalTax || '-'}, 총합계: ${data.summary.grandTotal || '-'}`);
}

if (data.note) {
  console.log(`비고: ${data.note}`);
}

console.log('\n=== RAW JSON ===');
console.log(JSON.stringify(data, null, 2));
