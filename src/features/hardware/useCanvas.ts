import { useEffect, useRef } from 'react';

/** Canvas按CSS尺寸与DPR同步：缩放不模糊，ResizeObserver、字体就绪回调均受卸载保护。 */
export function useCanvas(
  draw: (context: CanvasRenderingContext2D, width: number, height: number) => void,
) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let disposed = false;
    const paint = () => {
      if (disposed) return;
      const { width, height } = canvas.getBoundingClientRect();
      const context = canvas.getContext('2d');
      if (!context || !width || !height) return;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      draw(context, width, height);
    };
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    paint();
    void document.fonts.ready.then(paint).catch(() => {
      /* 字体失败时保留系统字体绘制结果。 */
    });
    window.addEventListener('resize', paint);
    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener('resize', paint);
    };
  }, [draw]);
  return ref;
}
