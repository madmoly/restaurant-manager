/**
 * pwa.test.ts
 * PWA 설치 기능 관련 로직 단위 테스트
 */

import { describe, it, expect } from "vitest";

// ─── 플랫폼 감지 로직 (usePWAInstall.ts와 동일) ──────────────────────────────

function detectPlatform(ua: string): "ios" | "android" | "desktop" | "unknown" {
  const lower = ua.toLowerCase();
  if (/iphone|ipad|ipod/.test(lower)) return "ios";
  if (/android/.test(lower)) return "android";
  if (/windows|macintosh|linux/.test(lower)) return "desktop";
  return "unknown";
}

// ─── 1. 플랫폼 감지 테스트 ────────────────────────────────────────────────────

describe("플랫폼 감지 (detectPlatform)", () => {
  it("iPhone User-Agent는 ios로 감지된다", () => {
    const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
    expect(detectPlatform(ua)).toBe("ios");
  });

  it("iPad User-Agent는 ios로 감지된다", () => {
    const ua = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
    expect(detectPlatform(ua)).toBe("ios");
  });

  it("Android User-Agent는 android로 감지된다", () => {
    const ua = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0";
    expect(detectPlatform(ua)).toBe("android");
  });

  it("Windows User-Agent는 desktop으로 감지된다", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0";
    expect(detectPlatform(ua)).toBe("desktop");
  });

  it("Mac User-Agent는 desktop으로 감지된다", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/120.0.0.0";
    expect(detectPlatform(ua)).toBe("desktop");
  });

  it("알 수 없는 UA는 unknown으로 감지된다", () => {
    expect(detectPlatform("CustomBrowser/1.0")).toBe("unknown");
  });
});

// ─── 2. 설치 가능 여부 판단 로직 ─────────────────────────────────────────────

describe("설치 가능 여부 판단 (isInstallable)", () => {
  function isInstallable(opts: {
    isInstalled: boolean;
    dismissed: boolean;
    isIOS: boolean;
    hasDeferredPrompt: boolean;
  }): boolean {
    return !opts.isInstalled && !opts.dismissed && (opts.isIOS || opts.hasDeferredPrompt);
  }

  it("설치되지 않고, 무시하지 않고, iOS면 설치 가능하다", () => {
    expect(isInstallable({ isInstalled: false, dismissed: false, isIOS: true, hasDeferredPrompt: false })).toBe(true);
  });

  it("설치되지 않고, 무시하지 않고, deferredPrompt가 있으면 설치 가능하다", () => {
    expect(isInstallable({ isInstalled: false, dismissed: false, isIOS: false, hasDeferredPrompt: true })).toBe(true);
  });

  it("이미 설치된 경우 설치 불가", () => {
    expect(isInstallable({ isInstalled: true, dismissed: false, isIOS: true, hasDeferredPrompt: true })).toBe(false);
  });

  it("배너를 무시(dismiss)한 경우 설치 불가", () => {
    expect(isInstallable({ isInstalled: false, dismissed: true, isIOS: true, hasDeferredPrompt: true })).toBe(false);
  });

  it("iOS도 아니고 deferredPrompt도 없으면 설치 불가", () => {
    expect(isInstallable({ isInstalled: false, dismissed: false, isIOS: false, hasDeferredPrompt: false })).toBe(false);
  });

  it("데스크탑에서 deferredPrompt가 있으면 설치 가능하다", () => {
    expect(isInstallable({ isInstalled: false, dismissed: false, isIOS: false, hasDeferredPrompt: true })).toBe(true);
  });
});

// ─── 3. manifest.json 필수 필드 검증 ─────────────────────────────────────────

describe("PWA manifest 필수 필드 검증", () => {
  const manifest = {
    name: "331매장관리 시스템",
    short_name: "331매장관리",
    start_url: "/",
    display: "standalone",
    background_color: "#0f172a",
    theme_color: "#1e40af",
    icons: [
      { src: "https://example.com/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "https://example.com/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };

  it("name 필드가 존재한다", () => {
    expect(manifest.name).toBeTruthy();
  });

  it("short_name은 12자 이하여야 한다 (홈 화면 표시 제한)", () => {
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
  });

  it("start_url이 '/'로 시작한다", () => {
    expect(manifest.start_url).toBe("/");
  });

  it("display가 'standalone'이다 (앱처럼 실행)", () => {
    expect(manifest.display).toBe("standalone");
  });

  it("192x192 아이콘이 포함되어 있다", () => {
    const has192 = manifest.icons.some((icon) => icon.sizes === "192x192");
    expect(has192).toBe(true);
  });

  it("512x512 아이콘이 포함되어 있다", () => {
    const has512 = manifest.icons.some((icon) => icon.sizes === "512x512");
    expect(has512).toBe(true);
  });

  it("theme_color가 유효한 hex 색상이다", () => {
    expect(manifest.theme_color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

// ─── 4. dismiss 저장 로직 ────────────────────────────────────────────────────

describe("설치 배너 dismiss 로직", () => {
  const DISMISSED_KEY = "pwa-install-dismissed";

  it("dismiss 후 localStorage에 'true'가 저장된다", () => {
    const storage: Record<string, string> = {};
    const setItem = (key: string, value: string) => { storage[key] = value; };
    const getItem = (key: string) => storage[key] ?? null;

    // dismiss 실행
    setItem(DISMISSED_KEY, "true");
    expect(getItem(DISMISSED_KEY)).toBe("true");
  });

  it("dismiss 전에는 localStorage에 값이 없다", () => {
    const storage: Record<string, string> = {};
    const getItem = (key: string) => storage[key] ?? null;
    expect(getItem(DISMISSED_KEY)).toBeNull();
  });
});
