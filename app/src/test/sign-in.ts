import type { ApiClient } from '@/data/api/contract';
import { MOCK_OTP, MOCK_PASSWORD, MOCK_STAFF_ID } from '@/data/api/mock';
import type { Session } from '@/domain/types';

/** Signs in to the mock the way the app does: password, then the SMS code. */
export async function signInToMock(api: ApiClient, deviceId = 'device-1'): Promise<Session> {
  const first = await api.login(MOCK_STAFF_ID, MOCK_PASSWORD, deviceId);
  if (first.kind === 'SIGNED_IN') return first.session;
  return api.verifyOtp(first.challengeId, MOCK_OTP, deviceId);
}
