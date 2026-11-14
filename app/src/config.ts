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

/** The API in use. Only the in-app mock exists until the core team ships /v1/field. */
export const API_MODE: 'mock' = 'mock';
