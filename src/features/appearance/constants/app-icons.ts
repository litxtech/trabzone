import type { AppIconId } from '@/features/profile/services/profile-service';

export type AppIconOption = {
  id: AppIconId;
  label: string;
  description: string;
  /** `require()` tarafından üretilen yerel görsel kimliği. */
  source: number;
};

export const APP_ICON_OPTIONS: AppIconOption[] = [
  {
    id: 'aurora',
    label: 'Aurora',
    description: 'Varsayılan · derin mavi ışık',
    source: require('../../../../assets/brand/icons/icon-aurora.png'),
  },
  {
    id: 'orbit',
    label: 'Orbit',
    description: 'Yörünge çizgileri',
    source: require('../../../../assets/brand/icons/icon-orbit.png'),
  },
  {
    id: 'nova',
    label: 'Nova',
    description: 'Parlak nova patlaması',
    source: require('../../../../assets/brand/icons/icon-nova.png'),
  },
];
