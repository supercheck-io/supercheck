/**
 * Container image reference helpers.
 *
 * Kubernetes `imagePullPolicy: IfNotPresent` can serve a stale cached image
 * when the reference is mutable (`:latest` or an untagged image, which defaults
 * to `latest`). Execution Jobs must not silently run an older build than the
 * worker control plane, so callers force `Always` for mutable references while
 * keeping the cheaper `IfNotPresent` for immutable references (an explicit
 * non-`latest` tag or a digest).
 */
export type ImagePullPolicy = 'Always' | 'IfNotPresent' | 'Never';

export function isMutableImageReference(reference: string): boolean {
  const trimmed = reference.trim();
  if (!trimmed) {
    return true;
  }

  // A digest pins immutable content even when a tag is also present.
  if (trimmed.includes('@sha256:')) {
    return false;
  }

  const lastSegment = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  const tagSeparator = lastSegment.lastIndexOf(':');
  if (tagSeparator === -1) {
    return true;
  }

  return lastSegment.slice(tagSeparator + 1) === 'latest';
}

/**
 * Parses an `EXECUTION_IMAGE_PULL_POLICY` override. Returns the resolved policy
 * when valid, an `invalidOverride` value when unrecognized, or an empty object
 * when no override was supplied. Callers parse once at startup so an invalid
 * value is reported a single time instead of on every Job creation.
 */
export function parseImagePullPolicyOverride(override?: string | null): {
  policy?: ImagePullPolicy;
  invalidOverride?: string;
} {
  const normalized = override?.trim();
  if (!normalized) {
    return {};
  }

  switch (normalized.toLowerCase()) {
    case 'always':
      return { policy: 'Always' };
    case 'ifnotpresent':
      return { policy: 'IfNotPresent' };
    case 'never':
      return { policy: 'Never' };
    default:
      return { invalidOverride: normalized };
  }
}
