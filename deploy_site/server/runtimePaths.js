const path = require('path');

const IS_AZURE = !!process.env.WEBSITE_INSTANCE_ID;
const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '';
const REPO_ROOT = path.join(__dirname, '..');
const APP_SCOPE = (process.env.APP_SCOPE || '').trim().toLowerCase() || 'default';
const APP_SCOPE_DIR = APP_SCOPE === 'default' ? 'crickethub' : `crickethub-${APP_SCOPE}`;

const DEFAULT_APP_DATA_ROOT = IS_AZURE
  ? path.join(HOME_DIR || '/home', 'site', 'data', APP_SCOPE_DIR)
  : __dirname;

const APP_DATA_ROOT = process.env.APP_DATA_DIR || DEFAULT_APP_DATA_ROOT;

module.exports = {
  IS_AZURE,
  HOME_DIR,
  REPO_ROOT,
  APP_SCOPE,
  APP_DATA_ROOT,
};
