// Wraps app.json so the Firebase config can come from an EAS secret file
// variable on cloud builds (google-services.json is gitignored and is not
// uploaded with the project). Locally the checked-out file is used.
//
// APP_VARIANT=check (eas build --profile check) builds "Sweam Check": the same
// release build (R8 on) under its own package, co.sweam.app.check, so it can be
// installed on a phone next to the Google Play app for testing. It has no
// Firebase config, so it never registers for push.
const config = require('./app.json');

module.exports = () => {
  if (process.env.APP_VARIANT === 'check') {
    const { googleServicesFile: _omit, ...android } = config.expo.android;
    return {
      ...config.expo,
      name: 'Sweam Check',
      android: { ...android, package: 'co.sweam.app.check' },
    };
  }
  return {
    ...config.expo,
    android: {
      ...config.expo.android,
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
    },
  };
};
