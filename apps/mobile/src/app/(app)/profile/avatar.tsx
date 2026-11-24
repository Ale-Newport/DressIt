import { AvatarSetup } from '@/components/profile/AvatarSetup';
import { OfflineBanner, Screen, Text } from '@/components/ui';

export default function AvatarScreen() {
  return (
    <Screen testID="avatar-screen">
      <OfflineBanner />
      <Text variant="body" tone="muted">
        Con una foto de tu cara y otra de cuerpo entero, DressIt puede enseñarte cómo te quedan tus conjuntos. Las imágenes se generan con IA, se marcan como tales y pueden no ser exactas.
      </Text>
      <AvatarSetup />
    </Screen>
  );
}
