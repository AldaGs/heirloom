/**
 * Decode any non-RAW image to an ImageBitmap.
 * HEIC/HEIF: Safari decodes it natively; elsewhere we fall back to libheif (WASM, lazy-loaded so it
 * costs nothing until the first HEIC shows up).
 */
export const HEIC_EXT = /\.(heic|heif|hif)$/i;
export const isHeicName = (name: string, type = '') => HEIC_EXT.test(name) || /^image\/hei[cf]/.test(type);

export async function decodeBitmap(blob: Blob, name = ''): Promise<ImageBitmap> {
  const heic = isHeicName(name, blob.type);
  try { return await createImageBitmap(blob); }
  catch (e) { if (!heic) throw e; }
  const { heicTo } = await import('heic-to');
  return heicTo({ blob, type: 'bitmap' });
}
