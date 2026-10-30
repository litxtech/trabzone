import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import {
  useAddCashTransaction,
  useCashOverview,
  useDailyReport,
  useReverseCashTransaction,
  useSaveCashAccount,
  useTransferCash,
} from '../hooks/use-accommodation';
import type { CashTransaction } from '../types';
import {
  CASH_ACCOUNT_LABELS,
  CASH_TRANSACTION_LABELS,
  formatDate,
  formatDateLong,
  formatMoneyCents,
  parseMoneyToCents,
  todayIso,
} from '../utils/format';
import {
  AccCard,
  Chip,
  ChipsRow,
  DateField,
  EmptyState,
  InfoBanner,
  InlineError,
  KeyValueRow,
  LoadingBlock,
  ModalSheet,
  MoneyText,
  StatTile,
  StatusPill,
} from './AccommodationUI';

type ModalKind = 'transaction' | 'transfer' | 'account' | null;

export function CashFolioCenter({ propertyId }: { propertyId: string }) {
  const { theme } = useTheme();
  const [date, setDate] = useState(todayIso);
  const [modal, setModal] = useState<ModalKind>(null);
  const [reverseTarget, setReverseTarget] = useState<CashTransaction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cash = useCashOverview(propertyId);
  const daily = useDailyReport(propertyId, date);
  const reverse = useReverseCashTransaction();
  const accounts = cash.data?.accounts ?? [];
  const transactions = cash.data?.transactions ?? [];

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <AppText variant="h3">Kasa ve tahsilat</AppText>
          <AppText variant="caption" color="textTertiary">
            Nakit, POS ve banka hesapları · tahsilatlar doğrudan silinmez, ters kayıtla düzeltilir
          </AppText>
        </View>
        <View style={styles.headActions}>
          <Button
            label="İşlem ekle"
            size="sm"
            fullWidth={false}
            leftIcon={<Ionicons name="add" size={16} color="#FFFFFF" />}
            onPress={() => setModal('transaction')}
          />
          <Button label="Virman" variant="outline" size="sm" fullWidth={false} onPress={() => setModal('transfer')} />
          <Button label="Hesap" variant="ghost" size="sm" fullWidth={false} onPress={() => setModal('account')} />
        </View>
      </View>

      {error ? <InlineError message={error} /> : null}

      {cash.isLoading ? (
        <LoadingBlock height={160} />
      ) : cash.isError ? (
        <InlineError
          message={cash.error instanceof Error ? cash.error.message : 'Kasa verisi yüklenemedi.'}
          onRetry={() => void cash.refetch()}
        />
      ) : (
        <>
          <View style={styles.accountGrid}>
            {accounts.map((account) => (
              <AccCard key={account.id} padding={12} style={styles.accountCard}>
                <View style={styles.accountHead}>
                  <View style={[styles.accountIcon, { backgroundColor: theme.colors.primarySoft }]}>
                    <Ionicons
                      name={account.kind === 'cash' ? 'cash-outline' : account.kind === 'pos' ? 'card-outline' : 'business-outline'}
                      size={16}
                      color={theme.colors.primaryDeep}
                    />
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong" numberOfLines={1}>
                      {account.name}
                    </AppText>
                    <AppText variant="caption" color="textTertiary">
                      {CASH_ACCOUNT_LABELS[account.kind]} · {account.currency}
                    </AppText>
                  </View>
                  <StatusPill
                    label={account.active === false ? 'Pasif' : 'Aktif'}
                    color={account.active === false ? theme.colors.textTertiary : theme.colors.success}
                    background={account.active === false ? theme.colors.surfaceMuted : theme.colors.successSoft}
                  />
                </View>
                <MoneyText cents={account.balance_cents} currency={account.currency} variant="h3" color={theme.colors.primaryDeep} />
                <View style={styles.accountMeta}>
                  <AppText variant="caption" color="textTertiary">
                    Bugün tahsilat
                  </AppText>
                  <AppText variant="caption" color="success">
                    +{formatMoneyCents(account.today_collected_cents, account.currency)}
                  </AppText>
                </View>
              </AccCard>
            ))}
            {accounts.length === 0 ? (
              <EmptyState
                icon="wallet-outline"
                title="Kasa hesabı yok"
                message="İlk nakit, POS veya banka hesabını oluşturarak tahsilat almaya başla."
                actionLabel="Hesap oluştur"
                onAction={() => setModal('account')}
              />
            ) : null}
          </View>

          <View style={styles.sectionHead}>
            <View style={styles.flex}>
              <AppText variant="h3">Günlük finans</AppText>
              <AppText variant="caption" color="textTertiary">
                {formatDateLong(date)} · tahsilat ve konaklama geliri ayrı
              </AppText>
            </View>
            <View style={{ width: 170 }}>
              <DateField label="Tarih" value={date} onChange={setDate} />
            </View>
          </View>

          {daily.isLoading ? (
            <LoadingBlock height={100} />
          ) : daily.data ? (
            <View style={styles.dailyGrid}>
              <View style={styles.dailyTile}>
                <StatTile label="Bugün tahsil edilen" value={formatMoneyCents(daily.data.net_cents)} icon="download-outline" tone="success" hint="Nakit + POS + banka - iade" />
              </View>
              <View style={styles.dailyTile}>
                <StatTile label="Konaklama geliri" value={formatMoneyCents(daily.data.revenue_cents)} icon="bed-outline" tone="primary" hint="Gece bazında tahakkuk" />
              </View>
              <View style={styles.dailyTile}>
                <StatTile label="Ek hizmet geliri" value={formatMoneyCents(daily.data.extra_income_cents)} icon="restaurant-outline" />
              </View>
              <View style={styles.dailyTile}>
                <StatTile label="Nakit" value={formatMoneyCents(daily.data.cash_cents)} icon="cash-outline" />
              </View>
              <View style={styles.dailyTile}>
                <StatTile label="POS" value={formatMoneyCents(daily.data.pos_cents)} icon="card-outline" />
              </View>
              <View style={styles.dailyTile}>
                <StatTile label="Banka" value={formatMoneyCents(daily.data.bank_cents)} icon="business-outline" />
              </View>
              <View style={styles.dailyTile}>
                <StatTile label="İadeler" value={formatMoneyCents(daily.data.refunds_cents)} icon="return-down-back-outline" tone="danger" />
              </View>
              <View style={styles.dailyTile}>
                <StatTile label="Açık bakiye" value={formatMoneyCents(daily.data.open_balance_cents)} icon="alert-circle-outline" tone="warning" />
              </View>
            </View>
          ) : null}

          <AccCard padding={12} style={{ gap: 3 }}>
            <KeyValueRow label="Günlük gider" value={formatMoneyCents(daily.data?.expenses_cents ?? 0)} />
            <KeyValueRow label="Tahakkuk eden komisyon" value={formatMoneyCents(daily.data?.commission_accrued_cents ?? 0)} />
            <KeyValueRow label="Giriş / çıkış" value={`${daily.data?.arrivals ?? 0} giriş · ${daily.data?.departures ?? 0} çıkış`} />
          </AccCard>

          <AppText variant="h3" style={{ paddingTop: 2 }}>
            Son kasa hareketleri
          </AppText>
          <View style={styles.list}>
            {transactions.slice(0, 50).map((transaction) => (
              <View key={transaction.id} style={[styles.transaction, { borderBottomColor: theme.colors.divider }]}>
                <View
                  style={[
                    styles.transactionIcon,
                    {
                      backgroundColor:
                        transaction.kind === 'expense' || transaction.kind === 'refund'
                          ? theme.colors.dangerSoft
                          : transaction.kind === 'collection'
                            ? theme.colors.successSoft
                            : theme.colors.surfaceMuted,
                    },
                  ]}
                >
                  <Ionicons
                    name={
                      transaction.kind === 'collection'
                        ? 'arrow-down-outline'
                        : transaction.kind === 'expense'
                          ? 'arrow-up-outline'
                          : transaction.kind === 'refund'
                            ? 'return-down-back-outline'
                            : 'swap-horizontal-outline'
                    }
                    size={15}
                    color={
                      transaction.kind === 'collection'
                        ? theme.colors.success
                        : transaction.kind === 'expense' || transaction.kind === 'refund'
                          ? theme.colors.danger
                          : theme.colors.textSecondary
                    }
                  />
                </View>
                <View style={styles.flex}>
                  <View style={styles.transactionHead}>
                    <AppText variant="caption" color="text" numberOfLines={1}>
                      {CASH_TRANSACTION_LABELS[transaction.kind]} · {transaction.account_name}
                    </AppText>
                    {transaction.reverses_id ? (
                      <StatusPill label="Ters kayıt" color={theme.colors.textTertiary} background={theme.colors.surfaceMuted} />
                    ) : null}
                  </View>
                  <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                    {formatDate(transaction.occurred_on)} · {transaction.description ?? 'Açıklama yok'}
                    {transaction.reservation_code ? ` · ${transaction.reservation_code}` : ''}
                    {transaction.actor_name ? ` · ${transaction.actor_name}` : ''}
                  </AppText>
                </View>
                <AppText
                  variant="caption"
                  color={
                    transaction.kind === 'collection'
                      ? 'success'
                      : transaction.kind === 'expense' || transaction.kind === 'refund'
                        ? 'danger'
                        : 'text'
                  }
                  style={styles.amount}
                >
                  {transaction.kind === 'collection' ? '+' : transaction.kind === 'expense' || transaction.kind === 'refund' ? '-' : ''}
                  {formatMoneyCents(transaction.amount_cents, transaction.currency)}
                </AppText>
                {!transaction.reverses_id ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Ters kayıt oluştur"
                    onPress={() => setReverseTarget(transaction)}
                    style={[styles.reverseButton, { backgroundColor: theme.colors.surfaceMuted }]}
                  >
                    <Ionicons name="arrow-undo-outline" size={13} color={theme.colors.textTertiary} />
                  </Pressable>
                ) : null}
              </View>
            ))}
            {transactions.length === 0 ? (
              <EmptyState icon="receipt-outline" title="Hareket yok" message="Tahsilat veya gider eklediğinde burada listelenir." />
            ) : null}
          </View>
        </>
      )}

      <TransactionModal
        visible={modal === 'transaction'}
        onClose={() => setModal(null)}
        propertyId={propertyId}
        accounts={accounts}
        onSaved={() => {
          setModal(null);
          void cash.refetch();
          void daily.refetch();
        }}
      />
      <TransferModal
        visible={modal === 'transfer'}
        onClose={() => setModal(null)}
        propertyId={propertyId}
        accounts={accounts}
        onSaved={() => {
          setModal(null);
          void cash.refetch();
        }}
      />
      <AccountModal
        visible={modal === 'account'}
        onClose={() => setModal(null)}
        propertyId={propertyId}
        onSaved={() => {
          setModal(null);
          void cash.refetch();
        }}
      />
      <ModalSheet
        visible={Boolean(reverseTarget)}
        onClose={() => setReverseTarget(null)}
        title="Ters kayıt oluştur"
        subtitle={reverseTarget ? `${CASH_TRANSACTION_LABELS[reverseTarget.kind]} · ${formatMoneyCents(reverseTarget.amount_cents)}` : undefined}
        maxWidth={520}
        footer={
          <Button
            label="Ters kaydı onayla"
            variant="danger"
            loading={reverse.isPending}
            onPress={async () => {
              if (!reverseTarget) return;
              setError(null);
              try {
                await reverse.mutateAsync({ transactionId: reverseTarget.id, note: 'Yetkili düzeltme' });
                setReverseTarget(null);
                void cash.refetch();
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : 'Ters kayıt oluşturulamadı.');
              }
            }}
          />
        }
      >
        <InfoBanner
          tone="warning"
          text="Finansal hareketler doğrudan silinmez. Ters kayıt, aynı tutarda zıt yönde yeni bir hareket oluşturur ve geçmiş korunur."
        />
        {error ? <InlineError message={error} /> : null}
      </ModalSheet>
    </View>
  );
}

