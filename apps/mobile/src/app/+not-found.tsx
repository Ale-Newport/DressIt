import { useRouter } from 'expo-router';

import { EmptyState, Screen } from '@/components/ui';

export default function NotFound() {
  const router = useRouter();
  return (
    <Screen edges={['top', 'bottom']}>
      <EmptyState
        icon="compass"
        title="Esta página no existe"
        body="Puede que el enlace esté incompleto o que el contenido ya no esté disponible."
        actionLabel="Ir al inicio"
        onAction={() => router.replace('/')}
      />
    </Screen>
  );
}
