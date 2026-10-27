import type * as AlternateIconsModule from 'expo-alternate-app-icons';

import type { AppIconId } from '@/features/profile/services/profile-service';

/**
 * Aurora is the default icon shipped in the binary, so it maps to `null`
 * (reset). The other two live as alternate icons added by the config plugin.
 */
export const APP_ICON_NATIVE_NAME: Record<AppIconId, string | null> = {
  aurora: null,
  orbit: 'Orbit',
  nova: 'Nova',
};

type IconsModule = typeof AlternateIconsModule;

let cached: IconsModule | null | undefined;

/**
 * `expo-alternate-app-icons` throws on import when the native module is not
 * linked (Expo Go, web). Loading it lazily keeps every other screen usable and
 * lets the UI explain the limitation instead of crashing.
 */
function loadModule(): IconsModule | null {
  if (cached !== undefined) {
    return cached;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('expo-alternate-app-icons') as IconsModule;
  } catch {
    cached = null;
  }
  return cached;
}

export function supportsAppIconSwitching(): boolean {
  const module = loadModule();
  return module?.supportsAlternateIcons ?? false;
}

/** The icon currently applied to this install, as a Trabzone icon id. */
export function readActiveAppIcon(): AppIconId {
  const module = loadModule();
  if (!module?.supportsAlternateIcons) {
    return 'aurora';
  }
  try {
    const active = module.getAppIconName();
    if (active === APP_ICON_NATIVE_NAME.orbit) {
      return 'orbit';
    }
    if (active === APP_ICON_NATIVE_NAME.nova) {
      return 'nova';
    }
  } catch {
    // getAppIconName throws while the springboard animation is running.
  }
  return 'aurora';
}

export class AppIconUnavailableError extends Error {
  constructor() {
    super('Uygulama simgesi bu derlemede değiştirilemiyor.');
    this.name = 'AppIconUnavailableError';
  }
}

export async function applyAppIcon(icon: AppIconId): Promise<void> {
  const module = loadModule();
  if (!module?.supportsAlternateIcons) {
    throw new AppIconUnavailableError();
  }
  await module.setAlternateAppIcon(APP_ICON_NATIVE_NAME[icon]);
}
