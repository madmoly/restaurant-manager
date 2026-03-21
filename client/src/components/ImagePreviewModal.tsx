import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X, ExternalLink, ZoomIn, ZoomOut } from "lucide-react";
import { useState } from "react";

interface ImagePreviewModalProps {
  url: string | null;
  onClose: () => void;
}

export function ImagePreviewModal({ url, onClose }: ImagePreviewModalProps) {
  const [scale, setScale] = useState(1);

  if (!url) return null;

  return (
    <Dialog open={!!url} onOpenChange={(open) => { if (!open) { onClose(); setScale(1); } }}>
      <DialogContent className="max-w-3xl w-full p-0 overflow-hidden bg-black/95 border-border/30">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/30 bg-card/60">
          <span className="text-xs text-muted-foreground">영수증 미리보기</span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setScale(s => Math.max(0.5, s - 0.25))}
              disabled={scale <= 0.5}
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs text-muted-foreground w-10 text-center">{Math.round(scale * 100)}%</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setScale(s => Math.min(3, s + 0.25))}
              disabled={scale >= 3}
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => window.open(url, "_blank")}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => { onClose(); setScale(1); }}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* 이미지 영역 */}
        <div
          className="overflow-auto flex items-center justify-center"
          style={{ maxHeight: "80vh", minHeight: "300px" }}
        >
          <img
            src={url}
            alt="영수증"
            style={{
              transform: `scale(${scale})`,
              transformOrigin: "center center",
              transition: "transform 0.2s ease",
              maxWidth: "100%",
              display: "block",
            }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
