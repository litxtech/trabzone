import { FeatureNotice } from '@/features/navigation/components/FeatureNotice';

export default function MessagesScreen() {
  return (
    <FeatureNotice
      headerTitle="Mesajlar"
      icon="chatbubbles-outline"
      title="Mesajlar hazırlanıyor"
      description="Sohbetler, okundu bilgisi ve gerçek zamanlı iletim altyapısı tamamlandığında burada açılacak."
      bullets={[
        'Birebir ve grup sohbetleri',
        'Sesli ve görüntülü arama',
        'Medya, sesli mesaj ve dosya paylaşımı',
      ]}
    />
  );
}
