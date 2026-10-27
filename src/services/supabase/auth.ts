import type { AuthError, Session } from '@supabase/supabase-js';

import { appError, mapAuthError, type AppError } from '@/services/errors';
import { fail, ok, type Result } from '@/utils/result';

import { supabase } from './client';

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const toFailure = (error: AuthError): Result<never> => fail(mapAuthError(error));

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<Result<Session>> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalizeEmail(email),
    password,
  });

  if (error) {
    return toFailure(error);
  }
  if (!data.session) {
    return fail(appError('email_not_confirmed'));
  }
  return ok(data.session);
}

export type SignUpPayload = {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  username: string;
};

export async function signUpWithPassword(payload: SignUpPayload): Promise<Result<{ needsVerification: boolean }>> {
  const { data, error } = await supabase.auth.signUp({
    email: normalizeEmail(payload.email),
    password: payload.password,
    options: {
      data: {
        first_name: payload.firstName.trim(),
        last_name: payload.lastName.trim(),
        username: payload.username.trim().toLowerCase(),
      },
    },
  });

  if (error) {
    return toFailure(error);
  }

  // Supabase hides "email already registered" behind an empty identities array.
  if (data.user && data.user.identities?.length === 0) {
    return fail(appError('user_exists'));
  }

  return ok({ needsVerification: data.session === null });
}

export async function verifySignUpOtp(email: string, token: string): Promise<Result<Session>> {
  const { data, error } = await supabase.auth.verifyOtp({
    email: normalizeEmail(email),
    token,
    type: 'signup',
  });

  if (error) {
    return toFailure(error);
  }
  if (!data.session) {
    return fail(appError('otp_invalid'));
  }
  return ok(data.session);
}

export async function resendSignUpOtp(email: string): Promise<Result<null>> {
  const { error } = await supabase.auth.resend({ type: 'signup', email: normalizeEmail(email) });
  return error ? toFailure(error) : ok(null);
}

export async function requestPasswordReset(email: string): Promise<Result<null>> {
  const { error } = await supabase.auth.resetPasswordForEmail(normalizeEmail(email));
  return error ? toFailure(error) : ok(null);
}

export async function verifyRecoveryOtp(email: string, token: string): Promise<Result<Session>> {
  const { data, error } = await supabase.auth.verifyOtp({
    email: normalizeEmail(email),
    token,
    type: 'recovery',
  });

  if (error) {
    return toFailure(error);
  }
  if (!data.session) {
    return fail(appError('otp_invalid'));
  }
  return ok(data.session);
}

export async function updatePassword(password: string): Promise<Result<null>> {
  const { error } = await supabase.auth.updateUser({ password });
  return error ? toFailure(error) : ok(null);
}

export async function signOut(): Promise<Result<null>> {
  const { error } = await supabase.auth.signOut();
  return error ? toFailure(error) : ok(null);
}

export async function getCurrentSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    return null;
  }
  return data.session;
}

export type SignUpMetadata = {
  username: string | null;
  firstName: string | null;
  lastName: string | null;
};

/**
 * Registration metadata captured at sign-up. Apple only returns the name on the
 * first authorization, so it is read from the stored user metadata afterwards.
 */
export async function getSignUpMetadata(): Promise<SignUpMetadata> {
  const { data, error } = await supabase.auth.getUser();
  const metadata = (!error && data.user?.user_metadata) || {};

  const read = (key: string): string | null => {
    const value = metadata[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };

  return {
    username: read('username')?.toLowerCase() ?? null,
    firstName: read('first_name'),
    lastName: read('last_name'),
  };
}

export type { AppError };
