import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { faMusic } from '@fortawesome/free-solid-svg-icons';
import { Icon } from '@/features/home/components/Icon';
import type { MusicTrack } from '@/lib/music-contracts';
import { musicEngine } from './engine';

type CoverTrack = Pick<MusicTrack, 'title' | 'cover'> &
  Partial<Pick<MusicTrack, 'id' | 'provider'>>;
export function MusicCover({
  track,
  large = false,
  kind = 'track',
}: {
  track: CoverTrack | null;
  large?: boolean;
  kind?: 'track' | 'collection';
}) {
  const [failed, setFailed] = useState<string | null>(null),
    [loaded, setLoaded] = useState<string | null>(null);
  const identity = `${track?.provider}:${track?.id}:${kind}:${track?.cover ?? ''}`;
  const online = track?.provider && track.provider !== 'local' && track.id;
  // 只有封面缺失/失败才重新查询详情，同一封面在列表、详情、播放条共享请求与结果。
  const refreshed = useQuery({
    queryKey: ['music', 'cover', identity],
    enabled: Boolean(online && (!track?.cover || failed === identity)),
    queryFn: () =>
      musicEngine(
        'refreshCover',
        [track?.provider, track?.id, kind],
        z.object({ cover: z.string().nullable() }).strict(),
      ),
    retry: 1,
    staleTime: 15 * 60_000,
    gcTime: 20 * 60_000,
  });
  const src = refreshed.data?.cover || track?.cover;
  const version = `${identity}:${refreshed.dataUpdatedAt}`;
  const [failedVersion, setFailedVersion] = useState<string | null>(null);
  const show = Boolean(src && failedVersion !== version);
  return (
    <span
      className={`music-cover ${large ? 'large' : ''}`}
      data-failed={!show}
      data-loading={show && loaded !== version}
      title={!show ? '封面暂不可用' : undefined}
    >
      <span className="music-cover-fallback" aria-hidden="true">
        <Icon icon={faMusic} />
      </span>
      {show && (
        <img
          key={version}
          src={src ?? undefined}
          alt={`${track?.title ?? '音乐'} 封面`}
          loading={large ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={() => setLoaded(version)}
          onError={() => {
            setFailed(identity);
            setFailedVersion(version);
          }}
        />
      )}
    </span>
  );
}
