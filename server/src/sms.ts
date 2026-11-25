import type { Repo, SmsSettings } from './repo';

/**
 * "Received, pending approval" text message for a deposit the server has just stored.
 *
 * It reuses the core's own settings (AppSettings SMS_*) and writes the core's own log
 * (SMSHistory), so the office sees these messages where it already looks. It is only ever
 * started after the pending row is committed, never blocks or fails the deposit response,
 * and is skipped unless both the server switch and the core's SMS_Enabled setting are on.
 */

export const MESSAGE_TYPE = 'DEPOSIT_PENDING';

export interface SmsSendResult {
  success: boolean;
  error?: string | null;
  response?: unknown;
}

export interface SmsProvider {
  send(settings: SmsSettings, phone: string, message: string): Promise<SmsSendResult>;
}

/** Same request shapes and success rules as the core's performSMSSend. */
export class HttpSmsProvider implements SmsProvider {
  constructor(private readonly timeoutMs = 15_000) {}

  async send(s: SmsSettings, phone: string, message: string): Promise<SmsSendResult> {
    if (!s.apiKey || !s.senderId) return { success: false, error: 'SMS configuration incomplete (Missing Key or Sender ID)' };
    const provider = s.provider.toLowerCase();
    let url: string;
    let headers: Record<string, string>;
    let body: unknown;
    if (provider === 'kairosafrika') {
      if (!s.apiSecret) return { success: false, error: 'API Secret required for Kairos Africa' };
      url = 'https://api.kairosafrika.com/v1/external/sms/quick';
      headers = { 'x-api-key': s.apiKey, 'x-api-secret': s.apiSecret };
      body = { to: phone, from: s.senderId, message, type: 'Quick' };
    } else if (provider === 'nalo') {
      url = 'https://sms.nalosolutions.com/smsbackend/Resl_Nalo/send-message/';
      headers = {};
      body = { key: s.apiKey, type: 0, destination: phone, source: s.senderId, message };
    } else {
      url = s.apiUrl || 'https://sms.arkesel.com/api/v2/sms/send';
      headers = { 'api-key': s.apiKey };
      body = { sender: s.senderId, message, recipients: [phone], sandbox: false };
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const text = await res.text();
      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text.slice(0, 500) };
      }
      const httpOk = res.status >= 200 && res.status < 300;
      let ok: boolean;
      if (provider === 'kairosafrika') {
        ok =
          httpOk &&
          (String(data?.status || '').toLowerCase() === 'success' ||
            data?.success === true ||
            String(data?.code || '').toLowerCase() === 'success' ||
            !!(data?.data?.id || data?.id));
      } else if (provider === 'nalo') {
        ok = httpOk && (String(data?.status) === '1701' || data?.status === 'success');
      } else {
        ok =
          httpOk &&
          (String(data?.status || '').toLowerCase() === 'success' ||
            ['ok', '1000', '2000'].includes(String(data?.code || '').toLowerCase()) ||
            (Array.isArray(data?.data) && data.data.length > 0));
      }
      return { success: ok, error: ok ? null : String(data?.message || 'Provider rejected request'), response: data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Network error' };
    }
  }
}

export interface PendingDeposit {
  /** The app's localTransactionId. */
  localTransactionId: string;
  /** The reference stored on the row, used as the SMSHistory ReferenceNo (dedupe key). */
  storedReference: string;
  customerCode: string;
  branchCode: string;
  officerId: string;
  amount: string;
  productName: string;
}

export interface NotifierOptions {
  repo: Repo;
  provider: SmsProvider;
  /** SMS_PENDING_ENABLED. The core's own SMS_Enabled setting must also be on. */
  enabled: boolean;
  now?: () => Date;
  log?: (message: string) => void;
}

export class PendingSmsNotifier {
  private readonly inflight = new Set<Promise<void>>();
  private readonly now: () => Date;
  private readonly log: (message: string) => void;

  constructor(private readonly opts: NotifierOptions) {
    this.now = opts.now ?? (() => new Date());
    this.log = opts.log ?? ((m) => console.warn(m));
  }

  /** Start the text message in the background. Never throws and never needs awaiting. */
  schedule(deposit: PendingDeposit): void {
    if (!this.opts.enabled) return;
    const job: Promise<void> = new Promise<void>((resolve) => setImmediate(resolve))
      .then(async () => {
        await this.notify(deposit);
      })
      .catch((error) => this.log(`pending-deposit SMS failed: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => this.inflight.delete(job));
    this.inflight.add(job);
  }

  /** Resolves when every scheduled message has finished (tests and graceful shutdown). */
  async idle(): Promise<void> {
    while (this.inflight.size > 0) await Promise.all([...this.inflight]);
  }

  /** Exposed for tests. Resolves true when a message was handed to the provider. */
  async notify(d: PendingDeposit): Promise<boolean> {
    if (!this.opts.enabled) return false;
    const { repo, provider } = this.opts;
    const settings = await repo.getSmsSettings();
    if (!settings.enabled || !settings.apiKey || !settings.senderId) return false;
    if (await repo.hasSmsLog(d.storedReference, MESSAGE_TYPE)) return false;

    const to = await repo.getSmsRecipient(d.customerCode);
    if (!to.phone || to.optedOut) return false;

    const message = pendingMessage(to.firstName || to.fullName, d.amount, d.productName, d.localTransactionId);
    const result = await provider.send(settings, to.phone, message);
    await repo.logSms(MESSAGE_TYPE, {
      phone: to.phone,
      message,
      status: result.success ? 'SENT' : 'FAILED',
      recipientName: to.fullName,
      customerCode: d.customerCode,
      referenceNo: d.storedReference,
      branchCode: d.branchCode,
      userId: d.officerId,
      error: result.success ? null : String(result.error ?? 'Unknown error').slice(0, 500),
      apiResponse: JSON.stringify(result.response ?? {}).slice(0, 4000),
      sentAt: this.now(),
    });
    return true;
  }
}

export function pendingMessage(name: string, amount: string, productName: string, localId: string): string {
  const who = name.trim() || 'member';
  const product = productName.trim() || 'account';
  return `Dear ${who}, GHS ${amount} received for your ${product} account, pending approval. Ref: ${shortRef(localId)}`;
}

/** A short reference a member can quote: the first 8 characters of the app's id. */
export function shortRef(localId: string): string {
  return localId.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase();
}

/** Same normalisation as the core's memberPhone.smsPhone: 0XXXXXXXXX, 2x/5x mobile ranges only. */
export function smsPhone(raw: unknown): string | null {
  if (raw == null) return null;
  for (const part of String(raw).split(/[\/,;|]|\bor\b/i)) {
    const digits = part.replace(/\D/g, '');
    let nine: string | null = null;
    if (digits.length === 12 && digits.startsWith('233')) nine = digits.slice(3);
    else if (digits.length === 13 && digits.startsWith('2330')) nine = digits.slice(4);
    else if (digits.length === 10 && digits.startsWith('0')) nine = digits.slice(1);
    else if (digits.length === 9) nine = digits;
    if (nine && /^[25]\d{8}$/.test(nine)) return `0${nine}`;
  }
  return null;
}
