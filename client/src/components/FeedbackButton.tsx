import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { X, Bug, Lightbulb, Image, Loader2 } from "lucide-react";
import { resizeImage } from "@/lib/imageResize";

type FeedbackType = "bug" | "suggestion";

const FEEDBACK_RESIZE = { maxSize: 1280, quality: 0.7, mimeType: "image/jpeg" } as const;

export default function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FeedbackType>("bug");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [screenshotName, setScreenshotName] = useState<string>("");
  const [resizing, setResizing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { selectedRestaurantId } = useRestaurant();

  const utils = trpc.useUtils();
  const submit = trpc.feedback.submit.useMutation({
    onSuccess: () => {
      setOpen(false);
      resetForm();
    },
  });

  const resetForm = () => {
    setType("bug");
    setTitle("");
    setContent("");
    setScreenshot(null);
    setScreenshotName("");
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setResizing(true);
    try {
      const resized = await resizeImage(file, FEEDBACK_RESIZE);
      const reader = new FileReader();
      reader.onload = (ev) => {
        setScreenshot(ev.target?.result as string);
        setScreenshotName(resized.name);
        setResizing(false);
      };
      reader.readAsDataURL(resized);
    } catch {
      setResizing(false);
    }
    e.target.value = "";
  };

  const handleSubmit = () => {
    if (!title.trim() || !content.trim()) return;
    submit.mutate({
      restaurantId: selectedRestaurantId ?? undefined,
      type,
      title: title.trim(),
      content: content.trim(),
      screenshotBase64: screenshot ?? undefined,
    });
  };

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-xl transition-all font-bold text-base"
        onClick={() => setOpen((v) => !v)}
        title="피드백 / 버그 제보"
      >
        !
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-[360px] bg-popover border border-border rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2">
            {/* 헤더 */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-sm font-semibold text-foreground">피드백 제보</span>
              <button
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              {/* 유형 탭 */}
              <div className="flex gap-2">
                <button
                  onClick={() => setType("bug")}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium border transition-all",
                    type === "bug"
                      ? "bg-destructive/10 text-destructive border-destructive/30"
                      : "border-border text-muted-foreground hover:bg-accent/50"
                  )}
                >
                  <Bug className="h-3.5 w-3.5" />
                  오류 신고
                </button>
                <button
                  onClick={() => setType("suggestion")}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium border transition-all",
                    type === "suggestion"
                      ? "bg-primary/10 text-primary border-primary/30"
                      : "border-border text-muted-foreground hover:bg-accent/50"
                  )}
                >
                  <Lightbulb className="h-3.5 w-3.5" />
                  개발 건의
                </button>
              </div>

              {/* 제목 */}
              <div>
                <input
                  type="text"
                  placeholder="제목 *"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground/50"
                />
              </div>

              {/* 내용 */}
              <div>
                <textarea
                  placeholder="내용을 입력하세요 *"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg outline-none focus:ring-2 focus:ring-primary/30 resize-none placeholder:text-muted-foreground/50"
                />
              </div>

              {/* 스크린샷 첨부 */}
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileChange}
                />
                {screenshot ? (
                  <div className="relative rounded-lg overflow-hidden border border-border">
                    <img
                      src={screenshot}
                      alt="첨부 스크린샷"
                      className="w-full max-h-32 object-cover"
                    />
                    <button
                      onClick={() => setScreenshot(null)}
                      className="absolute top-1 right-1 bg-background/80 rounded-full p-0.5 text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={resizing}
                    className="w-full flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground border border-dashed border-border rounded-lg hover:bg-accent/50 transition-colors disabled:opacity-50"
                  >
                    {resizing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Image className="h-3.5 w-3.5" />
                    )}
                    {resizing ? "이미지 처리 중..." : "스크린샷 첨부 (선택)"}
                  </button>
                )}
              </div>

              {/* 제출 */}
              <Button
                className="w-full"
                onClick={handleSubmit}
                disabled={!title.trim() || !content.trim() || submit.isPending}
              >
                {submit.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> 제출 중...</>
                ) : "제출하기"}
              </Button>

              {submit.isError && (
                <p className="text-xs text-destructive text-center">
                  제출 실패. 다시 시도해주세요.
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
