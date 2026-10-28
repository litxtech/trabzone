// Gecici: web arayuzunu elle test etmek icin ilan sahibi bir QA hesabi olusturur.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

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

const admin = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const stamp = Date.now().toString(36);
const email = `web.qa.${stamp}@trabzone.test`;
const password = `WebQa!${stamp}Aa9`;
const username = `webqa${stamp}`;

const { data: created, error: createError } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { username, first_name: 'Web', last_name: 'QA' },
});
if (createError) {
  throw createError;
}

const userId = created.user.id;

const { error: profileError } = await admin.from('profiles').upsert(
  { id: userId, username },
  { onConflict: 'id' },
);
if (profileError) {
  console.log('profile upsert:', profileError.message);
}

const { data: listing, error: listingError } = await admin
  .from('marketplace_listings')
  .insert({
    seller_id: userId,
    title: `Web silme testi ${stamp}`,
    description: 'Silme akisini test etmek icin olusturuldu.',
    price_cents: 150000,
    currency: 'TRY',
    condition: 'good',
    city: 'Trabzon',
    status: 'active',
    moderation_status: 'visible',
  })
  .select('id')
  .single();

if (listingError) {
  console.log('listing insert:', listingError.message);
}

console.log(JSON.stringify({ email, password, username, userId, listingId: listing?.id ?? null }));