function TransactionModal({
  visible,
  onClose,
  propertyId,
  accounts,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  propertyId: string;
  accounts: { id: string; name: string; kind: string }[];
  onSaved: () => void;
}) {
  const add = useAddCashTransaction(propertyId);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [kind, setKind] = useState<'collection' | 'expense' | 'refund' | 'adjustment'>('collection');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    const cents = parseMoneyToCents(amount);
    if (!accountId) {
      setError('Kasa hesabı seç.');
      return;
    }
    if (!cents || cents <= 0) {
      setError('Geçerli bir tutar gir.');
      return;
    }
    try {
      await add.mutateAsync({
        accountId,
        kind,
        amountCents: cents,
        occurredOn: date,
        description: description.trim() || null,
      });
      setAmount('');
      setDescription('');
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Kasa hareketi kaydedilemedi.');
    }
  };

  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      title="Kasa hareketi"
      subtitle="Tahsilat, gider, iade veya düzeltme"
      maxWidth={560}
      footer={<Button label="Kaydet" loading={add.isPending} onPress={() => void save()} />}
    >
      <View style={{ gap: 10 }}>
        <ChipsRow>
          {(['collection', 'expense', 'refund', 'adjustment'] as const).map((value) => (
            <Chip key={value} label={CASH_TRANSACTION_LABELS[value]} active={kind === value} onPress={() => setKind(value)} />
          ))}
        </ChipsRow>
        <ChipsRow>
          {accounts.map((account) => (
            <Chip key={account.id} label={account.name} active={accountId === account.id} onPress={() => setAccountId(account.id)} />
          ))}
        </ChipsRow>
        <TextField
          label="Tutar (₺)"
          value={amount}
          onChangeText={(next) => setAmount(next.replace(/[^\d.,]/g, ''))}
          keyboardType="decimal-pad"
          placeholder="0,00"
        />
        <DateField label="İşlem tarihi" value={date} onChange={setDate} />
        <TextField label="Açıklama" value={description} onChangeText={setDescription} placeholder="Tahsilat / gider açıklaması" multiline />
        {error ? <InlineError message={error} /> : null}
        <AppText variant="caption" color="textTertiary">
          Kaydedilen hareket silinemez; hatalı işlemler ters kayıtla düzeltilir.
        </AppText>
      </View>
    </ModalSheet>
  );
}

