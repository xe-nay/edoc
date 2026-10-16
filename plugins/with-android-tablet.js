// Phones stay upright; tablets follow the way they are held, landscape included. The app's
// screen orientation setting stays portrait for phones and is lifted at start-up on tablets.
const { withMainActivity } = require('expo/config-plugins');

const marker = 'smallestScreenWidthDp';

const unlock = `    // Tablets follow the way they are held; phones stay upright.
    if (resources.configuration.smallestScreenWidthDp >= 600) {
      requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_FULL_USER
    }
`;

module.exports = function withAndroidTablet(config) {
  return withMainActivity(config, (mod) => {
    const source = mod.modResults.contents;
    if (!source.includes(marker)) {
      const anchor = '    super.onCreate(null)';
      if (!source.includes(anchor)) {
        throw new Error('with-android-tablet: MainActivity.onCreate not found');
      }
      mod.modResults.contents = source.replace(anchor, unlock + anchor);
    }
    return mod;
  });
};
