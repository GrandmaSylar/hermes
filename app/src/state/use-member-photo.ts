import { useEffect, useState } from 'react';
import { createPhotoDisk, photoDirectory, readCachedPhoto, refreshPhoto } from '@/data/photos';
import { useApp } from '@/state/AppProvider';

/**
 * The member's passport photo as a file address, or null while there is none. A photo already on the phone shows at
 * once; the office is then asked whether it has changed (or has one at all), which also fills it in the first time.
 */
export function useMemberPhoto(memberCode: string | undefined): string | null {
  const { repos, memberPhoto } = useApp();
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    setUri(null);
    if (!repos || !memberCode) return;
    let live = true;
    (async () => {
      try {
        const disk = createPhotoDisk();
        const cached = await readCachedPhoto(repos.kv, disk, memberCode);
        if (live && cached) setUri(cached.uri);
        const fresh = await refreshPhoto(repos.kv, disk, await photoDirectory(), memberCode, cached?.version ?? null, memberPhoto);
        if (live && fresh) setUri(fresh.uri);
      } catch {
        // No photo shown: the initials stay.
      }
    })();
    return () => {
      live = false;
    };
  }, [repos, memberCode, memberPhoto]);

  return uri;
}
