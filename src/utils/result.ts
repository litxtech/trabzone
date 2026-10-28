import type { AppError } from '@/services/errors';

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });

export const fail = <T = never>(error: AppError): Result<T> => ({ ok: false, error });

/**
 * React Query `queryFn`/`mutationFn` bekledigi icin Result'i acar; hata
 * durumunda AppError firlatir (error.message arayuzde gosterilebilir).
 */
export async function unwrap<T>(input: Promise<Result<T>> | Result<T>): Promise<T> {
  const result = await input;
  if (!result.ok) {
    throw result.error;
  }
  return result.data;
}
