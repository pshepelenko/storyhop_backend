const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const mainPath = path.join(__dirname, '..', 'dist', 'main.js');

if (!fs.existsSync(mainPath)) {
  console.log('[start:prod] dist/main.js not found — running build...');
  execSync('npx rimraf dist tsconfig.build.tsbuildinfo', { stdio: 'inherit', cwd: path.join(__dirname, '..'), shell: true });
  execSync('npm run build', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
}
