import { z } from 'zod';

export const USERNAME_PATTERN = /^[a-z0-9_.]{3,24}$/;

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'E-posta gerekli')
  .email('Geçerli bir e-posta gir')
  .transform((value) => value.toLowerCase());

export const passwordSchema = z
  .string()
  .min(8, 'En az 8 karakter')
  .max(72, 'En fazla 72 karakter')
  .regex(/[a-zçğıöşü]/, 'En az bir küçük harf')
  .regex(/[A-ZÇĞİÖŞÜ]/, 'En az bir büyük harf')
  .regex(/[0-9]/, 'En az bir rakam');

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(USERNAME_PATTERN, '3-24 karakter; küçük harf, rakam, nokta ve alt çizgi');

export const nameSchema = z
  .string()
  .trim()
  .min(2, 'En az 2 karakter')
  .max(60, 'En fazla 60 karakter');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Şifre gerekli'),
});

export type LoginValues = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    firstName: nameSchema,
    lastName: nameSchema,
    username: usernameSchema,
    email: emailSchema,
    password: passwordSchema,
    passwordConfirm: z.string().min(1, 'Şifreyi tekrar gir'),
    acceptedTerms: z.boolean().refine((value) => value, {
      message: 'Devam etmek için koşulları kabul et',
    }),
  })
  .refine((values) => values.password === values.passwordConfirm, {
    message: 'Şifreler eşleşmiyor',
    path: ['passwordConfirm'],
  });

export type RegisterValues = z.infer<typeof registerSchema>;

export const resetRequestSchema = z.object({ email: emailSchema });

export const otpSchema = z.string().regex(/^\d{6}$/, '6 haneli kodu gir');

export const completeProfileSchema = z.object({
  username: usernameSchema,
  firstName: nameSchema,
  lastName: nameSchema,
});

export type CompleteProfileValues = z.infer<typeof completeProfileSchema>;

/** Turkish copy for a password strength meter (0-4). */
export function passwordStrength(password: string): { score: number; label: string } {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^\w\s]/.test(password)) score += 1;

  const labels = ['Çok zayıf', 'Zayıf', 'Orta', 'Güçlü', 'Çok güçlü'] as const;
  return { score, label: labels[Math.min(score, 4)] ?? labels[0] };
}
