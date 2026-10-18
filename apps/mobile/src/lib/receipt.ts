import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { api } from './api';

/** Downloads the receipt (authenticated), saves it to the app cache and opens the share sheet. */
export async function downloadReceipt(invoiceId: string, invoiceNumber: string): Promise<void> {
  const html = await api.text(`/invoices/${invoiceId}/receipt`);
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${invoiceNumber}.html`;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  const file = new File(Paths.cache, `${invoiceNumber}.html`);
  file.create({ overwrite: true });
  file.write(html);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(file.uri, { mimeType: 'text/html', dialogTitle: `Receipt ${invoiceNumber}` });
}
