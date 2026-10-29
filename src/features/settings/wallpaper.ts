import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

// IndexedDB 的物理标识保留兼容，避免改名丢失用户已经导入的壁纸；界面仅使用新品牌。
const DATABASE = 'xinjing.appearance';
const STORE = 'wallpaper';
const KEY = 'current';
const QUERY_KEY = ['appearance', 'wallpaper'] as const;
// 使用原始上传图片；独立 URL 避免升级后继续命中旧壁纸缓存。
export const DEFAULT_WALLPAPER = '/assets/settings/default-wallpaper.png';
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** 文件先限大小/类型，再真正解码检查像素，SVG和伪装的图片不会进入持久层。 */
export async function validateWallpaper(file: Blob): Promise<Blob> {
  if (!ALLOWED_TYPES.has(file.type)) throw new Error('请选择 PNG、JPEG 或 WebP 图片');
  if (!file.size || file.size > MAX_BYTES) throw new Error('壁纸大小不能超过 8 MB');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('图片无法读取，请选择完整有效的图片');
  }
  try {
    if (bitmap.width < 320 || bitmap.height < 180) throw new Error('图片尺寸至少为 320 × 180');
    if (bitmap.width * bitmap.height > 24_000_000) throw new Error('图片像素不能超过 2400 万');
  } finally {
    bitmap.close();
  }
  return file;
}

/** 仅操作当前源的固定IndexedDB。桌面WebView数据目录由Rust置于当前用户数据目录。
 * 大图片不写localStorage，也不保存用户源文件路径；事务提交后才报告成功。
 */
function wallpaperTransaction(mode: 'read'): Promise<Blob | null>;
function wallpaperTransaction(mode: 'write', image: Blob | null): Promise<Blob | null>;
function wallpaperTransaction(mode: 'read' | 'write', image?: Blob | null): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(DATABASE, 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore(STORE);
    opening.onerror = () => reject(new Error('本地壁纸存储无法打开'));
    opening.onblocked = () => reject(new Error('壁纸存储正在被其他窗口占用，请重试'));
    opening.onsuccess = () => {
      const database = opening.result;
      database.onversionchange = () => database.close();
      const transaction = database.transaction(STORE, mode === 'read' ? 'readonly' : 'readwrite');
      const store = transaction.objectStore(STORE);
      let result: Blob | null = image ?? null;
      if (mode === 'read') {
        const request = store.get(KEY);
        request.onsuccess = () => {
          const value: unknown = request.result;
          // 浏览器存储也属于输入边界；损坏/旧格式不拿来创建资源URL。
          result =
            value instanceof Blob && ALLOWED_TYPES.has(value.type) && value.size <= MAX_BYTES
              ? value
              : null;
        };
      } else if (image) store.put(image, KEY);
      else store.delete(KEY);
      transaction.oncomplete = () => {
        database.close();
        resolve(result);
      };
      transaction.onabort = () => {
        database.close();
        reject(new Error('壁纸保存失败，请检查 目标磁盘空间后重试'));
      };
      transaction.onerror = () => {
        /* 统一由onabort结束Promise，避免重复反馈。 */
      };
    };
  });
}

export function useWallpaper() {
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const image = await wallpaperTransaction('read');
      if (image) await validateWallpaper(image);
      return wallpaperResource(image);
    },
    staleTime: Infinity,
    retry: false,
  });
  return { ...query, url: query.data?.url ?? null, custom: Boolean(query.data) };
}

/** 资源只在共享Query中解码一次。使用现有CSP允许的data图片，无需扩展协议或持有Blob URL。 */
function wallpaperResource(image: Blob | null): Promise<{ image: Blob; url: string } | null> {
  if (!image) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('图片读取失败，请重新选择'));
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve({ image, url: reader.result })
        : reject(new Error('图片格式无法读取'));
    reader.readAsDataURL(image);
  });
}

export function useWallpaperMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (image: Blob | null) => {
      if (image) await validateWallpaper(image);
      const resource = await wallpaperResource(image);
      await wallpaperTransaction('write', image);
      return resource;
    },
    onSuccess: (image) => client.setQueryData(QUERY_KEY, image),
  });
}
