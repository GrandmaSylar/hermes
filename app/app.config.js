// Expo reads this whenever it needs the app's settings: starting the dev server and building or exporting a release.
// app.json stays the source of the settings; this file only adds the safety check below.
//
// A release talks to the field server with staff PINs, so if a server address is set it must be https://.
// Leaving it unset is allowed (the app then runs on demo data and says so on the sign-in screen).
// Expo sets NODE_ENV to production for exports and release builds and to development for `expo start`,
// so testing against a local http server in development is not affected.
module.exports = ({ config }) => {
  if (process.env.NODE_ENV === 'production') {
    const api = (process.env.EXPO_PUBLIC_API_URL ?? '').trim();
    if (api && !/^https:\/\//i.test(api)) {
      throw new Error('EXPO_PUBLIC_API_URL must be an https:// address in a release build (staff PINs travel in these requests)');
    }
  }
  return config;
};
