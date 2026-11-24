import { fireEvent, render, screen } from '@testing-library/react-native';

import { Button, ChipGroup, ConfirmDialog, EmptyState, ErrorState, IconButton, PermissionPrompt, ProgressBar } from '@/components/ui';
import { ApiError } from '@/api/client';

describe('accessibility of core UI', () => {
  it('Button exposes role, label and disabled/busy state', async () => {
    await render(<Button label="Guardar" loading onPress={() => {}} />);
    const b = screen.getByRole('button', { name: 'Guardar' });
    expect(b).toBeDisabled();
    expect(b).toBeBusy();
  });

  it('IconButton requires and exposes a label', async () => {
    const onPress = jest.fn();
    await render(<IconButton icon="x" label="Cerrar" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onPress).toHaveBeenCalled();
  });

  it('single-select ChipGroup uses radio semantics', async () => {
    const onChange = jest.fn();
    await render(<ChipGroup options={[{ id: 'a', label: 'Casual' }, { id: 'b', label: 'Formal' }]} value="a" onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'Casual' })).toBeChecked();
    await fireEvent.press(screen.getByRole('radio', { name: 'Formal' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('multi-select ChipGroup uses checkbox semantics', async () => {
    const onChange = jest.fn();
    await render(<ChipGroup multiple options={[{ id: 'a', label: 'Negro' }, { id: 'b', label: 'Blanco' }]} value={['a']} onChange={onChange} />);
    expect(screen.getByRole('checkbox', { name: 'Negro' })).toBeChecked();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Blanco' }));
    expect(onChange).toHaveBeenCalledWith(['a', 'b']);
  });

  it('ProgressBar reports its value', async () => {
    await render(<ProgressBar value={0.42} testID="pb" />);
    expect(screen.getByTestId('pb')).toHaveAccessibilityValue({ min: 0, max: 100, now: 42 });
  });

  it('ErrorState shows the API Spanish message and a retry button', async () => {
    const retry = jest.fn();
    await render(<ErrorState error={new ApiError(422, 'validation', 'La categoría es obligatoria.')} onRetry={retry} />);
    expect(screen.getByText('La categoría es obligatoria.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
    expect(retry).toHaveBeenCalled();
  });

  it('EmptyState title is a header', async () => {
    await render(<EmptyState title="Tu armario está vacío" body="Añade tu primera prenda" />);
    expect(screen.getByRole('header', { name: 'Tu armario está vacío' })).toBeOnTheScreen();
  });

  it('PermissionPrompt explains and offers Settings when permanently denied', async () => {
    await render(<PermissionPrompt kind="camera" status="denied" canAskAgain={false} onRequest={() => {}} />);
    expect(screen.getByRole('button', { name: 'Abrir Ajustes' })).toBeOnTheScreen();
  });

  it('ConfirmDialog with a required input blocks confirmation until filled', async () => {
    const onConfirm = jest.fn();
    await render(
      <ConfirmDialog visible title="¿Borrar?" input={{ label: 'Contraseña', secure: true, required: true }} onConfirm={onConfirm} onCancel={() => {}} testID="dlg" />,
    );
    expect(screen.getByTestId('dlg-confirm')).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('dlg-input'), 'secreto');
    await fireEvent.press(screen.getByTestId('dlg-confirm'));
    expect(onConfirm).toHaveBeenCalledWith('secreto');
  });
});
