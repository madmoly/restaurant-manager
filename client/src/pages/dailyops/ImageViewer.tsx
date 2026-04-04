import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ZoomIn, ZoomOut, X } from 'lucide-react';

export function ImageViewer({ src, onClose }: { src: string; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const lastTouchDist = useRef<number | null>(null);
  const imgRef = useRef<HTMLDivElement>(null);

  const zoomIn = () => setScale(s => Math.min(s + 0.5, 5));
  const zoomOut = () => { setScale(s => { const ns = Math.max(s - 0.5, 1); if (ns === 1) setPos({ x: 0, y: 0 }); return ns; }); };
  const resetZoom = () => { setScale(1); setPos({ x: 0, y: 0 }); };

  const onMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return;
    e.preventDefault();
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, posX: pos.x, posY: pos.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setPos({ x: dragStart.current.posX + (e.clientX - dragStart.current.x), y: dragStart.current.posY + (e.clientY - dragStart.current.y) });
  };
  const onMouseUp = () => setDragging(false);

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchDist.current = Math.sqrt(dx * dx + dy * dy);
    } else if (e.touches.length === 1 && scale > 1) {
      dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, posX: pos.x, posY: pos.y };
      setDragging(true);
    }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && lastTouchDist.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const delta = (dist - lastTouchDist.current) * 0.01;
      setScale(s => Math.min(Math.max(s + delta, 1), 5));
      lastTouchDist.current = dist;
    } else if (e.touches.length === 1 && dragging) {
      setPos({ x: dragStart.current.posX + (e.touches[0].clientX - dragStart.current.x), y: dragStart.current.posY + (e.touches[0].clientY - dragStart.current.y) });
    }
  };
  const onTouchEnd = () => { lastTouchDist.current = null; setDragging(false); };

  const onDoubleClick = () => { if (scale > 1) resetZoom(); else setScale(2.5); };

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/95 flex flex-col" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex items-center justify-between px-3 py-2 bg-black/60 backdrop-blur-sm z-10">
        <div className="flex items-center gap-1">
          <button onClick={zoomOut} className="p-2 rounded-lg bg-white/10 active:bg-white/20 text-white disabled:opacity-30" disabled={scale <= 1}>
            <ZoomOut className="w-5 h-5" />
          </button>
          <button onClick={resetZoom} className="px-3 py-1.5 rounded-lg bg-white/10 active:bg-white/20 text-white text-xs font-mono min-w-[48px] text-center">
            {Math.round(scale * 100)}%
          </button>
          <button onClick={zoomIn} className="p-2 rounded-lg bg-white/10 active:bg-white/20 text-white disabled:opacity-30" disabled={scale >= 5}>
            <ZoomIn className="w-5 h-5" />
          </button>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg bg-white/10 active:bg-white/20 text-white">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div
        ref={imgRef}
        className="flex-1 flex items-center justify-center overflow-hidden select-none"
        style={{ cursor: scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in', touchAction: 'none' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onDoubleClick={onDoubleClick}
      >
        <img
          src={src}
          alt="확대 이미지"
          className="max-w-full max-h-full object-contain transition-transform duration-100"
          style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`, transformOrigin: 'center center' }}
          draggable={false}
        />
      </div>
      {scale <= 1 && (
        <p className="text-center text-white/40 text-[10px] py-1.5">더블탭으로 확대 · 핀치로 줌</p>
      )}
    </div>,
    document.body
  );
}
