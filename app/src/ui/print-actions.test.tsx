import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { PrintActions } from './print-actions';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), selectionAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'light' }, NotificationFeedbackType: { Success: 's', Error: 'e' } }));

const mockPrint = jest.fn();
const mockSave = jest.fn();
const mockShare = jest.fn();
jest.mock('@/data/print', () => ({
  printReceipt: (...a: unknown[]) => mockPrint(...a),
  saveReceiptPdf: (...a: unknown[]) => mockSave(...a),
  shareReceiptText: (...a: unknown[]) => mockShare(...a),
  loadPaper: () => Promise.resolve(58),
  savePaper: () => Promise.resolve(),
}));

const lines = ['  Credit Union  ', 'Amount        GHS 10.00', 'Status     PENDING APPROVAL'];

beforeEach(() => {
  jest.clearAllMocks();
  mockPrint.mockResolvedValue({ ok: true });
  mockSave.mockResolvedValue({ ok: true });
  mockShare.mockResolvedValue({ ok: true });
});

describe('print actions', () => {
  test('print sends a page exactly as wide as the paper', async () => {
    await render(<PrintActions lines={lines} paper={58} logo={null} />);
    await fireEvent.press(screen.getByLabelText('Print receipt'));
    await waitFor(() => expect(mockPrint).toHaveBeenCalledTimes(1));
    const page = mockPrint.mock.calls[0][0];
    expect(page.width).toBe(164);
    expect(page.html).toContain('Amount        GHS 10.00');
  });

  test('80 mm paper gives a wider page', async () => {
    await render(<PrintActions lines={lines} paper={80} logo={null} />);
    await fireEvent.press(screen.getByLabelText('Print receipt'));
    await waitFor(() => expect(mockPrint).toHaveBeenCalled());
    expect(mockPrint.mock.calls[0][0].width).toBe(227);
  });

  test('save as PDF and send as text each do their own thing', async () => {
    await render(<PrintActions lines={lines} paper={58} logo={null} />);
    await fireEvent.press(screen.getByLabelText('Save as PDF'));
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    await fireEvent.press(screen.getByText('Send to a printer app as text'));
    await waitFor(() => expect(mockShare).toHaveBeenCalledTimes(1));
    expect(mockShare.mock.calls[0][0]).toBe('  Credit Union\nAmount        GHS 10.00\nStatus     PENDING APPROVAL');
    expect(mockPrint).not.toHaveBeenCalled();
  });

  test('says plainly when printing did not work, and clears it on the next try', async () => {
    mockPrint.mockResolvedValueOnce({ ok: false, message: 'Could not print. Check that a printer or print service is set up on this phone.' });
    await render(<PrintActions lines={lines} paper={58} logo={null} />);
    await fireEvent.press(screen.getByLabelText('Print receipt'));
    expect(await screen.findByText(/Could not print/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Print receipt'));
    await waitFor(() => expect(screen.queryByText(/Could not print/)).toBeNull());
  });
});
