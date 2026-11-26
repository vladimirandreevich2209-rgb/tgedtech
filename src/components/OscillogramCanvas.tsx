import { useEffect, useMemo, useRef, useState } from 'react';
import { extractNormalizedWaveform } from '../utils/audioEngine';

interface OscillogramCanvasProps {
  buffer: AudioBuffer | null;
  color: string;
  playheadProgress: number | null;
  ariaLabel: string;
  className?: string;
}

export function OscillogramCanvas({
  buffer,
  color,
  playheadProgress,
  ariaLabel,
  className,
}: OscillogramCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ width: 320, height: 84 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setSize({
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
    };

    updateSize();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateSize);
      observer.observe(el);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const bucketCount = useMemo(() => {
    return Math.max(48, Math.min(120, Math.floor(size.width / 3.5)));
  }, [size.width]);

  const peaks = useMemo(() => {
    if (!buffer) return null;
    return extractNormalizedWaveform(buffer, bucketCount);
  }, [buffer, bucketCount]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const { width, height } = size;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, width, height);

    const midY = height / 2;

    // Dark instrument grid & axis lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    [height * 0.25, height * 0.75].forEach((yLine) => {
      ctx.beginPath();
      ctx.moveTo(0, yLine);
      ctx.lineTo(width, yLine);
      ctx.stroke();
    });

    if (!peaks || peaks.length === 0) {
      return;
    }

    const padX = 6;
    const drawWidth = Math.max(10, width - padX * 2);
    const step = drawWidth / peaks.length;
    const barWidth = Math.max(1.5, step * 0.62);
    const maxHalfHeight = Math.max(8, (height - 10) / 2);

    for (let i = 0; i < peaks.length; i++) {
      const norm = peaks[i];
      const x = padX + i * step + (step - barWidth) / 2;
      const barHalf = Math.max(1.5, norm * maxHalfHeight);
      const ratio = i / peaks.length;

      if (playheadProgress !== null) {
        ctx.globalAlpha = ratio <= playheadProgress ? 1 : 0.32;
      } else {
        ctx.globalAlpha = 0.92;
      }

      ctx.fillStyle = color;
      const radius = Math.min(barWidth / 2, barHalf);
      const y = midY - barHalf;
      const h = barHalf * 2;

      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, h, radius);
        ctx.fill();
      } else {
        ctx.fillRect(x, y, barWidth, h);
      }
    }

    ctx.globalAlpha = 1;

    // Glowing pure white playhead cursor during playback
    if (playheadProgress !== null) {
      const clamped = Math.max(0, Math.min(1, playheadProgress));
      const cursorX = padX + clamped * drawWidth;

      ctx.save();
      ctx.shadowColor = 'rgba(255, 255, 255, 0.8)';
      ctx.shadowBlur = 7;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      ctx.moveTo(cursorX, 4);
      ctx.lineTo(cursorX, height - 4);
      ctx.stroke();

      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(cursorX, 5, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }, [peaks, size, color, playheadProgress]);

  return (
    <div
      ref={containerRef}
      className={`w-full ${className ?? 'h-[84px]'} bg-[#121417] border border-[#242830] rounded-xl overflow-hidden relative shadow-[inset_0_2px_6px_rgba(0,0,0,0.45)]`}
    >
      <canvas
        ref={canvasRef}
        aria-label={ariaLabel}
        className="w-full h-full block"
      />
      {!buffer && (
        <div className="absolute inset-0 flex items-center justify-center font-mono text-[11px] text-[#8E939C]">
          Нет аудиоданных
        </div>
      )}
    </div>
  );
}
