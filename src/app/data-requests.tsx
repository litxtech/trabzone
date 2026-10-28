import { Platform } from 'react-native';

import { WebDataRequestsPage } from '@/features/web/components/WebDataRequestsPage';

import NativeDataRequestsScreen from './settings/data-requests';

export default function DataRequestsScreen() {
  return Platform.OS === 'web' ? <WebDataRequestsPage /> : <NativeDataRequestsScreen />;
}
