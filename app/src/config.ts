/**
 * Build-time configuration.
 *
 * ALLOW_UNENCRYPTED_DB is a development escape hatch for Expo Go, which does
 * not include SQLCipher. It only works in a development build of the app
 * (__DEV__) AND when EXPO_PUBLIC_ALLOW_UNENCRYPTED_DB=true is set. In every
 * other case the app refuses to open an unencrypted database.
 */
export const ALLOW_UNENCRYPTED_DB =
  __DEV__ && process.env.EXPO_PUBLIC_ALLOW_UNENCRYPTED_DB === 'true';

/**
 * Tidies the server address so a small slip in .env does not break every call:
 * spaces, a trailing slash and a trailing "/v1" (the app adds /v1 itself) are removed.
 */
export function cleanApiUrl(raw: string | undefined): string {
  let url = (raw ?? '').trim();
  while (url.endsWith('/')) url = url.slice(0, -1);
  if (url.toLowerCase().endsWith('/v1')) url = url.slice(0, -3);
  while (url.endsWith('/')) url = url.slice(0, -1);
  return url;
}

/**
 * The core banking system's base URL, for example https://staging.example.com.
 * Set EXPO_PUBLIC_API_URL when building. With no URL the app runs against its
 * built-in demo data and says so on screen, so a demo build can never be
 * mistaken for a connected one.
 */
export const API_URL: string = cleanApiUrl(process.env.EXPO_PUBLIC_API_URL);
export const API_MODE: 'http' | 'mock' = API_URL ? 'http' : 'mock';
