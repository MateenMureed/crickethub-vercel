const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function hasExpressInstalled(projectRoot) {
  const expressPackagePath = path.join(projectRoot, 'node_modules', 'express', 'package.json');
  return fs.existsSync(expressPackagePath);
}

function installProductionDependencies(projectRoot) {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npmCmd, ['ci', '--omit=dev', '--no-audit'], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(`npm ci failed with exit code ${result.status}`);
  }
}

(function bootstrap() {
  const projectRoot = path.resolve(__dirname, '..');

  if (!hasExpressInstalled(projectRoot)) {
    console.log('Production dependencies not found. Installing with npm ci --omit=dev...');
    installProductionDependencies(projectRoot);
  }

  require(path.join(projectRoot, 'server', 'server.js'));
})();
