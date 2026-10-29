import { useEffect, useRef, useState } from 'react';
import { usePreferences } from '@/stores/preferences';
import { settingsAssetUrl } from '@/lib/desktop';
import { useWallpaper, DEFAULT_WALLPAPER } from './wallpaper';
import { useSettingsUi } from './ui-store';
import { useSettingsSnapshot } from './repository';
import { BackgroundVideo } from './BackgroundVideo';

/** 自有 WebGL 流光着色器。只在可见且允许动态效果时绘制；释放 shader、program 和 buffer。 */
function MrBackground({ color, reduce }: { color: string; reduce: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      powerPreference: 'low-power',
    });
    if (!gl) return;
    const shaders: WebGLShader[] = [];
    const create = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
    };
    const vertex = create(
      gl.VERTEX_SHADER,
      'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}',
    );
    const fragment = create(
      gl.FRAGMENT_SHADER,
      'precision mediump float;uniform vec2 r;uniform float t;uniform vec3 c;void main(){vec2 q=gl_FragCoord.xy/r;vec2 p=(q-.5)*vec2(r.x/r.y,1.);float f=0.;for(int i=0;i<3;i++){float k=float(i);float y=.24*sin(p.x*2.8+t*.18+k*2.)+.13*cos(p.x*5.-t*.14+k);f+=.012/(abs(p.y-y)+.018);}vec3 v=vec3(.025,.04,.08)+c*f*.65+vec3(.16,.08,.28)*pow(f*.5,2.);gl_FragColor=vec4(v,1.);}',
    );
    const program = gl.createProgram();
    const buffer = gl.createBuffer();
    if (!vertex || !fragment || !program || !buffer) {
      shaders.forEach((shader) => gl.deleteShader(shader));
      if (program) gl.deleteProgram(program);
      if (buffer) gl.deleteBuffer(buffer);
      return;
    }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const clock = gl.getUniformLocation(program, 't');
    const resolution = gl.getUniformLocation(program, 'r');
    const tint = gl.getUniformLocation(program, 'c');
    gl.uniform3f(
      tint,
      parseInt(color.slice(1, 3), 16) / 255,
      parseInt(color.slice(3, 5), 16) / 255,
      parseInt(color.slice(5, 7), 16) / 255,
    );
    let frame = 0;
    let previous = 0;
    let alive = true;
    const draw = (time: number) => {
      if (!alive) return;
      if (time - previous >= 33 && !document.hidden) {
        previous = time;
        canvas.width = Math.max(1, Math.round(canvas.clientWidth * 0.7));
        canvas.height = Math.max(1, Math.round(canvas.clientHeight * 0.7));
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(resolution, canvas.width, canvas.height);
        gl.uniform1f(clock, reduce ? 0 : time / 1000);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      if (!reduce) frame = requestAnimationFrame(draw);
    };
    const resume = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    document.addEventListener('visibilitychange', resume);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', resume);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      shaders.forEach((shader) => gl.deleteShader(shader));
    };
  }, [color, reduce]);
  return <canvas ref={ref} className="settings-mr" aria-hidden="true" />;
}
export function Background({ accent, preview = false }: { accent: string; preview?: boolean }) {
  const ui = useSettingsUi();
  const legacy = useWallpaper();
  const snapshot = useSettingsSnapshot();
  const motion = usePreferences((state) => state.motion);
  const [index, setIndex] = useState(0);
  const [systemReduced, setSystemReduced] = useState(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setSystemReduced(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  const reduce = motion === 'reduce' || systemReduced;
  const images = snapshot.data?.assets.filter((asset) => asset.kind === 'image') ?? [];
  const presets = ['island', 'sky', 'mint', 'night'] as const;
  const count = ui.backgroundMode === 'preset' ? presets.length : images.length;
  useEffect(() => {
    if (
      !ui.carousel ||
      count < 2 ||
      reduce ||
      !['image', 'preset', 'legacy'].includes(ui.backgroundMode)
    )
      return;
    const timer = setInterval(() => {
      if (!document.hidden) setIndex((value) => value + 1);
    }, ui.carouselSeconds * 1000);
    return () => clearInterval(timer);
  }, [ui.carousel, ui.carouselSeconds, count, reduce, ui.backgroundMode]);
  const asset =
    ui.carousel && images.length > 0 && ['image', 'legacy'].includes(ui.backgroundMode)
      ? images[index % images.length]
      : snapshot.data?.assets.find((asset) => asset.id === ui.backgroundAsset);
  const url = asset ? settingsAssetUrl(asset.id) : null;
  const mode = ui.backgroundMode;
  const preset =
    ui.carousel && mode === 'preset' ? (presets[index % presets.length] ?? ui.preset) : ui.preset;
  return (
    <div
      className={`home-wallpaper settings-background ${preview ? 'settings-background-preview' : ''} preset-${preset}`}
      style={{
        filter: ui.backgroundBlur ? `blur(${ui.backgroundBlur}px)` : undefined,
        backgroundImage:
          ui.carousel && mode === 'legacy' && url
            ? `url("${url}")`
            : mode === 'legacy'
              ? `url("${legacy.url ?? DEFAULT_WALLPAPER}")`
              : mode === 'preset' && preset === 'island'
                ? `url("${DEFAULT_WALLPAPER}")`
                : mode === 'image' && url
                  ? `url("${url}")`
                  : mode === 'video' || mode === 'image'
                    ? `url("${DEFAULT_WALLPAPER}")`
                    : undefined,
      }}
      aria-hidden={preview ? undefined : true}
    >
      {mode === 'video' && asset?.kind === 'video' && url && (
        <BackgroundVideo key={url} url={url} reduce={reduce} />
      )}
      {mode === 'mr' && (
        <MrBackground color={ui.mrColorMode === 'custom' ? ui.mrColor : accent} reduce={reduce} />
      )}
    </div>
  );
}
