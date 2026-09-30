const PUBLIC_CONTENT_TIMEOUT_MS = 800;

/**
 * Public pages should keep rendering when the optional content store is
 * temporarily unavailable. The Supabase request continues in the background,
 * while the page uses its existing fallback after a short, bounded wait.
 */
export async function withPublicContentTimeout<T>(
  promise: PromiseLike<T>,
  fallback: T,
  timeoutMs = PUBLIC_CONTENT_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
