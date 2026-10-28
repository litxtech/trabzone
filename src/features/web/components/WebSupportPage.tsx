import { Ionicons } from '@expo/vector-icons';
import { Link, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText, Button, Card, Skeleton, TextField } from '@/components/ui';
import { useCreateTicket } from '@/features/safety/hooks/use-safety-mutations';
import { useMyTickets, useSafetyFaqs } from '@/features/safety/hooks/use-safety';
import type { SupportCategoryCode } from '@/features/safety/types';
import { useLivePresence } from '@/features/live-support/hooks/use-live-support';
import { useContactChannels } from '@/features/web-content/hooks/use-web-content';
import { useAuthStatus } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';

import { useWebMeta } from '../use-web-meta';
import { WebFooter } from './WebFooter';
import { WebHeader } from './WebHeader';

type WebCategory = {
  key: string;
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  backend: SupportCategoryCode;
  urgent?: boolean;
};

const WEB_CATEGORIES: WebCategory[] = [
  { key: 'account', label: 'Hesabım', description: 'Profil, hesap ve ayarlar', icon: 'person-circle-outline', backend: 'account_access' },
  { key: 'login', label: 'Giriş Problemleri', description: 'Şifre, oturum ve doğrulama', icon: 'key-outline', backend: 'account_access' },
  { key: 'register', label: 'Kayıt Problemleri', description: 'Hesap oluşturma adımları', icon: 'person-add-outline', backend: 'account_access' },
  { key: 'marketplace', label: 'Marketplace', description: 'İlan, sipariş ve satıcılar', icon: 'bag-handle-outline', backend: 'content' },
  { key: 'real_estate', label: 'Emlak İlanları', description: 'Kiralık ve satılık ilanlar', icon: 'home-outline', backend: 'content' },
  { key: 'messaging', label: 'Mesajlaşma', description: 'Sohbet, medya ve engelleme', icon: 'chatbubbles-outline', backend: 'messaging_calls' },
  { key: 'reels', label: 'Reels ve Gönderiler', description: 'Video, gönderi ve yorumlar', icon: 'videocam-outline', backend: 'content' },
  { key: 'business', label: 'İşletmeler', description: 'İşletme profilleri ve sahiplenme', icon: 'storefront-outline', backend: 'other' },
  { key: 'map', label: 'Harita', description: 'Konum ve keşif sorunları', icon: 'map-outline', backend: 'technical' },
  { key: 'security', label: 'Güvenlik', description: 'Hesap güvenliği ve şüpheli işlemler', icon: 'shield-checkmark-outline', backend: 'security_privacy' },
  { key: 'child_safety', label: 'Çocuk Güvenliği', description: 'Öncelikli ve gizli inceleme', icon: 'heart-circle-outline', backend: 'child_safety', urgent: true },
  { key: 'privacy', label: 'Gizlilik', description: 'Veri işleme ve gizlilik tercihleri', icon: 'lock-closed-outline', backend: 'security_privacy' },
  { key: 'deletion', label: 'Hesap Silme', description: 'Hesap ve veri silme süreci', icon: 'trash-outline', backend: 'account_access' },
  { key: 'technical', label: 'Teknik Sorunlar', description: 'Hata, donma ve performans', icon: 'construct-outline', backend: 'technical' },
  { key: 'other', label: 'Diğer', description: 'Listede olmayan bir konu', icon: 'ellipsis-horizontal-circle-outline', backend: 'other' },
];

const FAQ_FOR_CATEGORY: Record<string, SupportCategoryCode[]> = {
  account: ['account_access'],
  login: ['account_access'],
  register: ['account_access'],
  deletion: ['account_access', 'security_privacy'],
  marketplace: ['content', 'other'],
  real_estate: ['content', 'other'],
  messaging: ['messaging_calls'],
  reels: ['content'],
  business: ['other'],
  map: ['technical'],
  security: ['security_privacy'],
  child_safety: ['child_safety'],
  privacy: ['security_privacy'],
  technical: ['technical'],
  other: ['other'],
};

