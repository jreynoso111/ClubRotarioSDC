export const PUBLIC_CONTENT_TIMEOUT_MS = 3000;

/**
 * Raised when public content cannot be read. Routes that must tell a real
 * missing record (404) apart from an outage catch this as an error instead.
 */
export class PublicContentUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicContentUnavailableError";
  }
}

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

/**
 * For content that must not be guessed, such as a single story page: a slow
 * or failed read rejects, so the error boundary renders instead of a 404.
 */
export async function awaitPublicContent<T>(
  promise: PromiseLike<T>,
  timeoutMs = PUBLIC_CONTENT_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new PublicContentUnavailableError("El contenido público tardó demasiado en responder.")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
