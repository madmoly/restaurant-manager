import { useState, useEffect } from "react";

export type PlatformType = "ios" | "android" | "desktop" | "unknown";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
  prompt(): Promise<void>;
}

interface UsePWAInstallReturn {
  platform: PlatformType;
  isInstallable: boolean;
  isInstalled: boolean;
  isIOS: boolean;
  showIOSGuide: boolean;
  setShowIOSGuide: (v: boolean) => void;
  handleInstall: () => Promise<void>;
  dismissed: boolean;
  dismiss: () => void;
}

const DISMISSED_KEY = "pwa-install-dismissed";

export function usePWAInstall(): UsePWAInstallReturn {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY) === "true";
    } catch {
      return false;
    }
  });

  // 플랫폼 감지
  const platform: PlatformType = (() => {
    const ua = navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(ua)) return "ios";
    if (/android/.test(ua)) return "android";
    if (/windows|macintosh|linux/.test(ua)) return "desktop";
    return "unknown";
  })();

  const isIOS = platform === "ios";

  // 이미 설치(standalone) 여부 확인
  useEffect(() => {
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;
    setIsInstalled(isStandalone);
  }, []);

  // Android/Chrome: beforeinstallprompt 이벤트 캡처
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // 설치 완료 감지
    const installedHandler = () => setIsInstalled(true);
    window.addEventListener("appinstalled", installedHandler);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  // Service Worker 등록
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .catch((err) => console.warn("SW 등록 실패:", err));
    }
  }, []);

  const isInstallable = !isInstalled && !dismissed && (isIOS || !!deferredPrompt);

  const handleInstall = async () => {
    if (isIOS) {
      setShowIOSGuide(true);
      return;
    }
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        setIsInstalled(true);
      }
      setDeferredPrompt(null);
    }
  };

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, "true");
    } catch {
      // ignore
    }
  };

  return {
    platform,
    isInstallable,
    isInstalled,
    isIOS,
    showIOSGuide,
    setShowIOSGuide,
    handleInstall,
    dismissed,
    dismiss,
  };
}
