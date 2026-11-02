import { useEffect, useState } from 'react';
import { z } from 'zod';

let send: ((message: object) => void) | null = null;
const pending = new Map<string, (value: string | null) => void>();
export const connectEmbeds = (sender: (message: object) => void) => {
  send = sender;
};
export function receiveEmbed(input: unknown): boolean {
  const response = z
    .object({ kind: z.literal('embed-result'), id: z.uuid(), url: z.string().nullable() })
    .safeParse(input);
  if (!response.success) return false;
  pending.get(response.data.id)?.(response.data.url);
  pending.delete(response.data.id);
  return true;
}
/** 网页背景经宿主登记为能力票据。CSP 只开放这个背景的目标，不对主应用放开所有 iframe。 */
export function useEmbedUrl(url: string | null): string | null {
  const [result, setResult] = useState<{ original: string; value: string | null } | null>(null);
  useEffect(() => {
    if (!url || !send) return;
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      setResult({ original: url, value: null });
    }, 15000);
    pending.set(id, (value) => {
      clearTimeout(timer);
      setResult({ original: url, value });
    });
    send({ kind: 'embed', id, url });
    return () => {
      clearTimeout(timer);
      pending.delete(id);
    };
  }, [url]);
  return result?.original === url ? result.value : null;
}
