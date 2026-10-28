// End-to-end smoke test for the social / messaging / marketplace stack.
//
//   node scripts/smoke-social.mjs
//
// Creates three temporary accounts (two members + one moderator), exercises the
// RPC surface through PostgREST with real user JWTs, then deletes them.
// Requires the server-side Supabase keys in .env.
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

let failures = 0;
let total = 0;

const check = (name, condition, detail) => {
  total += 1;
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
  alice: { email: `social.alice.${stamp}@example.com`, password: `Al!ce-${stamp}-Pass9` },
  bob: { email: `social.bob.${stamp}@example.com`, password: `B0b-${stamp}-Pass99` },
  mod: { email: `social.mod.${stamp}@example.com`, password: `M0d-${stamp}-Pass99` },
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

  const profile = await rpc(tokens[label], 'complete_registration', {
    p_username: `${label}${stamp}`.slice(0, 20),
    p_first_name: label === 'alice' ? 'Ayşe' : label === 'bob' ? 'Burak' : 'Moder',
    p_last_name: 'Test',
  });
  if (!profile.ok) {
    throw new Error(`complete_registration ${label} failed: ${JSON.stringify(profile.data)}`);
  }
};

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

const cleanup = async () => {
  for (const id of created) {
    await request(`/auth/v1/admin/users/${id}`, { method: 'DELETE', token: service, key: service });
  }
};

