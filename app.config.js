// Builds on app.json. The shipped Android app is denied the INTERNET permission, so it cannot
// reach the network at all. Development builds need it to load code from the computer, and are
// requested with EDOC_DEV=1.
module.exports = ({ config }) => {
  if (process.env.EDOC_DEV) {
    config.android.blockedPermissions = config.android.blockedPermissions.filter(
      (permission) => permission !== 'android.permission.INTERNET',
    );
  }
  return config;
};
