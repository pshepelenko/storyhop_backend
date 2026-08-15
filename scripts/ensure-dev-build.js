const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');

const requiredOutputs = [
  'dist/main.js',
  'dist/finder.js',
  'dist/chats/chats.service.js',
];

function rebuild(reason) {
  console.log(`[start:dev] ${reason} — running full build...`);
  execSync('npx rimraf dist tsconfig.build.tsbuildinfo', { stdio: 'inherit', cwd: root, shell: true });
  execSync('npm run build', { stdio: 'inherit', cwd: root });
}

const missing = requiredOutputs.filter((rel) => !fs.existsSync(path.join(root, rel)));
if (missing.length) {
  rebuild(`Incomplete dist output (${missing.join(', ')})`);
}
