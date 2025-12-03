/**
 * Resolve a Solid Pod base URL (with trailing slash) from WebID / optional podUrl / optional storages.
 * Priority:
 * 1) storages (solid:storage / pim:storage) preferring same-origin with WebID
 * 2) podUrl first path segment (if not "profile")
 * 3) webId first path segment (if not "profile")
 * 4) webId origin
 */
export interface PodBaseOptions {
  webId: string;
  podUrl?: string;
  storages?: string[];
}

const normalize = (base: string): string => (base.endsWith('/') ? base : `${base}/`);

const pickSameOrigin = (webId: string, candidates: string[]): string | null => {
  try {
    const webIdOrigin = new URL(webId).origin;
    const match = candidates.find(candidate => {
      try {
        return new URL(candidate).origin === webIdOrigin;
      } catch {
        return false;
      }
    });
    return match || null;
  } catch {
    return null;
  }
};

const deriveFromUrl = (raw?: string): string | null => {
  if (!raw || raw.trim().length === 0) return null;
  try {
    const url = new URL(raw);
    const segments = url.pathname.split('/').filter(Boolean);
    const first = segments[0];
    const path = first && first !== 'profile' ? `/${first}/` : '/';
    return normalize(`${url.origin}${path}`);
  } catch {
    return null;
  }
};

export function resolvePodBase(options: PodBaseOptions): string {
  const { webId, podUrl, storages } = options;

  const storageCandidates = (storages || []).filter(Boolean);
  if (storageCandidates.length > 0) {
    const sameOrigin = pickSameOrigin(webId, storageCandidates);
    const selected = sameOrigin || storageCandidates[0];
    return normalize(selected);
  }

  const fromPod = deriveFromUrl(podUrl);
  const fromWebId = deriveFromUrl(webId);

  const hasUserPath = (value: string | null): boolean => {
    if (!value) return false;
    try {
      return new URL(value).pathname !== '/';
    } catch {
      return false;
    }
  };

  if (hasUserPath(fromPod)) return fromPod!;
  if (hasUserPath(fromWebId)) return fromWebId!;
  if (fromPod) return fromPod;
  if (fromWebId) return fromWebId;

  try {
    const url = new URL(webId);
    return normalize(url.origin);
  } catch {
    return normalize(webId);
  }
}
