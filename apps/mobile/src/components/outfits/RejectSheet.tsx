import type { FeedbackRequest } from '@dressit/shared';
import { useEffect, useState } from 'react';

import { Button, ChipGroup, Sheet, Text } from '../ui';

type Reason = NonNullable<FeedbackRequest['reasons']>[number];

const REASONS: Array<{ id: Reason; label: string }> = [
  { id: 'colores', label: 'No me gustan los colores' },
  { id: 'formalidad', label: 'Formalidad inadecuada' },
  { id: 'abrigo', label: 'Demasiado o poco abrigo' },
  { id: 'estilo', label: 'No es mi estilo' },
  { id: 'comodidad', label: 'Poco cómodo' },
  { id: 'repetido', label: 'Me lo he puesto hace poco' },
  { id: 'otro', label: 'Otro motivo' },
];

export interface RejectSheetProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (reasons: Reason[]) => void;
  loading?: boolean;
}

/** Collects optional reasons so the stylist learns from a rejection. */
export function RejectSheet({ visible, onClose, onSubmit, loading }: RejectSheetProps) {
  const [reasons, setReasons] = useState<Reason[]>([]);
  useEffect(() => {
    if (!visible) setReasons([]);
  }, [visible]);
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="¿Por qué no?"
      subtitle="Opcional: nos ayuda a afinar tus próximas sugerencias."
      testID="reject-sheet"
      footer={
        <Button
          label={reasons.length ? 'Descartar con estos motivos' : 'Descartar sin motivo'}
          onPress={() => onSubmit(reasons)}
          loading={loading}
          fullWidth
          testID="reject-submit"
        />
      }
    >
      <ChipGroup options={REASONS} value={reasons} onChange={(v) => setReasons((v as Reason[]) ?? [])} multiple testIDPrefix="reject-reason" accessibilityLabel="Motivos" />
      <Text variant="small" tone="muted">
        Tus motivos solo se usan para ajustar las recomendaciones de tu cuenta.
      </Text>
    </Sheet>
  );
}