function TransferModal({
  visible,
  onClose,
  propertyId,
  accounts,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  propertyId: string;
  accounts: { id: string; name: string; kind: string }[];
  onSaved: () => void;
}) {
  const transfer = useTransferCash(propertyId);
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    const cents = parseMoneyToCents(amount);
    if (!fromId || !toId || fromId === toId) {
      setError('Farklı iki kasa hesabı seç.');
      return;
    }
    if (!cents || cents <= 0) {
      setError('Geçerli bir tutar gir.');
      return;
    }
    try {
      await transfer.mutateAsync({ fromAccountId: fromId, toAccountId: toId, amountCents: cents, note: note.trim() || null });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Virman yapılamadı.');
    }
  };

  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      title="Kasa virmanı"
      subtitle="Hesaplar arası transfer"
      maxWidth={520}
      footer={<Button label="Virmanı yap" loading={transfer.isPending} onPress={() => void save()} />}
    >
      <View style={{ gap: 10 }}>
        <AppText variant="label" color="textSecondary">
          Kaynak hesap
        </AppText>
        <ChipsRow>
          {accounts.map((account) => (
            <Chip key={account.id} label={account.name} active={fromId === account.id} onPress={() => setFromId(account.id)} />
          ))}
        </ChipsRow>
        <AppText variant="label" color="textSecondary">
          Hedef hesap
        </AppText>
        <ChipsRow>
          {accounts.map((account) => (
            <Chip key={account.id} label={account.name} active={toId === account.id} onPress={() => setToId(account.id)} />
          ))}
        </ChipsRow>
        <TextField label="Tutar (₺)" value={amount} onChangeText={(next) => setAmount(next.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad" />
        <TextField label="Not" value={note} onChangeText={setNote} placeholder="Virman açıklaması" />
        {error ? <InlineError message={error} /> : null}
      </View>
    </ModalSheet>
  );
}

