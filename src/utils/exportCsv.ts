/** Native file attachment; share-sheet completion does not assert that a recipient saved it. */
export async function exportCsv(filename: string, content: string): Promise<void> {
  const [{ File, Paths }, sharing] = await Promise.all([import('expo-file-system'), import('expo-sharing')]);
  if (!await sharing.isAvailableAsync()) throw new Error('REPORT_SHARING_UNAVAILABLE');
  const file = new File(Paths.cache, filename);
  file.create({ overwrite: true });
  try {
    file.write(content);
    await sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: filename });
  } finally { file.delete(); }
}
