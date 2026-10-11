// Prints the app source that SideStore reads to list eDoc and offer its updates on the phone.
// Usage: node scripts/make-source.mjs <owner/repo> <version> <ipa size in bytes>
const [repository, version, size] = process.argv.slice(2);
if (!repository || !version || !size) {
  console.error('usage: make-source.mjs <owner/repo> <version> <size>');
  process.exit(1);
}

const downloads = `https://github.com/${repository}/releases/latest/download`;
const date = new Date().toISOString();
const description = 'Scan, organise and protect documents. Works entirely on the iPhone, with no connection.';

const source = {
  name: 'eDoc',
  identifier: 'app.edoc.source',
  sourceURL: `${downloads}/source.json`,
  apps: [
    {
      name: 'eDoc',
      bundleIdentifier: 'app.edoc.documents',
      developerName: 'eDoc',
      version,
      versionDate: date,
      versionDescription: `Build ${version}`,
      beta: false,
      size: Number(size),
      localizedDescription: description,
      iconURL: `https://raw.githubusercontent.com/${repository}/main/assets/icon.png`,
      tintColor: '3D7BFF',
      downloadURL: `${downloads}/eDoc.ipa`,
      screenshotURLs: [],
      versions: [
        {
          version,
          date,
          localizedDescription: `Build ${version}`,
          downloadURL: `${downloads}/eDoc.ipa`,
          size: Number(size),
        },
      ],
      permissions: [],
    },
  ],
  news: [],
};

console.log(JSON.stringify(source, null, 2));
