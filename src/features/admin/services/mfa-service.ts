import { appError } from '@/services/errors';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

export type MfaFactor = {
  id: string;
  friendlyName: string | null;
  status: 'verified' | 'unverified';
  createdAt: string;
};

export type MfaStatus = {
  currentLevel: string | null;
  nextLevel: string | null;
  verified: MfaFactor[];
  unverified: MfaFactor[];
};

export type TotpEnrollment = {
  factorId: string;
  secret: string;
  uri: string;
};

const authError = (message: string) => appError('unknown', message);

export async function fetchMfaStatus(): Promise<Result<MfaStatus>> {
  const [level, factors] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]);

  if (level.error) {
    return fail(authError(level.error.message));
  }
  if (factors.error) {
    return fail(authError(factors.error.message));
  }

  const all = factors.data?.all ?? [];
  const map = (factor: (typeof all)[number]): MfaFactor => ({
    id: factor.id,
    friendlyName: factor.friendly_name ?? null,
    status: factor.status,
    createdAt: factor.created_at,
  });

  return ok({
    currentLevel: level.data?.currentLevel ?? null,
    nextLevel: level.data?.nextLevel ?? null,
    verified: all.filter((factor) => factor.status === 'verified').map(map),
    unverified: all.filter((factor) => factor.status === 'unverified').map(map),
  });
}

export async function enrollTotp(): Promise<Result<TotpEnrollment>> {
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `Trabzone Admin ${new Date().toLocaleDateString('tr-TR')}`,
  });

  if (error) {
    return fail(authError(error.message));
  }
  if (!data?.totp) {
    return fail(authError('MFA kaydı başlatılamadı.'));
  }

  return ok({
    factorId: data.id,
    secret: data.totp.secret,
    uri: data.totp.uri,
  });
}

export async function verifyTotp(factorId: string, code: string): Promise<Result<null>> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId,
    code: code.replace(/\s+/g, ''),
  });
  return error ? fail(authError(error.message)) : ok(null);
}

export async function unenrollFactor(factorId: string): Promise<Result<null>> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  return error ? fail(authError(error.message)) : ok(null);
}

export async function cancelEnrollment(factorId: string): Promise<void> {
  await supabase.auth.mfa.unenroll({ factorId });
}
