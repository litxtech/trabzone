// Configures the Supabase Auth project for Trabzone's 6-digit e-mail OTP flows.
// Run: node scripts/configure-auth.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
);

const token = process.env.SUPABASE_ACCESS_TOKEN ?? env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF ?? env.SUPABASE_PROJECT_REF;
if (!token || !ref) {
  console.error('SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required.');
  process.exit(1);
}

const code = (label) => `
<h2>Trabzone ${label}</h2>
<p>Aşağıdaki 6 haneli kodu uygulamaya gir:</p>
<p style="font-size:30px;letter-spacing:10px;font-weight:700;margin:24px 0">{{ .Token }}</p>
<p>Kod 10 dakika geçerlidir ve yalnızca bir kez kullanılabilir.</p>
<p>Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin.</p>
`.trim();

const payload = {
  mailer_otp_exp: 600,
  // Sunucu tarafi sifre politikasi istemci kurallariyla ayni tutulur
  // (zod: en az 8 karakter, kucuk + buyuk harf + rakam).
  password_min_length: 8,
  password_required_characters:
    'abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789',
  mailer_subjects_confirmation: 'Trabzone doğrulama kodun',
  mailer_templates_confirmation_content: code('e-postanı doğrula'),
  mailer_subjects_recovery: 'Trabzone şifre sıfırlama kodun',
  mailer_templates_recovery_content: code('şifre sıfırlama'),
};

const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

const text = await response.text();
if (!response.ok) {
  console.error(`${response.status} ${text}`);
  process.exit(1);
}

const config = JSON.parse(text);
console.log(
  JSON.stringify(
    {
      mailer_otp_length: config.mailer_otp_length,
      mailer_otp_exp: config.mailer_otp_exp,
      mailer_autoconfirm: config.mailer_autoconfirm,
      password_min_length: config.password_min_length,
      password_required_characters: config.password_required_characters,
      subjects: [config.mailer_subjects_confirmation, config.mailer_subjects_recovery],
      confirmation_has_token: config.mailer_templates_confirmation_content.includes('{{ .Token }}'),
      recovery_has_token: config.mailer_templates_recovery_content.includes('{{ .Token }}'),
    },
    null,
    2,
  ),
);
