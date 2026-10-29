import { useEffect, useRef } from 'react';
import type { CrosshairConfig } from '@/lib/tool-contracts';

/** 准心是实际可配置的绘图工具；画布按DPR渲染，不用静态图伪装实时配置。 */
export function CrosshairCanvas({
  config,
  className = '',
}: {
  config: CrosshairConfig;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const image = new Image();
    let disposed = false;
    const paint = () => {
      if (disposed) return;
      const box = canvas.getBoundingClientRect();
      const context = canvas.getContext('2d');
      if (!context || !box.width || !box.height) return;
      const dpr = devicePixelRatio || 1;
      canvas.width = Math.round(box.width * dpr);
      canvas.height = Math.round(box.height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, box.width, box.height);
      context.translate(box.width / 2, box.height / 2);
      context.globalAlpha = config.opacity;
      if (config.shape === 'image') {
        if (image.complete && image.naturalWidth) {
          // 以最长边适配大小，避免细长图片超出准心窗口而被裁切。
          const scale = config.size / Math.max(image.naturalHeight, image.naturalWidth);
          const width = image.naturalWidth * scale;
          const height = image.naturalHeight * scale;
          context.drawImage(image, -width / 2, -height / 2, width, height);
        }
        return;
      }
      const stroke = (width: number, color: string) => {
        context.strokeStyle = color;
        context.fillStyle = color;
        context.lineWidth = width;
        context.lineCap = 'butt';
        context.beginPath();
        if (config.shape === 'circle' || config.shape === 'cross-circle')
          context.arc(0, 0, config.size / 2, 0, Math.PI * 2);
        if (config.shape === 'dot-box')
          context.rect(-config.size / 2, -config.size / 2, config.size, config.size);
        if (
          config.shape === 'cross' ||
          config.shape === 'cross-circle' ||
          config.shape === 'cross-dot'
        ) {
          const half = config.size / 2;
          context.moveTo(-config.gap - half, 0);
          context.lineTo(-config.gap, 0);
          context.moveTo(config.gap, 0);
          context.lineTo(config.gap + half, 0);
          context.moveTo(0, -config.gap - half);
          context.lineTo(0, -config.gap);
          context.moveTo(0, config.gap);
          context.lineTo(0, config.gap + half);
        }
        context.stroke();
        if (
          config.centerDot ||
          config.shape === 'dot' ||
          config.shape === 'cross-dot' ||
          config.shape === 'dot-box'
        ) {
          context.beginPath();
          const radius =
            config.shape === 'dot' ? config.size / 2 + (width - config.thickness) / 2 : width / 2;
          context.arc(0, 0, radius, 0, Math.PI * 2);
          context.fill();
        }
      };
      if (config.outline > 0) stroke(config.thickness + config.outline * 2, config.outlineColor);
      stroke(config.thickness, config.color);
    };
    image.onload = paint;
    image.onerror = paint;
    if (config.image) image.src = config.image;
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    paint();
    return () => {
      disposed = true;
      observer.disconnect();
      image.onload = null;
      image.onerror = null;
    };
  }, [config]);
  return <canvas ref={ref} className={className} aria-label="准心实时预览" />;
}
