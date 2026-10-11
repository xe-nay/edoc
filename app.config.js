// Builds on app.json.
module.exports = ({ config }) => {
  // Android only installs an update whose version code is higher than the installed one.
  // Minutes since the start of 2026 always grows, wherever the build is made.
  config.android.versionCode = Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 60000);

  // The shipped Android app is denied the INTERNET permission, so it cannot reach the network
  // at all. Development builds need it to load code from the computer, and are requested
  // with EDOC_DEV=1.
  if (process.env.EDOC_DEV) {
    config.android.blockedPermissions = config.android.blockedPermissions.filter(
      (permission) => permission !== 'android.permission.INTERNET',
    );
  }
  return config;
};
