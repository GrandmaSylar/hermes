import * as SecureStore from 'expo-secure-store';
import { Share } from 'react-native';
import type { PaperWidth, PrintPage } from '@/domain/receipt';

/**
 * Getting a receipt out of the phone. Three ways, because credit unions use different equipment:
 *  - print: the phone's own print service. An Android POS with a built-in printer (Sunmi, iMin and similar) lists it
 *    there; so does any AirPrint or Wi-Fi printer.
 *  - save: a PDF exactly as wide as the paper, to keep, email, or hand to a printer app.
 *  - text: the receipt as plain monospace text, for printer apps that take text (RawBT and the like).
 * Each answers with whether it worked and, if not, a sentence to show.
 */

export type Outcome = { ok: true } | { ok: false; message: string };

export async function printReceipt(page: PrintPage): Promise<Outcome> {
  try {
    const Print = require('expo-print') as typeof import('expo-print');
    await Print.printAsync({ html: page.html, width: page.width, height: page.height });
    return { ok: true };
  } catch (e) {
    // Closing the print dialog is not a failure.
    const text = e instanceof Error ? e.message : '';
    if (/cancel|dismiss/i.test(text)) return { ok: true };
    return { ok: false, message: 'Could not print. Check that a printer or print service is set up on this phone.' };
  }
}

/** Saves the receipt as a PDF and opens the share sheet, from which it can be saved to Files, sent, or printed. */
export async function saveReceiptPdf(page: PrintPage): Promise<Outcome> {
  try {
    const Print = require('expo-print') as typeof import('expo-print');
    const Sharing = require('expo-sharing') as typeof import('expo-sharing');
    const file = await Print.printToFileAsync({ html: page.html, width: page.width, height: page.height });
    if (!(await Sharing.isAvailableAsync())) return { ok: false, message: 'Saving is not available on this phone.' };
    await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Save or send receipt' });
    return { ok: true };
  } catch {
    return { ok: false, message: 'Could not save the receipt. Try again.' };
  }
}

/** Shares the receipt as plain text, for a printer app. */
export async function shareReceiptText(text: string): Promise<Outcome> {
  try {
    await Share.share({ message: text });
    return { ok: true };
  } catch {
    return { ok: false, message: 'Could not share the receipt.' };
  }
}

// ---- the paper in the printer ----------------------------------------------------------------------------------

const PAPER_KEY = 'receipt.paper';

/** Which paper the printer takes, remembered so it is chosen once. 58 mm is the most common on handheld POS. */
export async function loadPaper(): Promise<PaperWidth> {
  try {
    return (await SecureStore.getItemAsync(PAPER_KEY)) === '80' ? 80 : 58;
  } catch {
    return 58;
  }
}

export async function savePaper(paper: PaperWidth): Promise<void> {
  try {
    await SecureStore.setItemAsync(PAPER_KEY, String(paper));
  } catch {
    // Applies for this session.
  }
}
