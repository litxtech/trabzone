import { Platform } from 'react-native';

import { WebDeleteAccountPage } from '@/features/web/components/WebDeleteAccountPage';

import NativeDeleteAccountScreen from './settings/delete-account';

export default function DeleteAccountScreen() {
  return Platform.OS === 'web' ? <WebDeleteAccountPage /> : <NativeDeleteAccountScreen />;
}
