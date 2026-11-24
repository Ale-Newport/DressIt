import { useRouter } from 'expo-router';

import { useMe } from '@/api/hooks/me';
import { CityPicker } from '@/components/profile/CityPicker';
import { OfflineBanner, Screen } from '@/components/ui';

export default function LocationScreen() {
  const router = useRouter();
  const me = useMe();
  return (
    <Screen testID="location-screen">
      <OfflineBanner />
      <CityPicker currentName={me.data?.location?.name ?? null} onSaved={() => router.back()} />
    </Screen>
  );
}