const main = async () => {
  await createUser('alice');
  await createUser('bob');
  await createUser('mod');

  // --- Posts ---------------------------------------------------------------
  const textPost = await rpc(tokens.alice, 'feed_create_post', {
    p_body: 'Trabzon sahilinde gün batımı 🌅',
    p_visibility: 'public',
    p_city: 'Trabzon',
  });
  check('create text post', textPost.ok && Boolean(textPost.data?.id), JSON.stringify(textPost.data));

  const mediaPost = await rpc(tokens.alice, 'feed_create_post', {
    p_body: 'Yeni fotoğraf',
    p_media: [
      { storage_path: `${ids.alice}/photo-1.jpg`, media_type: 'image', width: 1080, height: 1350 },
      { storage_path: `${ids.alice}/photo-2.jpg`, media_type: 'image', width: 1080, height: 1080 },
    ],
    p_visibility: 'public',
  });
  check('create post with media', mediaPost.ok && Boolean(mediaPost.data?.id));

  const emptyPost = await rpc(tokens.alice, 'feed_create_post', { p_body: '   ' });
  check('empty post is rejected', !emptyPost.ok, `status ${emptyPost.status}`);

  const stolenMedia = await rpc(tokens.bob, 'feed_create_post', {
    p_body: 'başkasının dosyası',
    p_media: [{ storage_path: `${ids.alice}/stolen.jpg`, media_type: 'image' }],
  });
  check('cannot reference another user media', !stolenMedia.ok);

  const directInsert = await request('/rest/v1/posts', {
    method: 'POST',
    token: tokens.bob,
    body: { author_id: ids.bob, body: 'doğrudan yazma' },
  });
  check('direct post insert is blocked by grants', !directInsert.ok, `status ${directInsert.status}`);

  const bobFeed = await rpc(tokens.bob, 'feed_list', { p_filter: 'all', p_limit: 10 });
  check('feed returns both posts', bobFeed.ok && bobFeed.data.items.length === 2);
  check('feed exposes like/save flags', bobFeed.ok && bobFeed.data.items[0].liked === false);
  check('feed media is ordered', bobFeed.ok && bobFeed.data.items.some((p) => p.media.length === 2));

  const nearby = await rpc(tokens.bob, 'feed_list', { p_filter: 'nearby', p_city: 'trabzon' });
  check('nearby filter matches city case-insensitively', nearby.ok && nearby.data.items.length === 1);

  const postId = textPost.data.id;

  const like = await rpc(tokens.bob, 'feed_toggle_like', { p_post_id: postId });
  check('like increments counter', like.ok && like.data.liked === true && like.data.like_count === 1);

  const unlike = await rpc(tokens.bob, 'feed_toggle_like', { p_post_id: postId });
  check('unlike decrements counter', unlike.ok && unlike.data.liked === false && unlike.data.like_count === 0);

  await rpc(tokens.bob, 'feed_toggle_like', { p_post_id: postId });

  const comment = await rpc(tokens.bob, 'feed_add_comment', {
    p_post_id: postId,
    p_body: 'Harika bir kare!',
  });
  check('comment created', comment.ok && Boolean(comment.data?.id));

  const comments = await rpc(tokens.alice, 'feed_list_comments', { p_post_id: postId });
  check('comment list is visible to post owner', comments.ok && comments.data.items.length === 1);
  check('comment carries author info', comments.ok && comments.data.items[0].author_username === `bob${stamp}`.slice(0, 20));

  const bobCannotDelete = await rpc(tokens.bob, 'feed_delete_post', { p_post_id: postId });
  check('non-author cannot delete the post', !bobCannotDelete.ok);

  const save = await rpc(tokens.bob, 'feed_toggle_save', { p_post_id: postId });
  check('save toggles', save.ok && save.data.saved === true);

  const saved = await rpc(tokens.bob, 'feed_list_saved', {});
  check('saved posts are listed', saved.ok && saved.data.items.length === 1);

  const viaProfile = await rpc(tokens.bob, 'feed_profile_posts', { p_username: `alice${stamp}`.slice(0, 20) });
  check('profile posts tab works', viaProfile.ok && viaProfile.data.items.length === 2);

  // --- Notifications -------------------------------------------------------
  const notes = await rpc(tokens.alice, 'notifications_list', {});
  check(
    'like + comment notifications delivered',
    notes.ok && notes.data.items.some((n) => n.kind === 'like') && notes.data.items.some((n) => n.kind === 'comment'),
    notes.ok ? `${notes.data.items.length} items` : JSON.stringify(notes.data),
  );

  const unread = await rpc(tokens.alice, 'notifications_unread_count');
  check('unread counter works', unread.ok && unread.data >= 2, `count ${unread.data}`);

  const marked = await rpc(tokens.alice, 'notifications_mark_read', { p_ids: null });
  check('mark all read', marked.ok && marked.data >= 2);

  const bobNotes = await rpc(tokens.bob, 'notifications_list', {});
  check('notifications never leak to other users', bobNotes.ok && bobNotes.data.items.length === 0);

  // --- Stories -------------------------------------------------------------
  const story = await rpc(tokens.alice, 'story_create', {
    p_media_path: `${ids.alice}/story-1.jpg`,
    p_media_type: 'image',
    p_caption: 'Günün karesi',
  });
  check('story created', story.ok && Boolean(story.data?.id));

  const storyList = await rpc(tokens.bob, 'story_list');
  // Ayni anda baska kullanicilarin aktif hikayeleri olabilir; bu yuzden
  // toplam sayi yerine alice'in grubu aranir. `has_unseen` grup seviyesindedir.
  const storyGroups = storyList.ok ? storyList.data.items : [];
  const aliceGroup = storyGroups.find((group) => group.author_id === ids.alice);
  check(
    'story visible to others',
    Boolean(aliceGroup) && aliceGroup.items.some((item) => item.id === story.data.id),
  );
  check('story is unseen initially', Boolean(aliceGroup) && aliceGroup.has_unseen === true);

  await rpc(tokens.bob, 'story_mark_viewed', { p_story_id: story.data.id });
  const storyAfter = await rpc(tokens.bob, 'story_list');
  const aliceAfter = storyAfter.ok
    ? storyAfter.data.items.find((group) => group.author_id === ids.alice)
    : undefined;
  check('story marked as seen', Boolean(aliceAfter) && aliceAfter.has_unseen === false);

  const viewers = await rpc(tokens.alice, 'story_viewers', { p_story_id: story.data.id });
  check('owner sees story viewers', viewers.ok && viewers.data.items.length === 1);

  const bobStoryDelete = await rpc(tokens.bob, 'story_delete', { p_story_id: story.data.id });
  check('non-owner cannot delete story', !bobStoryDelete.ok);

  // --- Discovery -----------------------------------------------------------
  const discover = await rpc(tokens.bob, 'people_discover', { p_query: 'ali', p_sort: 'new' });
  check('people search returns alice', discover.ok && discover.data.items.length === 1);
  check(
    'people search exposes follow state',
    discover.ok && discover.data.items[0].is_following === false,
  );

  const selfHidden = await rpc(tokens.alice, 'people_discover', { p_query: 'ali' });
  check('people search never returns self', selfHidden.ok && selfHidden.data.items.length === 0);

  // --- Messaging -----------------------------------------------------------
  const chat = await rpc(tokens.bob, 'chat_start_direct', { p_user_id: ids.alice });
  check('direct conversation created', chat.ok && Boolean(chat.data?.id), JSON.stringify(chat.data));
  const conversationId = chat.data.id;

  const chatAgain = await rpc(tokens.alice, 'chat_start_direct', { p_user_id: ids.bob });
  check('direct conversation is deduplicated', chatAgain.ok && chatAgain.data.id === conversationId);

  const sent = await rpc(tokens.bob, 'chat_send_message', {
    p_conversation_id: conversationId,
    p_kind: 'text',
    p_body: 'Merhaba, fotoğraf çok güzel!',
  });
  check('message sent', sent.ok && sent.data.body.includes('Merhaba'), JSON.stringify(sent.data));

  const list = await rpc(tokens.alice, 'chat_list');
  check(
    'conversation appears with unread count',
    list.ok && list.data.items.length === 1 && list.data.items[0].unread_count === 1,
    JSON.stringify(list.data),
  );

  const messages = await rpc(tokens.alice, 'chat_messages', { p_conversation_id: conversationId });
  check('messages readable by member', messages.ok && messages.data.items.length === 1);

  const outsider = await rpc(tokens.mod, 'chat_messages', { p_conversation_id: conversationId });
  check('outsider cannot read messages', !outsider.ok, `status ${outsider.status}`);

  await rpc(tokens.alice, 'chat_mark_read', { p_conversation_id: conversationId });

  const afterRead = await rpc(tokens.alice, 'chat_list');
  check('read state clears unread', afterRead.ok && afterRead.data.items[0].unread_count === 0);

  const messageId = sent.data.id;
  const edited = await rpc(tokens.bob, 'chat_edit_message', {
    p_message_id: messageId,
    p_body: 'Merhaba, fotoğraf gerçekten çok güzel!',
  });
  check('sender can edit message', edited.ok);

  const editOther = await rpc(tokens.alice, 'chat_edit_message', {
    p_message_id: messageId,
    p_body: 'ele geçir',
  });
  check('other user cannot edit message', !editOther.ok);

  const reply = await rpc(tokens.alice, 'chat_send_message', {
    p_conversation_id: conversationId,
    p_kind: 'text',
    p_body: 'Teşekkürler!',
    p_reply_to: messageId,
  });
  check('reply is accepted', reply.ok && reply.data.reply_preview?.body != null);

  const mediaMessage = await rpc(tokens.alice, 'chat_send_message', {
    p_conversation_id: conversationId,
    p_kind: 'image',
    p_media_path: `${conversationId}/${ids.alice}-photo.jpg`,
    p_media_meta: { width: 800, height: 600 },
  });
  check('media message accepted', mediaMessage.ok, JSON.stringify(mediaMessage.data));

  const badMedia = await rpc(tokens.alice, 'chat_send_message', {
    p_conversation_id: conversationId,
    p_kind: 'image',
    p_media_path: `${ids.alice}/photo.jpg`,
  });
  check('media path must be conversation scoped', !badMedia.ok);

  const group = await rpc(tokens.alice, 'chat_create_group', {
    p_title: 'Trabzon Buluşması',
    p_member_ids: [ids.bob],
  });
  check('group created', group.ok && Boolean(group.data?.id));

  const groupMembers = await rpc(tokens.bob, 'chat_members', { p_conversation_id: group.data.id });
  check('group members listed', groupMembers.ok && groupMembers.data.items.length === 2);

  const groupMessage = await rpc(tokens.bob, 'chat_send_message', {
    p_conversation_id: group.data.id,
    p_kind: 'text',
    p_body: 'Ben de geliyorum.',
  });
  check('group message sent', groupMessage.ok);

  const leave = await rpc(tokens.bob, 'chat_leave', { p_conversation_id: group.data.id });
  check('member can leave group', leave.ok);

  // --- Calls ---------------------------------------------------------------
  const call = await rpc(tokens.alice, 'call_start', {
    p_conversation_id: conversationId,
    p_kind: 'audio',
  });
  check('call session created', call.ok && call.data.status === 'ringing');

  const callGet = await rpc(tokens.bob, 'call_get', { p_call_id: call.data.id });
  check('callee sees incoming call', callGet.ok && callGet.data.peer_username === `alice${stamp}`.slice(0, 20));

  const accepted = await rpc(tokens.bob, 'call_respond', { p_call_id: call.data.id, p_accept: true });
  check('callee accepts call', accepted.ok && accepted.data.status === 'accepted');

  const ended = await rpc(tokens.alice, 'call_end', { p_call_id: call.data.id });
  check('caller ends call', ended.ok);

  // --- Marketplace ---------------------------------------------------------
  const categories = await rpc(tokens.bob, 'market_categories');
  check('categories seeded', categories.ok && categories.data.items.length >= 7);
  const electronics = categories.data.items.find((c) => c.slug === 'elektronik');

  const listing = await rpc(tokens.alice, 'market_create_listing', {
    p_payload: {
      title: 'Temiz iPhone 13',
      description: 'Batarya sağlığı %89, kutulu.',
      price_cents: 1850000,
      category_id: electronics.id,
      condition: 'good',
      city: 'Trabzon',
      stock: 2,
      images: [{ storage_path: `${ids.alice}/listing-1.jpg` }],
    },
  });
  check('listing created', listing.ok && Boolean(listing.data?.id), JSON.stringify(listing.data));
  const listingId = listing.data.id;

  const listMarket = await rpc(tokens.bob, 'market_list', { p_query: 'iphone' });
  check('listing search works', listMarket.ok && listMarket.data.items.length === 1);
  check('listing exposes seller info', listMarket.ok && listMarket.data.items[0].seller_username != null);

  const detail = await rpc(tokens.bob, 'market_get', { p_listing_id: listingId });
  check('listing detail works', detail.ok && detail.data.images.length === 1);
  check('view count increments for non-owner', detail.ok && detail.data.view_count >= 1);

  const favorite = await rpc(tokens.bob, 'market_toggle_favorite', { p_listing_id: listingId });
  check('favorite toggles', favorite.ok && favorite.data.favorite === true);

  const favorites = await rpc(tokens.bob, 'market_list', { p_favorites: true });
  check('favorites filter works', favorites.ok && favorites.data.items.length === 1);

  const order = await rpc(tokens.bob, 'market_create_order', {
    p_items: [{ listing_id: listingId, quantity: 1 }],
    p_contact: {
      contact_name: 'Burak Test',
      contact_phone: '+905000000000',
      shipping_city: 'Trabzon',
      shipping_address: 'Sahil Mah. 1',
      note: 'Akşam teslim',
    },
  });
  check('order request created', order.ok && Boolean(order.data?.order_no), JSON.stringify(order.data));
  check('no payment is collected', order.ok && order.data.total_cents === 1850000);
  const orderId = order.data.id;

  const ownListingOrder = await rpc(tokens.alice, 'market_create_order', {
    p_items: [{ listing_id: listingId, quantity: 1 }],
  });
  check('cannot buy own listing', !ownListingOrder.ok);

  const sellerOrders = await rpc(tokens.alice, 'market_orders', { p_role: 'seller' });
  check('seller sees the order', sellerOrders.ok && sellerOrders.data.items.length === 1);

  const confirm = await rpc(tokens.alice, 'market_update_order_status', {
    p_order_id: orderId,
    p_status: 'confirmed',
  });
  check('seller confirms order', confirm.ok && confirm.data.status === 'confirmed');

  const illegalTransition = await rpc(tokens.alice, 'market_update_order_status', {
    p_order_id: orderId,
    p_status: 'completed',
  });
  check('invalid order transition blocked', !illegalTransition.ok);

  await rpc(tokens.alice, 'market_update_order_status', { p_order_id: orderId, p_status: 'shipped' });
  const delivered = await rpc(tokens.alice, 'market_update_order_status', {
    p_order_id: orderId,
    p_status: 'delivered',
  });
  check('seller marks delivered', delivered.ok);

  const review = await rpc(tokens.bob, 'market_submit_review', {
    p_order_id: orderId,
    p_rating: 5,
    p_comment: 'Sorunsuz teslimat',
  });
  check('buyer can review delivered order', review.ok);

  const seller = await rpc(tokens.bob, 'market_seller', { p_user_id: ids.alice });
  check('seller rating aggregates', seller.ok && Number(seller.data.rating) === 5);

  const bobEditListing = await rpc(tokens.bob, 'market_update_listing', {
    p_listing_id: listingId,
    p_payload: { title: 'ele geçir' },
  });
  check('non-seller cannot edit listing', !bobEditListing.ok);

  const aliceEdit = await rpc(tokens.alice, 'market_update_listing', {
    p_listing_id: listingId,
    p_payload: { price_cents: 1800000 },
  });
  check('seller can edit own listing', aliceEdit.ok && aliceEdit.data.price_cents === 1800000);

  // --- Moderation ----------------------------------------------------------
  await runSql(
    `insert into public.user_role_assignments (user_id, role_key) values ('${ids.mod}', 'moderator') on conflict do nothing;`,
  );

  const stats = await rpc(tokens.mod, 'admin_social_stats');
  check('moderator reads platform stats', stats.ok && stats.data.posts >= 2, JSON.stringify(stats.data));

  const content = await rpc(tokens.mod, 'admin_content_list', { p_kind: 'post' });
  check('moderator lists content', content.ok && content.data.items.length >= 2);

  const hide = await rpc(tokens.mod, 'admin_content_moderate', {
    p_kind: 'post',
    p_id: postId,
    p_action: 'hide',
    p_reason: 'Topluluk kuralları ihlali',
  });
  check('moderator hides a post', hide.ok && hide.data.moderation_status === 'hidden');

  const hiddenFeed = await rpc(tokens.bob, 'feed_list', {});
  check(
    'hidden post disappears from feed',
    hiddenFeed.ok && hiddenFeed.data.items.every((p) => p.id !== postId),
  );

  const restore = await rpc(tokens.mod, 'admin_content_moderate', {
    p_kind: 'post',
    p_id: postId,
    p_action: 'restore',
  });
  check('moderator restores content', restore.ok && restore.data.moderation_status === 'visible');

  const bobModerate = await rpc(tokens.bob, 'admin_content_moderate', {
    p_kind: 'post',
    p_id: postId,
    p_action: 'remove',
  });
  check('regular user cannot moderate', !bobModerate.ok, `status ${bobModerate.status}`);

  const category = await rpc(tokens.mod, 'admin_category_upsert', {
    p_slug: `test-kategori-${stamp}`.slice(0, 40),
    p_name: 'Test Kategori',
    p_sort: 999,
  });
  check('moderator creates category', category.ok && Boolean(category.data?.id));

  const removed = await rpc(tokens.mod, 'admin_category_delete', { p_id: category.data.id });
  check('moderator deactivates category', removed.ok);

  const adminOrders = await rpc(tokens.mod, 'admin_orders_list', {});
  check('moderator sees orders', adminOrders.ok && adminOrders.data.items.length >= 1);

  // Account deletion cascade should remove social content without errors.
  await request(`/auth/v1/admin/users/${ids.alice}`, { method: 'DELETE', token: service, key: service });
  created.splice(created.indexOf(ids.alice), 1);
  const remaining = await runSql(
    `select count(*)::int as n from public.posts where author_id = '${ids.alice}';`,
  );
  check('deleting a user removes their posts', remaining[0]?.n === 0);

  console.log(`\n${total - failures}/${total} checks passed.`);
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
