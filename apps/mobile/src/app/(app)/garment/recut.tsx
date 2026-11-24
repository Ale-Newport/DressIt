import { useLocalSearchParams, useRouter } from 'expo-router';

import type { RecutTarget } from '@/api/hooks';
import { OfflineBanner, Screen } from '@/components/ui';
import { RecutEditor } from '@/components/wardrobe/RecutEditor';

/** `/garment/recut?garmentId=…` or `/garment/recut?jobId=…&detectionId=…` */
export default function RecutScreen() {
  const router = useRouter();
  const p = useLocalSearchParams<{ garmentId?: string; jobId?: string; detectionId?: string }>();
  const target: RecutTarget = p.garmentId ? { garmentId: p.garmentId } : { jobId: p.jobId ?? '', detectionId: p.detectionId ?? '' };
  return (
    <Screen testID="recut-screen">
      <OfflineBanner />
      <RecutEditor target={target} onDone={() => router.back()} />
    </Screen>
  );
}
