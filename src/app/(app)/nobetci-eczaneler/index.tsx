import { Redirect } from 'expo-router';

/**
 * `/nobetci-eczaneler` kısa yolunu eczane dizinine yönlendirir.
 *
 * Web'de bu adresi `api/pharmacy.js` sunucu tarafında işler (SSR/SEO);
 * uygulama içi deep link'te ise aynı içerik `/eczaneler` ekranında açılır.
 */
export default function DutyPharmaciesIndexRedirect() {
  return <Redirect href={{ pathname: '/eczaneler', params: { mode: 'duty_today' } }} />;
}