function AccountModal({
  visible,
  onClose,
  propertyId,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  propertyId: string;
  onSaved: () => void;
}) {
  const save = useSaveCashAccount(propertyId);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'cash' | 'pos' | 'bank'>('cash');
  const [opening, setOpening] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Hesap adı zorunludur.');
      return;
    }
    try {
      await save.mutateAsync({
        name: name.trim(),
        kind,
        opening_balance_cents: parseMoneyToCents(opening) ?? 0,
        active: true,
      });
      setName('');
      setOpening('');
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Hesap oluşturulamadı.');
    }
  };

  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      title="Yeni kasa hesabı"
      subtitle="Nakit, POS veya banka hesabı"
      maxWidth={480}
      footer={<Button label="Hesap oluştur" loading={save.isPending} onPress={() => void submit()} />}
    >
      <View style={{ gap: 10 }}>
        <TextField label="Hesap adı" value={name} onChangeText={setName} placeholder="Örn. Resepsiyon nakit kasası" />
        <ChipsRow>
          <Chip label="Nakit kasa" active={kind === 'cash'} onPress={() => setKind('cash')} />
          <Chip label="POS" active={kind === 'pos'} onPress={() => setKind('pos')} />
          <Chip label="Banka" active={kind === 'bank'} onPress={() => setKind('bank')} />
        </ChipsRow>
        <TextField
          label="Açılış bakiyesi (₺)"
          value={opening}
          onChangeText={(next) => setOpening(next.replace(/[^\d.,]/g, ''))}
          keyboardType="decimal-pad"
          placeholder="0,00"
        />
        {error ? <InlineError message={error} /> : null}
      </View>
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  headActions: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  accountGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  accountCard: { width: '32.4%', minWidth: 200, gap: 5 },
  accountHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  accountIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  accountMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionHead: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingTop: 4 },
  dailyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dailyTile: { width: '23.4%', minWidth: 150, flexGrow: 1 },
  list: { gap: 0 },
  transaction: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  transactionIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  transactionHead: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  amount: { fontVariant: ['tabular-nums'], fontWeight: '700' },
  reverseButton: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
});
