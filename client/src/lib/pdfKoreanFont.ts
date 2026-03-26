/**
 * jsPDF 한글 폰트 로더
 * NanumGothic-Regular.ttf를 /fonts/에서 로드하여 jsPDF에 등록
 */
let cachedFont: string | null = null;

export async function loadKoreanFont(doc: any) {
  if (!cachedFont) {
    const res = await fetch("/fonts/NanumGothic-Regular.ttf");
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    cachedFont = btoa(binary);
  }
  doc.addFileToVFS("NanumGothic-Regular.ttf", cachedFont);
  doc.addFont("NanumGothic-Regular.ttf", "NanumGothic", "normal");
  doc.setFont("NanumGothic");
}
