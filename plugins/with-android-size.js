// Keeps the Android app file small: removes unused code and resources, compresses the native
// libraries inside the APK, builds only for 64-bit ARM phones and leaves out image formats
// the app never shows.
const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod, withGradleProperties } = require('expo/config-plugins');

const properties = {
  'android.enableMinifyInReleaseBuilds': 'true',
  'android.enableShrinkResourcesInReleaseBuilds': 'true',
  'expo.useLegacyPackaging': 'true',
  reactNativeArchitectures: 'arm64-v8a',
  'expo.gif.enabled': 'false',
  'expo.webp.enabled': 'false',
};

// The app's own native module is looked up by name, so code shrinking must leave it intact.
const keepRules = '\n# eDoc native module\n-keep class expo.modules.edockit.** { *; }\n';

module.exports = function withAndroidSize(config) {
  config = withGradleProperties(config, (mod) => {
    for (const [key, value] of Object.entries(properties)) {
      const existing = mod.modResults.find((item) => item.type === 'property' && item.key === key);
      if (existing) {
        existing.value = value;
      } else {
        mod.modResults.push({ type: 'property', key, value });
      }
    }
    return mod;
  });

  return withDangerousMod(config, [
    'android',
    async (mod) => {
      const file = path.join(mod.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      if (!current.includes('expo.modules.edockit')) {
        fs.writeFileSync(file, current + keepRules);
      }
      return mod;
    },
  ]);
};
