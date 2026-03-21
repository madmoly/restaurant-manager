import { X, Download, Share, Plus, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePWAInstall } from "@/hooks/usePWAInstall";

/**
 * PWA 설치 배너 + iOS 안내 모달
 * - Android/Chrome: 시스템 설치 프롬프트 직접 호출
 * - iOS Safari: "공유 → 홈 화면에 추가" 단계별 안내 모달 표시
 */
export default function PWAInstallBanner() {
  const {
    isInstallable,
    isInstalled,
    isIOS,
    showIOSGuide,
    setShowIOSGuide,
    handleInstall,
    dismiss,
  } = usePWAInstall();

  // 이미 설치됐거나 설치 불가 상태면 렌더링 안 함
  if (isInstalled || !isInstallable) return null;

  return (
    <>
      {/* ── 설치 배너 ── */}
      <div className="w-full max-w-sm mx-auto mt-4">
        <div className="relative flex items-center gap-3 bg-blue-600/20 border border-blue-500/40 rounded-xl px-4 py-3 backdrop-blur-sm">
          {/* 닫기 버튼 */}
          <button
            onClick={dismiss}
            className="absolute top-2 right-2 text-slate-400 hover:text-white transition-colors"
            aria-label="닫기"
          >
            <X className="h-3.5 w-3.5" />
          </button>

          {/* 앱 아이콘 */}
          <div className="shrink-0 w-10 h-10 rounded-xl overflow-hidden shadow-md">
            <img
              src="https://d2xsxph8kpxj0f.cloudfront.net/310419663031044213/VWwsDsrDboxSq6Vq86apBK/pwa-icon-192-nLY87ZffJ3sr4TD573336v.png"
              alt="앱 아이콘"
              className="w-full h-full object-cover"
            />
          </div>

          {/* 텍스트 */}
          <div className="flex-1 min-w-0 pr-4">
            <p className="text-white text-xs font-semibold leading-tight">홈 화면에 앱 추가</p>
            <p className="text-slate-300 text-[11px] mt-0.5 leading-tight">
              {isIOS
                ? "Safari에서 홈 화면에 추가하세요"
                : "앱처럼 빠르게 실행할 수 있어요"}
            </p>
          </div>

          {/* 설치 버튼 */}
          <Button
            size="sm"
            onClick={handleInstall}
            className="shrink-0 h-7 px-3 text-xs bg-blue-600 hover:bg-blue-700 text-white font-medium"
          >
            {isIOS ? (
              <><Share className="h-3 w-3 mr-1" />안내</>
            ) : (
              <><Download className="h-3 w-3 mr-1" />설치</>
            )}
          </Button>
        </div>
      </div>

      {/* ── iOS 안내 모달 ── */}
      {showIOSGuide && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setShowIOSGuide(false)}
        >
          <div
            className="w-full max-w-sm bg-slate-800 border border-slate-700 rounded-2xl p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 헤더 */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg overflow-hidden">
                  <img
                    src="https://d2xsxph8kpxj0f.cloudfront.net/310419663031044213/VWwsDsrDboxSq6Vq86apBK/pwa-icon-192-nLY87ZffJ3sr4TD573336v.png"
                    alt="앱 아이콘"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div>
                  <p className="text-white text-sm font-semibold">홈 화면에 추가</p>
                  <p className="text-slate-400 text-xs">331매장관리 시스템</p>
                </div>
              </div>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* 안내 단계 */}
            <div className="space-y-3 mb-5">
              <div className="flex items-start gap-3">
                <div className="shrink-0 w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
                  1
                </div>
                <div className="flex-1">
                  <p className="text-white text-sm font-medium">Safari 하단 공유 버튼 탭</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <div className="flex items-center justify-center w-6 h-6 bg-blue-500/20 rounded border border-blue-500/40">
                      <Share className="h-3.5 w-3.5 text-blue-400" />
                    </div>
                    <p className="text-slate-400 text-xs">화면 하단 중앙의 네모+화살표 아이콘</p>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="shrink-0 w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
                  2
                </div>
                <div className="flex-1">
                  <p className="text-white text-sm font-medium">스크롤 후 "홈 화면에 추가" 선택</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <div className="flex items-center justify-center w-6 h-6 bg-slate-600/50 rounded border border-slate-500/40">
                      <Plus className="h-3.5 w-3.5 text-slate-300" />
                    </div>
                    <p className="text-slate-400 text-xs">공유 메뉴에서 아래로 스크롤</p>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="shrink-0 w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
                  3
                </div>
                <div className="flex-1">
                  <p className="text-white text-sm font-medium">오른쪽 상단 "추가" 탭</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <div className="flex items-center justify-center w-6 h-6 bg-slate-600/50 rounded border border-slate-500/40">
                      <Smartphone className="h-3.5 w-3.5 text-slate-300" />
                    </div>
                    <p className="text-slate-400 text-xs">앱 이름 확인 후 추가 버튼 탭</p>
                  </div>
                </div>
              </div>
            </div>

            {/* 시각적 힌트 */}
            <div className="bg-slate-700/50 rounded-xl p-3 mb-4">
              <p className="text-slate-300 text-xs text-center leading-relaxed">
                설치 후 홈 화면에서 <span className="text-white font-medium">331매장관리</span> 아이콘을 탭하면<br />
                앱처럼 전체 화면으로 실행됩니다
              </p>
            </div>

            <Button
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium"
              onClick={() => setShowIOSGuide(false)}
            >
              확인했어요
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