export function WebSupportPage() {
  const { theme } = useTheme();
  const authStatus = useAuthStatus();
  const isAuthed = authStatus === 'authenticated';
  const { data: faqs, isLoading: faqsLoading } = useSafetyFaqs();
  const { data: presence } = useLivePresence();
  const { data: channels } = useContactChannels();
  const { data: tickets } = useMyTickets();
  const createTicket = useCreateTicket();

  const [query, setQuery] = useState('');
  const [categoryKey, setCategoryKey] = useState<string | null>(null);
  const [openFaqId, setOpenFaqId] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [details, setDetails] = useState('');
  const [receipt, setReceipt] = useState<{ ticket_no: string; status_code: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useWebMeta({
    title: 'Trabzone Destek Merkezi',
    description:
      'Hesap, giriş, Marketplace, Emlak, güvenlik ve çocuk güvenliği konularında yardım alın. Destek talebi oluşturun veya canlı destek başlatın.',
    path: '/support',
  });

  const selectedCategory = WEB_CATEGORIES.find((category) => category.key === categoryKey) ?? null;
  const normalized = query.trim().toLocaleLowerCase('tr-TR');

  const filteredFaqs = useMemo(() => {
    const list = faqs ?? [];
    return list.filter((faq) => {
      const cats = categoryKey ? FAQ_FOR_CATEGORY[categoryKey] ?? [] : null;
      const matchesCategory = !cats || cats.includes(faq.category as SupportCategoryCode);
      const haystack = `${faq.question} ${faq.answer}`.toLocaleLowerCase('tr-TR');
      return matchesCategory && (!normalized || haystack.includes(normalized));
    });
  }, [categoryKey, faqs, normalized]);

  const categoryFAQs = categoryKey ? filteredFaqs : [];
  const searchFAQs = normalized ? filteredFaqs : [];
  const visibleFAQs = selectedCategory ? categoryFAQs : normalized ? searchFAQs : faqs ?? [];

  const submitTicket = () => {
    setError(null);
    setReceipt(null);
    if (!selectedCategory) {
      setError('Lütfen bir destek kategorisi seç.');
      return;
    }
    createTicket.mutate(
      {
        category: selectedCategory.backend,
        subject: subject.trim(),
        body: details.trim(),
      },
      {
        onSuccess: (data) => {
          setReceipt({ ticket_no: data.ticket_no, status_code: data.status_code });
          setSubject('');
          setDetails('');
        },
        onError: (mutationError) => setError(mutationError.message),
      },
    );
  };

  const liveOnline = presence?.online ?? false;
  const channelByKey = new Map((channels ?? []).map((channel) => [channel.key, channel]));
  const childChannel = channelByKey.get('child_safety');

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <WebHeader />

      <View style={styles.hero}>
        <View style={styles.heroInner}>
          <AppText variant="caption" color="#8EA6D8" style={styles.eyebrow}>
            TRABZONE DESTEK MERKEZİ
          </AppText>
          <AppText variant="h1" color="#FFFFFF" style={styles.heroTitle}>
            Yardıma mı ihtiyacın var? Buradayız.
          </AppText>
          <AppText variant="body" color="#A9BDE2" style={styles.heroSummary}>
            Aradığın yanıtı bul, destek talebi oluştur veya canlı destek ekibimizle görüş.
          </AppText>

          <View style={styles.searchWrap}>
            <Ionicons name="search-outline" size={20} color="#6B7FA8" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Nasıl yardımcı olabiliriz?"
              placeholderTextColor="#7F92B9"
              style={styles.searchInput}
            />
            {query.length > 0 ? (
              <Pressable onPress={() => setQuery('')} accessibilityLabel="Aramayı temizle">
                <Ionicons name="close-circle" size={18} color="#7F92B9" />
              </Pressable>
            ) : null}
          </View>

          <View style={styles.heroStatusRow}>
            <View style={styles.heroPill}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: liveOnline ? '#34D399' : '#94A3B8' },
                ]}
              />
              <AppText variant="caption" color="#C9D7F0">
                {liveOnline
                  ? `Canlı destek aktif · ${presence?.agents_online ?? 0} temsilci çevrimiçi`
                  : 'Temsilcilerimiz şu anda çevrimdışı · Mesaj bırakabilirsiniz'}
              </AppText>
            </View>
            <View style={styles.heroPill}>
              <Ionicons name="time-outline" size={13} color="#A8BEE8" />
              <AppText variant="caption" color="#C9D7F0">
                Destek yanıt hedefi: 24 saat
              </AppText>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.body}>
        <View style={styles.sectionHead}>
          <View>
            <AppText variant="h2">Destek kategorileri</AppText>
            <AppText variant="body" color="textSecondary">
              Konunu seç; ilgili yardım içeriklerini ve başvuru formunu görelim.
            </AppText>
          </View>
          {isAuthed ? (
            <Link href={'/support/my-requests' as Href} asChild>
              <Button
                label={tickets?.length ? `Taleplerim (${tickets.length})` : 'Taleplerim'}
                variant="secondary"
                size="sm"
              />
            </Link>
          ) : null}
        </View>

        <View style={styles.categoryGrid}>
          {WEB_CATEGORIES.map((category) => {
            const active = category.key === categoryKey;
            return (
              <Pressable
                key={category.key}
                onPress={() => {
                  setCategoryKey(category.key);
                  setReceipt(null);
                }}
                style={({ pressed }) => [
                  styles.categoryCard,
                  {
                    borderColor: active
                      ? theme.colors.primary
                      : category.urgent
                        ? theme.colors.danger
                        : theme.colors.border,
                    backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <View
                  style={[
                    styles.categoryIcon,
                    {
                      backgroundColor: category.urgent
                        ? theme.colors.dangerSoft
                        : theme.colors.surfaceMuted,
                    },
                  ]}
                >
                  <Ionicons
                    name={category.icon}
                    size={19}
                    color={category.urgent ? theme.colors.danger : theme.colors.primaryDeep}
                  />
                </View>
                <AppText variant="bodyStrong">{category.label}</AppText>
                <AppText variant="caption" color="textSecondary">
                  {category.description}
                </AppText>
                {category.urgent ? (
                  <AppText variant="caption" color="danger">
                    Öncelikli inceleme
                  </AppText>
                ) : null}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.twoColumn}>
          <View style={styles.faqColumn}>
            <Card style={styles.card}>
              <AppText variant="h3">
                {selectedCategory ? `${selectedCategory.label} · Yardım içerikleri` : 'Sık sorulan sorular'}
              </AppText>
              {faqsLoading ? (
                <View style={styles.skeleton}>
                  <Skeleton height={16} width="80%" radius={4} />
                  <Skeleton height={16} width="65%" radius={4} />
                  <Skeleton height={16} width="72%" radius={4} />
                </View>
              ) : null}
              {!faqsLoading && visibleFAQs.length === 0 ? (
                <View style={styles.emptyFaq}>
                  <Ionicons name="information-circle-outline" size={22} color={theme.colors.textTertiary} />
                  <AppText variant="body" color="textSecondary">
                    {selectedCategory
                      ? 'Bu kategori için yayımlanmış bir yardım makalesi bulunamadı. Aşağıdan destek talebi oluşturabilirsin.'
                      : normalized
                        ? 'Aramana uygun bir yardım içeriği bulunamadı. Destek talebi oluşturarak bize ulaşabilirsin.'
                        : 'Bir kategori seçtiğinde ilgili yardım içerikleri burada görünür.'}
                  </AppText>
                </View>
              ) : null}
              {visibleFAQs.map((faq) => {
                const open = openFaqId === String(faq.id);
                return (
                  <View key={String(faq.id)} style={[styles.faqItem, { borderColor: theme.colors.border }]}>
                    <Pressable
                      style={styles.faqQuestion}
                      onPress={() => setOpenFaqId(open ? null : String(faq.id))}
                    >
                      <AppText variant="bodyStrong" style={styles.flex}>
                        {faq.question}
                      </AppText>
                      <Ionicons
                        name={open ? 'remove' : 'add'}
                        size={18}
                        color={theme.colors.primaryDeep}
                      />
                    </Pressable>
                    {open ? (
                      <AppText variant="body" color="textSecondary" style={styles.faqAnswer}>
                        {faq.answer}
                      </AppText>
                    ) : null}
                  </View>
                );
              })}
            </Card>

            <Card style={styles.card}>
              <AppText variant="h3">Destek talebi oluştur</AppText>
              {!isAuthed ? (
                <>
                  <AppText variant="body" color="textSecondary">
                    Talebini hesabına bağlayabilmemiz için giriş yapman gerekiyor. Hesabın yoksa
                    hesap oluşturabilir veya iletişim formunu kullanabilirsin.
                  </AppText>
                  <View style={styles.inlineActions}>
                    <Link href={'/login' as Href} asChild>
                      <Button label="Giriş Yap" size="sm" style={styles.inlineButton} />
                    </Link>
                    <Link href={'/register' as Href} asChild>
                      <Button label="Hesap Oluştur" variant="secondary" size="sm" style={styles.inlineButton} />
                    </Link>
                    <Link href={'/contact' as Href} asChild>
                      <Button label="İletişim" variant="outline" size="sm" style={styles.inlineButton} />
                    </Link>
                  </View>
                </>
              ) : (
                <>
                  <AppText variant="caption" color="textSecondary">
                    Seçili kategori: {selectedCategory?.label ?? 'Henüz seçilmedi'}
                  </AppText>
                  <TextField
                    label="Konu"
                    value={subject}
                    onChangeText={setSubject}
                    placeholder="Talebinin kısa konusu"
                    maxLength={160}
                  />
                  <TextField
                    label="Açıklama"
                    value={details}
                    onChangeText={setDetails}
                    placeholder="Yaşadığın sorunu ve beklediğin çözümü ayrıntılı yaz."
                    multiline
                    numberOfLines={5}
                    maxLength={5000}
                    hint="Görsel veya dosya eklemek için talep oluşturduktan sonra talep detayını kullanabilirsin."
                  />
                  {receipt ? (
                    <View style={[styles.successBox, { backgroundColor: theme.colors.successSoft }]}>
                      <Ionicons name="checkmark-circle-outline" size={18} color={theme.colors.success} />
                      <View style={styles.flex}>
                        <AppText variant="bodyStrong">Talebin alındı</AppText>
                        <AppText variant="caption" color="textSecondary">
                          Takip numaran: {receipt.ticket_no}. Durumu Taleplerim sayfasından
                          izleyebilirsin.
                        </AppText>
                      </View>
                    </View>
                  ) : null}
                  {error ? (
                    <View style={[styles.errorBox, { backgroundColor: theme.colors.dangerSoft }]}>
                      <Ionicons name="alert-circle-outline" size={16} color={theme.colors.danger} />
                      <AppText variant="caption" color="danger" style={styles.flex}>
                        {error}
                      </AppText>
                    </View>
                  ) : null}
                  <Button
                    label={createTicket.isPending ? 'Gönderiliyor…' : 'Destek talebi gönder'}
                    loading={createTicket.isPending}
                    disabled={!selectedCategory || subject.trim().length < 3 || details.trim().length < 10}
                    onPress={submitTicket}
                  />
                </>
              )}
            </Card>
          </View>

          <View style={styles.aside}>
            <Card style={styles.liveCard}>
              <View style={styles.liveHead}>
                <View
                  style={[
                    styles.liveIcon,
                    { backgroundColor: liveOnline ? theme.colors.successSoft : theme.colors.surfaceMuted },
                  ]}
                >
                  <Ionicons
                    name="headset-outline"
                    size={22}
                    color={liveOnline ? theme.colors.success : theme.colors.textTertiary}
                  />
                </View>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">Canlı Destek</AppText>
                  <View style={styles.liveStatusRow}>
                    <View
                      style={[
                        styles.statusDot,
                        { backgroundColor: liveOnline ? theme.colors.success : theme.colors.textTertiary },
                      ]}
                    />
                    <AppText variant="caption" color="textSecondary">
                      {liveOnline ? 'Canlı destek aktif' : 'Temsilciler çevrimdışı'}
                    </AppText>
                  </View>
                </View>
              </View>
              <AppText variant="caption" color="textSecondary">
                {liveOnline
                  ? 'Destek ekibimiz çevrimiçi. Görüşme başlatarak gerçek zamanlı yazışabilirsin.'
                  : 'Şu anda temsilcilerimiz çevrimdışı. Mesaj bırakabilirsin; ekibimiz döndüğünde yanıtlar.'}
              </AppText>
              <Link href={(isAuthed ? '/support/live' : '/login') as Href} asChild>
                <Button
                  label={isAuthed ? 'Canlı destek başlat' : 'Giriş yapıp başlat'}
                  size="sm"
                />
              </Link>
              <AppText variant="caption" color="textTertiary">
                7/24 canlı hizmet garanti edilmez. Talepler çalışma saatlerinde yanıtlanır.
              </AppText>
            </Card>

            {childChannel ? (
              <Card style={[styles.childCard, { borderColor: theme.colors.danger }]}>
                <View style={styles.liveHead}>
                  <View style={[styles.liveIcon, { backgroundColor: theme.colors.dangerSoft }]}>
                    <Ionicons name="heart-circle-outline" size={22} color={theme.colors.danger} />
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong" color="danger">
                      Çocuk güvenliği bildirimi
                    </AppText>
                    <AppText variant="caption" color="textSecondary">
                      Öncelikli ve gizli inceleme
                    </AppText>
                  </View>
                </View>
                <AppText variant="caption" color="textSecondary">
                  Çocuk istismarı veya sömürüsüne ilişkin bildirimler ayrı öncelikli kuyrukta
                  incelenir. Acil durumlarda yerel yetkili mercilere de başvurun.
                </AppText>
                <Link href={'/child-safety' as Href} asChild>
                  <Button label="Politikayı oku" variant="outline" size="sm" />
                </Link>
                <Link href={`mailto:${childChannel.email ?? 'support@litxtech.com'}` as Href} asChild>
                  <Button label={childChannel.email ?? 'E-posta gönder'} variant="secondary" size="sm" />
                </Link>
              </Card>
            ) : null}

            <Card tone="muted" elevated={false} style={styles.card}>
              <AppText variant="bodyStrong">Diğer kanallar</AppText>
              <Link href={'/contact' as Href} asChild>
                <Pressable style={styles.channelRow}>
                  <Ionicons name="mail-outline" size={17} color={theme.colors.primaryDeep} />
                  <AppText variant="caption" color="textSecondary" style={styles.flex}>
                    İletişim sayfası ve doğrulanmış e-posta adresleri
                  </AppText>
                  <Ionicons name="chevron-forward" size={14} color={theme.colors.textTertiary} />
                </Pressable>
              </Link>
              <Link href={'/data-requests' as Href} asChild>
                <Pressable style={styles.channelRow}>
                  <Ionicons name="shield-checkmark-outline" size={17} color={theme.colors.primaryDeep} />
                  <AppText variant="caption" color="textSecondary" style={styles.flex}>
                    KVKK ve veri talepleri merkezi
                  </AppText>
                  <Ionicons name="chevron-forward" size={14} color={theme.colors.textTertiary} />
                </Pressable>
              </Link>
              <Link href={'/delete-account' as Href} asChild>
                <Pressable style={styles.channelRow}>
                  <Ionicons name="trash-outline" size={17} color={theme.colors.primaryDeep} />
                  <AppText variant="caption" color="textSecondary" style={styles.flex}>
                    Hesap silme
                  </AppText>
                  <Ionicons name="chevron-forward" size={14} color={theme.colors.textTertiary} />
                </Pressable>
              </Link>
            </Card>
          </View>
        </View>
      </View>

      <WebFooter />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  hero: { backgroundColor: '#07152E', paddingTop: 58, paddingBottom: 48, paddingHorizontal: 20 },
  heroInner: { width: '100%', maxWidth: 1160, alignSelf: 'center' },
  eyebrow: { letterSpacing: 1.6, marginBottom: 10 },
  heroTitle: { maxWidth: 820 },
  heroSummary: { marginTop: 12, maxWidth: 700, lineHeight: 24 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 14,
    paddingHorizontal: 14,
    marginTop: 22,
    maxWidth: 640,
  },
  searchInput: { flex: 1, color: '#FFFFFF', fontSize: 15, paddingVertical: 15 },
  heroStatusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  heroPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  body: {
    width: '100%',
    maxWidth: 1160,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 34,
    paddingBottom: 50,
    gap: 20,
  },
  sectionHead: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
  },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  categoryCard: {
    width: 196,
    minHeight: 122,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },
  categoryIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  twoColumn: { flexDirection: 'row', flexWrap: 'wrap', gap: 22, alignItems: 'flex-start' },
  faqColumn: { flex: 1, minWidth: 300, maxWidth: 760, gap: 16 },
  aside: { width: 320, gap: 16 },
  card: { gap: 12, padding: 20 },
  skeleton: { gap: 10 },
  emptyFaq: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 10 },
  faqItem: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  faqQuestion: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  faqAnswer: { paddingHorizontal: 14, paddingBottom: 14 },
  inlineActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  inlineButton: { minWidth: 130 },
  successBox: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: 10 },
  errorBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 12, borderRadius: 10 },
  liveCard: { gap: 12, padding: 20 },
  liveHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  liveIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  childCard: { gap: 10, padding: 20, borderWidth: 1 },
  channelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
});
