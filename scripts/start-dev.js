const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

require('./free-port');
require('./ensure-dev-build');

const child = spawn('npx', ['nest', 'start', '--watch'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code) => process.exit(code ?? 0));

process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
