import React, { useRef, useEffect, useState, useImperativeHandle, forwardRef } from 'react';

interface HandwritingCanvasProps {
  width: string | number;
  height: number;
  color: string;
  radius: number;
  isHighlighter?: boolean;
  className?: string;
}

export interface HandwritingCanvasRef {
  clear: () => void;
  undo: () => void;
  getSaveData: () => string;
  loadSaveData: (data: string) => void;
}

const HandwritingCanvas = forwardRef<HandwritingCanvasRef, HandwritingCanvasProps>(({
  width,
  height,
  color,
  radius,
  isHighlighter = false,
  className
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [history, setHistory] = useState<string[]>([]);

  // Sync internal resolution with CSS size to fix offset
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateSize = () => {
      const rect = canvas.getBoundingClientRect();
      // Only update if size actually changed to avoid clearing canvas unnecessarily
      if (canvas.width !== rect.width || canvas.height !== rect.height) {
        // Save current content before resizing as resizing clears the canvas
        const tempData = canvas.toDataURL();
        canvas.width = rect.width;
        canvas.height = rect.height;
        
        // Restore content
        const img = new Image();
        img.src = tempData;
        img.onload = () => {
          const ctx = canvas.getContext('2d');
          if (ctx) ctx.drawImage(img, 0, 0);
        };
      }
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const getCoordinates = (e: React.PointerEvent | PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    
    const clientX = e.clientX;
    const clientY = e.clientY;

    // Since we synced internal width/height with rect.width/height, 
    // the coordinates are direct.
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  };

  const startDrawing = (e: React.PointerEvent | PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    if (!ctx) return;

    // Save current state to history
    setHistory(prev => [...prev, canvas.toDataURL()]);

    const { x, y } = getCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = radius * 2;
    
    if (color === 'transparent') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1.0;
      ctx.strokeStyle = '#ffffff';
    } else if (isHighlighter) {
      ctx.globalCompositeOperation = 'multiply'; // Better for highlighters to not obscure text
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = color === '#ffeb3b' ? 'rgba(255, 235, 59, 0.5)' : color;
      ctx.lineWidth = radius * 8;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1.0;
      ctx.strokeStyle = color;
    }

    setIsDrawing(true);
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const draw = (e: React.PointerEvent | PointerEvent) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { x, y } = getCoordinates(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = (e: React.PointerEvent | PointerEvent) => {
    setIsDrawing(false);
    if (e.pointerId !== undefined) {
      try {
        (e.target as Element).releasePointerCapture(e.pointerId);
      } catch (err) {
        // Ignore errors if pointer capture was already released
      }
    }
  };

  useImperativeHandle(ref, () => ({
    clear: () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setHistory([]);
    },
    undo: () => {
      if (history.length === 0) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const lastState = history[history.length - 1];
      const img = new Image();
      img.src = lastState;
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        setHistory(prev => prev.slice(0, -1));
      };
    },
    getSaveData: () => {
      return canvasRef.current?.toDataURL() || '';
    },
    loadSaveData: (data: string) => {
      if (!data) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const img = new Image();
      img.src = data;
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
      };
    }
  }));

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ 
        width: '100%', 
        height: `${height}px`, 
        touchAction: 'none',
        background: 'transparent',
        backgroundColor: 'transparent',
        display: 'block'
      }}
      onPointerDown={startDrawing}
      onPointerMove={draw}
      onPointerUp={stopDrawing}
      onPointerCancel={stopDrawing}
      onPointerOut={stopDrawing}
    />
  );
});

HandwritingCanvas.displayName = 'HandwritingCanvas';

export default HandwritingCanvas;
