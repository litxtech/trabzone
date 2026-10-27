export type Result<T> = { ok: true; data: T } | { ok: false; error: import('@/services/errors').AppError };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });

export const fail = <T = never>(error: import('@/services/errors').AppError): Result<T> => ({
  ok: false,
  error,
});
