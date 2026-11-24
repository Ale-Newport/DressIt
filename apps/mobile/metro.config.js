// Metro config for the pnpm monorepo (node-linker=hoisted).
// - watchFolders: the whole repo so changes in packages/shared hot-reload.
// - nodeModulesPaths: app first, then the hoisted root node_modules.
// - packages/shared uses explicit `.ts` import specifiers (`./colors.ts`):
//   Metro resolves exact file paths before trying extensions, so no extra
//   resolver hook is needed; `sourceExts` already includes ts/tsx.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const escape = (p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// The app never imports backend code: keep the API / vision service (and local
// export outputs) out of Metro's file map.
config.resolver.blockList = [
  new RegExp(`^${escape(path.join(workspaceRoot, 'services'))}[/\\\\].*`),
  new RegExp(`^${escape(path.join(projectRoot, 'dist-ios'))}[/\\\\].*`),
  new RegExp(`^${escape(path.join(projectRoot, 'dist-android'))}[/\\\\].*`),
];

module.exports = config;
