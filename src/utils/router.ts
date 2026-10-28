import {
  router as expoRouter,
  useRouter as useExpoRouter,
  type Href,
} from 'expo-router';
import { useMemo } from 'react';

/**
 * Gezinme korumasi.
 *
 * Art arda iki kez ayni hedefe dokunmak (cift dokunus, titrek parmak, hizli
 * tekrar) ayni ekranin iki kez yigilmasina neden oluyordu. Burada yalnizca
 * "ayni hedef, cok kisa sure icinde tekrar" durumu yutulur; farkli bir hedefe
 * gidildiginde kilit aninda serbest kalir. Boylece A -> B -> A gibi mesru
 * gecisler asla engellenmez.
 */
const REPEAT_WINDOW_MS = 600;

let lastTarget = '';
let lastAt = 0;

function targetKey(href: unknown): string {
  if (typeof href === 'string') {
    return href;
  }
  if (href && typeof href === 'object') {
    const value = href as { pathname?: unknown; params?: unknown };
    const pathname = typeof value.pathname === 'string' ? value.pathname : '';
    const params = value.params ? JSON.stringify(value.params) : '';
    return `${pathname}|${params}`;
  }
  return '';
}

function shouldNavigate(href: unknown): boolean {
  const key = targetKey(href);
  const now = Date.now();
  if (key && key === lastTarget && now - lastAt < REPEAT_WINDOW_MS) {
    return false;
  }
  lastTarget = key;
  lastAt = now;
  return true;
}

type PushArgs = Parameters<typeof expoRouter.push>;

function guardedPush(...args: PushArgs) {
  if (shouldNavigate(args[0])) {
    expoRouter.push(...args);
  }
}

function guardedNavigate(...args: PushArgs) {
  if (shouldNavigate(args[0])) {
    expoRouter.navigate(...args);
  }
}

function guardedReplace(...args: PushArgs) {
  if (shouldNavigate(args[0])) {
    expoRouter.replace(...args);
  }
}

/**
 * `expo-router`'in `useRouter` karsiligi; `push` / `navigate` / `replace`
 * cagrilari tekrar korumasindan gecer, diger tum metotlar aynen calisir.
 */
export function useRouter() {
  const base = useExpoRouter();

  return useMemo(
    () => ({
      ...base,
      push: guardedPush,
      navigate: guardedNavigate,
      replace: guardedReplace,
    }),
    [base],
  );
}

/** Bilesen disinda (ornegin servis/dialog callback'lerinde) kullanilan korumali router. */
export const router = {
  ...expoRouter,
  push: guardedPush,
  navigate: guardedNavigate,
  replace: guardedReplace,
} as typeof expoRouter;

export type { Href };
