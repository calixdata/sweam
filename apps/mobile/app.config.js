// Wraps app.json so the Firebase config can come from an EAS secret file
// variable on cloud builds (google-services.json is gitignored and is not
// uploaded with the project). Locally the checked-out file is used.
const config = require('./app.json');

module.exports = () => ({
  ...config.expo,
  android: {
    ...config.expo.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
  },
});
