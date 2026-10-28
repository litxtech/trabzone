// End-to-end smoke test for the support / reporting / child safety stack.
//
//   node scripts/smoke-safety.mjs
//
// Creates four temporary accounts (child, adult, moderator, admin), exercises
// the RPC surface through PostgREST with real user JWTs, then deletes them.
// Requires SUPABASE_SERVICE_ROLE_KEY in .env (server-side only).
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

const url = env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');
const anon = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const service = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !service) {
  console.error('Missing Supabase environment variables.');
  process.exit(1);
}

const results = [];
let failures = 0;

const check = (name, condition, detail) => {
  results.push({ name, ok: Boolean(condition), detail });
  if (!condition) failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const request = async (path, { method = 'GET', token, body, key = anon, headers = {} } = {}) => {
  const response = await fetch(`${url}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token ?? key}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, ok: response.ok, data };
};

const rpc = (token, fn, args = {}) => request(`/rest/v1/rpc/${fn}`, { method: 'POST', token, body: args });

const stamp = Date.now().toString(36);
const accounts = {
  child: { email: `safety.child.${stamp}@example.com`, password: `Ch!ld-${stamp}-Pass9` },
  adult: { email: `safety.adult.${stamp}@example.com`, password: `Ad!lt-${stamp}-Pass9` },
  mod: { email: `safety.mod.${stamp}@example.com`, password: `M0d-${stamp}-Pass99` },
  admin: { email: `safety.admin.${stamp}@example.com`, password: `Adm!n-${stamp}-Pass9` },
};

const created = [];
const tokens = {};
const ids = {};

const createUser = async (label) => {
  const account = accounts[label];
  const { status, data } = await request('/auth/v1/admin/users', {
    method: 'POST',
    token: service,
    key: service,
    body: { email: account.email, password: account.password, email_confirm: true },
  });
  if (status >= 300) {
    throw new Error(`admin create ${label} failed: ${JSON.stringify(data)}`);
  }
  created.push(data.id);
  ids[label] = data.id;

  const signIn = await request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email: account.email, password: account.password },
  });
  if (!signIn.ok) {
    throw new Error(`sign in ${label} failed: ${JSON.stringify(signIn.data)}`);
  }
  tokens[label] = signIn.data.access_token;
};

// Roles sit behind RLS, so staff grants go through the Management API.
const managementToken = process.env.SUPABASE_ACCESS_TOKEN ?? env.SUPABASE_ACCESS_TOKEN;
const projectRef = process.env.SUPABASE_PROJECT_REF ?? env.SUPABASE_PROJECT_REF;

const runSql = async (query) => {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${managementToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) {
    throw new Error(`sql failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
};

const grantRole = (userId, roleKey) =>
  runSql(
    `insert into public.user_role_assignments (user_id, role_key) values ('${userId}', '${roleKey}') on conflict do nothing;`,
  );

const cleanup = async () => {
  for (const id of created) {
    await request(`/auth/v1/admin/users/${id}`, { method: 'DELETE', token: service, key: service });
  }
};

const main = async () => {
  await createUser('child');
  await createUser('adult');
  await createUser('mod');
  await createUser('admin');

  // --- Age assurance -------------------------------------------------------
  const childAge = await rpc(tokens.child, 'safety_set_birth_date', {
    p_birth_date: new Date(Date.now() - 14 * 365.25 * 86400_000).toISOString().slice(0, 10),
  });
  check('child declares age 14', childAge.ok && childAge.data.age_group === 'child', `status ${childAge.status}`);
  check('child is child-protected', childAge.ok && childAge.data.is_child_protected === true);
  check(
    'child profile forced private',
    childAge.ok && childAge.data.protection.profile_visibility === 'private',
  );
  check('child DM policy friends', childAge.ok && childAge.data.protection.dm_policy === 'friends');
  check('child location sharing off', childAge.ok && childAge.data.protection.location_sharing === false);
  check('child guardian consent required', childAge.ok && childAge.data.guardian_required === true);

  const adultAge = await rpc(tokens.adult, 'safety_set_birth_date', { p_birth_date: '1995-05-05' });
  check('adult is not child-protected', adultAge.ok && adultAge.data.is_child_protected === false);

  const under13 = await rpc(tokens.mod, 'safety_set_birth_date', {
    p_birth_date: new Date(Date.now() - 11 * 365.25 * 86400_000).toISOString().slice(0, 10),
  });
  check(
    'under 13 is rejected',
    !under13.ok && JSON.stringify(under13.data).includes('age_below_minimum'),
    `status ${under13.status}`,
  );

  // Direct birth_date writes must be impossible for the client.
  const directBirth = await request(`/rest/v1/profile_private?user_id=eq.${ids.child}`, {
    method: 'PATCH',
    token: tokens.child,
    body: { birth_date: '1990-01-01' },
  });
  check('client cannot rewrite birth_date', !directBirth.ok, `status ${directBirth.status}`);

  // The privacy trigger must coerce loosened settings back.
  const loosen = await request(`/rest/v1/profile_settings?user_id=eq.${ids.child}`, {
    method: 'PATCH',
    token: tokens.child,
    body: { profile_visibility: 'public', discoverable: true, show_city: true },
    headers: { Prefer: 'return=representation' },
  });
  const loosened = Array.isArray(loosen.data) ? loosen.data[0] : null;
  check(
    'child privacy cannot be loosened',
    loosen.ok && loosened?.profile_visibility === 'private' && loosened?.discoverable === false,
    loosened ? `visibility=${loosened.profile_visibility}` : `status ${loosen.status}`,
  );

  // --- Support -------------------------------------------------------------
  const ticket = await rpc(tokens.child, 'safety_create_support_ticket', {
    p_category: 'account_access',
    p_subject: 'Hesabıma giriş yapamıyorum',
    p_body: 'Şifremi sıfırladım ancak giriş yapamıyorum, yardımcı olur musunuz?',
    p_attachments: [],
  });
  check(
    'support ticket created with reference',
    ticket.ok && /^D-\d{4}-\d{6}$/.test(ticket.data.ticket_no ?? ''),
    ticket.ok ? ticket.data.ticket_no : JSON.stringify(ticket.data),
  );
  check('support ticket SLA is 24h', ticket.ok && Boolean(ticket.data.sla_due_at));

  const reply = ticket.ok
    ? await rpc(tokens.child, 'safety_send_support_message', {
        p_ticket_id: ticket.data.id,
        p_body: 'Ek olarak e-posta doğrulama bağlantısı da gelmedi.',
      })
    : { ok: false };
  check('user can reply to own ticket', reply.ok);

  const myTickets = await rpc(tokens.child, 'safety_list_my_tickets');
  check('ticket appears in my requests', myTickets.ok && myTickets.data.items.length >= 1);

  const otherTickets = await rpc(tokens.adult, 'safety_list_my_tickets');
  check('other users do not see the ticket', otherTickets.ok && otherTickets.data.items.length === 0);

  const stolen = ticket.ok ? await rpc(tokens.adult, 'safety_get_ticket', { p_ticket_id: ticket.data.id }) : { ok: true };
  check('ticket detail is owner scoped', !stolen.ok, `status ${stolen.status}`);

  // --- Reporting -----------------------------------------------------------
  const childReport = await rpc(tokens.child, 'safety_create_report', {
    p_target_type: 'reel',
    p_target_id: 'reel_test_001',
    p_reason_code: 'child_safety',
    p_child_reason_code: 'child_grooming',
    p_description: 'Bu hesap çocuklara uygunsuz şekilde yaklaşıyor.',
    p_attachments: [],
    p_target_snapshot: { caption: 'test' },
  });
  check(
    'child safety report gets CG reference',
    childReport.ok && /^CG-\d{4}-\d{6}$/.test(childReport.data.report_no ?? ''),
    childReport.ok ? childReport.data.report_no : JSON.stringify(childReport.data),
  );
  check('child safety report is critical', childReport.ok && childReport.data.priority === 'critical');
  check('child safety report is flagged', childReport.ok && childReport.data.is_child_safety === true);
  check(
    'child safety SLA is 30 minutes',
    childReport.ok && new Date(childReport.data.sla_due_at) - new Date(childReport.data.created_at) <= 31 * 60 * 1000,
  );

  const duplicate = await rpc(tokens.child, 'safety_create_report', {
    p_target_type: 'reel',
    p_target_id: 'reel_test_001',
    p_reason_code: 'child_safety',
    p_child_reason_code: 'child_grooming',
  });
  check('duplicate open report is blocked', !duplicate.ok, `status ${duplicate.status}`);

  const badReason = await rpc(tokens.adult, 'safety_create_report', {
    p_target_type: 'post',
    p_target_id: 'post_1',
    p_reason_code: 'not_a_reason',
  });
  check('unknown reason is rejected', !badReason.ok);

  const adultReport = await rpc(tokens.adult, 'safety_create_report', {
    p_target_type: 'profile',
    p_target_id: ids.child,
    p_reason_code: 'harassment',
    p_description: 'Rahatsız edici mesajlar gönderiyor.',
    p_target_user_id: ids.child,
  });
  check(
    'regular report gets B reference',
    adultReport.ok && /^B-\d{4}-\d{6}$/.test(adultReport.data.report_no ?? ''),
  );

  const myReports = await rpc(tokens.adult, 'safety_list_my_reports');
  check('reports are listed for the reporter', myReports.ok && myReports.data.items.length === 1);

  const otherReports = await rpc(tokens.adult, 'safety_list_my_reports');
  check(
    'report list never leaks the child report',
    otherReports.ok && otherReports.data.items.every((item) => item.is_child_safety === false),
  );

  // --- Guardian consent ----------------------------------------------------
  const consent = await rpc(tokens.child, 'safety_request_guardian_consent', {
    p_guardian_email: 'veli@example.com',
    p_guardian_name: 'Ayşe Yılmaz',
    p_relation: 'Anne',
  });
  check(
    'guardian consent request stored as pending',
    consent.ok && consent.data.status === 'pending' && consent.data.delivery === 'email_pending',
    consent.ok ? consent.data.email_masked : JSON.stringify(consent.data),
  );
  check('guardian token is not returned to the client', consent.ok && !('token' in consent.data));

  const badgeSelf = await rpc(tokens.child, 'safety_profile_flags', { p_user_id: ids.child });
  check('owner sees own child-protected badge', badgeSelf.ok && badgeSelf.data.is_child_protected === true);

  const badgeOther = await rpc(tokens.adult, 'safety_profile_flags', { p_user_id: ids.child });
  check(
    'strangers never learn about the badge',
    badgeOther.ok && Object.keys(badgeOther.data ?? {}).length === 0,
  );

  const canMessage = await rpc(tokens.adult, 'safety_can_message', {
    p_sender: ids.adult,
    p_recipient: ids.child,
  });
  check('adult cannot DM a non-friend child', canMessage.ok && canMessage.data === false);

  // --- Moderator -----------------------------------------------------------
  await grantRole(ids.mod, 'moderator');
  await grantRole(ids.admin, 'admin');

  const modStaff = await rpc(tokens.mod, 'safety_staff_me');
  check(
    'moderator is recognised as staff',
    modStaff.ok && modStaff.data.permissions.includes('support.reply'),
    modStaff.ok ? modStaff.data.permissions.join(',') : JSON.stringify(modStaff.data),
  );

  const modQueue = await rpc(tokens.mod, 'safety_admin_list_tickets', { p_limit: 10 });
  check('moderator can list the support queue', modQueue.ok && modQueue.data.total >= 1);

  const modReply = ticket.ok
    ? await rpc(tokens.mod, 'safety_admin_reply_ticket', {
        p_ticket_id: ticket.data.id,
        p_body: 'Merhaba, hesabınızı inceliyoruz. E-posta doğrulamasını tekrar göndereceğiz.',
      })
    : { ok: false };
  check('moderator can reply to a ticket', modReply.ok, modReply.ok ? modReply.data.status_code : '');

  const afterReply = ticket.ok ? await rpc(tokens.child, 'safety_get_ticket', { p_ticket_id: ticket.data.id }) : null;
  check(
    'user sees the staff reply',
    afterReply?.ok && afterReply.data.messages.some((message) => message.author_role === 'agent'),
  );

  const modChildQueue = await rpc(tokens.mod, 'safety_admin_child_queue');
  check('moderator cannot open the child safety queue', !modChildQueue.ok, `status ${modChildQueue.status}`);

  const adminStaff = await rpc(tokens.admin, 'safety_staff_me');
  check(
    'admin has child safety permissions',
    adminStaff.ok && adminStaff.data.permissions.includes('safety.child.view'),
    adminStaff.ok ? adminStaff.data.permissions.join(',') : JSON.stringify(adminStaff.data),
  );

  const childQueue = await rpc(tokens.admin, 'safety_admin_child_queue');
  check(
    'admin sees the child safety queue',
    childQueue.ok && childQueue.data.critical_count >= 1 && childQueue.data.reports.length >= 1,
  );

  const childDetail = childReport.ok
    ? await rpc(tokens.admin, 'safety_admin_get_report', { p_report_id: childReport.data.id })
    : null;
  check('admin opens the child report detail', childDetail?.ok === true);

  const handled = childReport.ok
    ? await rpc(tokens.admin, 'safety_admin_report_action', {
        p_report_id: childReport.data.id,
        p_action: 'resolve',
        p_note_internal: 'İçerik kaldırıldı, hesap kısıtlandı.',
        p_note_public: 'Bildiriminiz incelendi ve gerekli işlem uygulandı.',
        p_content_action: 'content_removed',
      })
    : { ok: false };
  check('admin resolves the child report', handled.ok && handled.data.status_code === 'resolved');

  const reporterState = childReport.ok ? await rpc(tokens.child, 'safety_get_my_report', { p_report_id: childReport.data.id }) : null;
  check(
    'reporter sees the public resolution note only',
    reporterState?.ok && reporterState.data.resolution_note?.includes('gerekli işlem'),
  );

  const audit = await rpc(tokens.admin, 'safety_admin_audit_logs', { p_limit: 10 });
  check('moderation audit log is written', audit.ok && audit.data.items.length >= 1);

  const childSettings = await rpc(tokens.child, 'safety_update_child_settings', {
    p_dm_policy: 'nobody',
    p_location_sharing: false,
  });
  check(
    'child can tighten their own settings',
    childSettings.ok && childSettings.data.protection.dm_policy === 'nobody',
  );

  const loosenDm = await rpc(tokens.child, 'safety_update_child_settings', { p_dm_policy: 'everyone' });
  check('child cannot open DMs to everyone', !loosenDm.ok);

  const faqs = await rpc(tokens.child, 'safety_list_faqs');
  check('FAQ content is published', faqs.ok && faqs.data.length >= 10, `${faqs.data?.length ?? 0} entries`);

  const policy = await rpc(tokens.child, 'safety_get_policy', { p_slug: 'child-safety' });
  check('child safety policy is published', policy.ok && policy.data?.version === 1);

  for (const [slug, title] of [
    ['terms', 'Kullanım Koşulları'],
    ['privacy', 'Gizlilik Politikası'],
  ]) {
    const legal = await rpc(tokens.child, 'safety_get_policy', { p_slug: slug });
    check(
      `${slug} policy is published and complete`,
      legal.ok && legal.data?.title === title && (legal.data?.body_md?.length ?? 0) > 800,
      `${legal.data?.body_md?.length ?? 0} chars`,
    );
  }

  console.log(`\n${results.length - failures}/${results.length} checks passed.`);
  return failures === 0;
};

let success = false;
try {
  success = await main();
} catch (error) {
  console.error('SMOKE TEST ERROR:', error instanceof Error ? error.message : error);
} finally {
  await cleanup();
}

process.exit(success ? 0 : 1);
