import { Stack } from 'expo-router';

import { AuthGate } from '@/features/auth/components/AuthGate';
import { AdminShell } from '@/features/admin/components/AdminShell';
import { useTheme } from '@/theme/ThemeProvider';

export default function AdminLayout() {
  const { theme } = useTheme();

  return (
    <AuthGate>
      <AdminShell>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.colors.background },
            animation: 'fade',
          }}
        />
      </AdminShell>
    </AuthGate>
  );
}
