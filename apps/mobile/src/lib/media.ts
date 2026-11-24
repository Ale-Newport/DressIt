import * as ImagePicker from 'expo-image-picker';

export type PickResult = { status: 'ok'; uris: string[] } | { status: 'cancelled' } | { status: 'denied'; canAskAgain: boolean };

/**
 * System photo picker (PHPicker on iOS, Android Photo Picker on 13+): the app only
 * receives the photos the user selects, so no library permission is needed.
 */
export async function pickFromLibrary(opts: { multiple?: boolean; limit?: number } = {}): Promise<PickResult> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: !!opts.multiple,
    selectionLimit: opts.multiple ? (opts.limit ?? 50) : 1,
    quality: 1,
    exif: false,
    orderedSelection: true,
  });
  if (res.canceled || !res.assets?.length) return { status: 'cancelled' };
  return { status: 'ok', uris: res.assets.map((a) => a.uri) };
}

/** System camera for a single shot (asks camera permission first). */
export async function takePhoto(): Promise<PickResult> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return { status: 'denied', canAskAgain: perm.canAskAgain };
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: false });
  if (res.canceled || !res.assets?.length) return { status: 'cancelled' };
  return { status: 'ok', uris: res.assets.map((a) => a.uri) };
}
