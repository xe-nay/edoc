// Stamps a build's version into the app configuration. Every build gets its own version so
// phones can tell that an update is available.
// Usage: node scripts/set-version.mjs <version> <build number>
import { readFileSync, writeFileSync } from 'node:fs';

const [version, build] = process.argv.slice(2);
const config = JSON.parse(readFileSync('app.json', 'utf8'));
config.expo.version = version;
config.expo.ios.buildNumber = String(build);
// The Android version code is set in app.config.js.
writeFileSync('app.json', JSON.stringify(config, null, 2));
