import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { useSettingsStore } from '@/stores/settings-store';

const canVibrate = Platform.OS !== 'web';

function run(action: () => Promise<void>) {
  if (!canVibrate || !useSettingsStore.getState().hapticsEnabled) {
    return;
  }
  action().catch(() => {
    // Haptics are decorative; unsupported devices must not break the flow.
  });
}

export const haptics = {
  tap: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  press: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
  selection: () => run(() => Haptics.selectionAsync()),
};
