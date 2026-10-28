import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';

import { AppText, Badge, Button, Card } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { errorMessage } from '@/services/errors';
import { useTheme } from '@/theme/ThemeProvider';

import { RideHeader } from '@/features/ride/components/RideHeader';
import {
  useEmergencyContacts,
  useMyTrips,
  useRemoveEmergencyContact,
  useSaveEmergencyContact,
  useSendSos,
} from '@/features/ride/hooks/use-ride';

const CHECKLIST = [
  'Rezervasyon öncesi sürücünün doğrulanmış olduğunu ve plakayı kontrol et.',
  'Biniş kodunu yalnızca araca bindiğinde sürücüye göster.',
  'Araç, sürücü ve plaka rezervasyondaki bilgilerle uyuşmuyorsa yolculuğa başlama.',
  'Güvenilir kişilerinle süreli konum bağlantısını paylaş.',
  'Rahatsız olduğunda yolculuğu sonlandır ve güvenlik olayı bildir.',
  'Acil durumda 112’yi ara; Trabzone resmi acil yardım hizmeti değildir.',
];

export default function RideSafetyScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const contacts = useEmergencyContacts();
  const trips = useMyTrips('active');
  const save = useSaveEmergencyContact();
  const remove = useRemoveEmergencyContact();
  const sos = useSendSos();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [relation, setRelation] = useState('');
  const [notify, setNotify] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeTrip = trips.data?.[0] ?? null;

  const handleAdd = async () => {
    setError(null);
    if (name.trim().length < 2 || phone.replace(/\D/g, '').length < 10) {
      setError('Ad ve geçerli telefon numarası gir.');
      return;
    }
    try {
      await save.mutateAsync({
        name: name.trim(),
        phone: phone.trim(),
        relation: relation.trim() || null,
        notifyOnSos: notify,
      });
      setName('');
      setPhone('');
      setRelation('');
      setNotice('Güvenilir kişi eklendi.');
    } catch (cause) {
      setError(errorMessage(cause, 'Kişi eklenemedi.'));
    }
  };

  const handleSos = () => {
    if (!activeTrip) {
      Alert.alert(
        'Aktif yolculuk yok',
        'SOS kaydı yalnızca devam eden bir yolculukta oluşturulabilir. Acil durumda 112’yi arayabilirsin.',
        [
          { text: 'Kapat', style: 'cancel' },
          { text: '112 ara', style: 'destructive', onPress: () => void Linking.openURL('tel:112') },
        ],
      );
      return;
    }
    Alert.alert(
      'SOS gönderilsin mi?',
      'Güvenilir kişilerine bildirim gidecek ve 112 arama ekranı açılacak. Trabzone acil yardım hizmeti değildir.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'SOS gönder',
          style: 'destructive',
          onPress: () =>
            sos.mutate(
              { reservationId: activeTrip.id, note: 'Güvenlik merkezinden SOS' },
              {
                onSuccess: (result) => {
                  setNotice(
                    `${result.contacts.length} güvenilir kişiye bildirim gönderildi. ${result.disclaimer}`,
                  );
                },
                onError: (cause) => setError(cause.message),
              },
            ),
        },
      ],
    );
    void Linking.openURL('tel:112');
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} scroll padded>
      <RideHeader
        title="Güvenlik merkezi"
        subtitle="SOS, güvenilir kişiler ve güvenli yolculuk kuralları"
        right={<Badge label="112" tone="danger" />}
      />

      <Card padding={15} style={[styles.sosCard, { borderColor: theme.colors.danger }]}>
        <View style={styles.sosHead}>
          <View style={[styles.sosIcon, { backgroundColor: theme.colors.dangerSoft }]}>
            <Ionicons name="warning" size={24} color={theme.colors.danger} />
          </View>
          <View style={styles.flex}>
            <AppText variant="h3">Acil durum</AppText>
            <AppText variant="caption" color="textSecondary">
              {activeTrip
                ? `Aktif yolculuk: ${activeTrip.origin_city} → ${activeTrip.dest_city}`
                : 'Devam eden yolculuk yok. 112 her zaman kullanılabilir.'}
            </AppText>
          </View>
        </View>
        <View style={styles.actionRow}>
          <Button
            label="SOS gönder"
            variant="danger"
            loading={sos.isPending}
            onPress={handleSos}
            style={styles.flex}
          />
          <Button
            label="112'yi ara"
            variant="outline"
            onPress={() => void Linking.openURL('tel:112')}
            style={styles.flex}
          />
        </View>
        <AppText variant="caption" color="textTertiary">
          Trabzone resmi acil yardım hizmeti yerine geçmez. SOS kaydı, konum ve zaman bilgisiyle
          sınırlı yetkili güvenlik ekibine iletilir.
        </AppText>
      </Card>

      {activeTrip ? (
        <Card padding={15}>
          <View style={styles.activeRow}>
            <View style={styles.flex}>
              <AppText variant="bodyStrong">Yolculuk güvenlik araçları</AppText>
              <AppText variant="caption" color="textTertiary">
                Canlı takip, konum paylaşımı, biniş/iniş doğrulama ve olay bildirimi.
              </AppText>
            </View>
            <Button
              label="Yolculuğa git"
              size="sm"
              fullWidth={false}
              onPress={() => router.navigate(`/ride/trips/${activeTrip.id}` as never)}
            />
          </View>
        </Card>
      ) : null}

      <Card padding={15} style={styles.form}>
        <AppText variant="title">Güvenilir kişiler</AppText>
        <AppText variant="caption" color="textTertiary">
          SOS gönderildiğinde yalnızca bildirim izni verdiğin kişilere konum ve yolculuk bilgisi
          iletilir.
        </AppText>
        {contacts.isLoading ? (
          <AppText variant="caption" color="textTertiary">
            Yükleniyor…
          </AppText>
        ) : (contacts.data?.length ?? 0) === 0 ? (
          <AppText variant="body" color="textSecondary">
            Henüz güvenilir kişi eklemedin.
          </AppText>
        ) : (
          contacts.data?.map((contact, index) => (
            <View
              key={contact.id}
              style={[styles.contactRow, { borderColor: theme.colors.border }]}
            >
              <View style={[styles.contactIndex, { backgroundColor: theme.colors.primarySoft }]}>
                <AppText variant="caption" color="primaryDeep">
                  {index + 1}
                </AppText>
              </View>
              <View style={styles.flex}>
                <AppText variant="label" numberOfLines={1}>
                  {contact.name}
                </AppText>
                <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                  {contact.phone}
                  {contact.relation ? ` · ${contact.relation}` : ''}
                  {contact.notify_on_sos ? ' · SOS bildirimi açık' : ' · SOS bildirimi kapalı'}
                </AppText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${contact.name} kişisini kaldır`}
                onPress={() =>
                  Alert.alert('Kişi kaldırılsın mı?', contact.name, [
                    { text: 'Vazgeç', style: 'cancel' },
                    {
                      text: 'Kaldır',
                      style: 'destructive',
                      onPress: () => remove.mutate(contact.id),
                    },
                  ])
                }
                style={styles.iconSmall}
              >
                <Ionicons name="trash-outline" size={16} color={theme.colors.danger} />
              </Pressable>
            </View>
          ))
        )}

        <View style={styles.form}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Ad soyad"
            placeholderTextColor={theme.colors.textTertiary}
            style={[
              styles.input,
              {
                color: theme.colors.text,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.inputBackground,
              },
            ]}
          />
          <View style={styles.split}>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="Telefon"
              keyboardType="phone-pad"
              placeholderTextColor={theme.colors.textTertiary}
              style={[
                styles.input,
                styles.flex,
                {
                  color: theme.colors.text,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.inputBackground,
                },
              ]}
            />
            <TextInput
              value={relation}
              onChangeText={setRelation}
              placeholder="Yakınlık"
              placeholderTextColor={theme.colors.textTertiary}
              style={[
                styles.input,
                styles.flex,
                {
                  color: theme.colors.text,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.inputBackground,
                },
              ]}
            />
          </View>
          <View style={styles.switchRow}>
            <AppText variant="caption" color="textSecondary" style={styles.flex}>
              SOS bildirimi gönder
            </AppText>
            <Switch
              value={notify}
              onValueChange={setNotify}
              trackColor={{ false: theme.colors.surfaceMuted, true: theme.colors.primarySoft }}
              thumbColor={notify ? theme.colors.primary : theme.colors.textTertiary}
            />
          </View>
          <Button label="Kişi ekle" loading={save.isPending} onPress={() => void handleAdd()} />
        </View>
      </Card>

      <Card padding={15} style={styles.form}>
        <AppText variant="title">Güvenli yolculuk kuralları</AppText>
        {CHECKLIST.map((item) => (
          <View key={item} style={styles.checkRow}>
            <Ionicons name="checkmark-circle" size={15} color={theme.colors.success} />
            <AppText variant="caption" color="textSecondary" style={styles.flex}>
              {item}
            </AppText>
          </View>
        ))}
      </Card>

      <Card padding={15} tone="muted">
        <AppText variant="caption" color="textTertiary">
          Yolculuk sırasında konum paylaşımı açık rızana bağlıdır. Yolculuk bittiğinde paylaşım
          bağlantıları sona erer; sürekli takip yapılmaz.
        </AppText>
      </Card>

      {notice ? (
        <Card padding={12} tone="primarySoft">
          <AppText variant="caption" color="textSecondary">
            {notice}
          </AppText>
        </Card>
      ) : null}
      {error ? (
        <Card padding={12} tone="muted">
          <AppText variant="caption" color="danger">
            {error}
          </AppText>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sosCard: { gap: 10 },
  sosHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sosIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  activeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  form: { gap: 10 },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  contactIndex: {
    width: 26,
    height: 26,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSmall: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
  },
  split: { flexDirection: 'row', gap: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
});
