#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const root = process.cwd();
const isTTY = Boolean(output.isTTY);
const color = (code, value) => isTTY ? `\u001b[${code}m${value}\u001b[0m` : value;
const c = {
  title: (v) => color('1;36', v),
  accent: (v) => color('1;35', v),
  success: (v) => color('1;32', v),
  warning: (v) => color('1;33', v),
  error: (v) => color('1;31', v),
  muted: (v) => color('2;37', v),
};

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^export\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/) || line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

const fileEnv = parseEnvFile(`${root}/.env`);
const env = { ...fileEnv, ...process.env };

function option(name, fallback) {
  const index = process.argv.findIndex((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
  if (index < 0) return fallback;
  const current = process.argv[index];
  if (current.includes('=')) return current.slice(current.indexOf('=') + 1);
  return process.argv[index + 1] ?? fallback;
}

const hasFlag = (name) => process.argv.includes(`--${name}`) || process.argv.some((arg) => arg.startsWith(`--${name}=`));
const positional = process.argv.slice(2).filter((arg, index, all) => {
  if (!arg.startsWith('--')) return index === 0 || !all[index - 1]?.startsWith('--');
  return false;
});
const requestedAction = option('action', positional[0]);
const dryRun = hasFlag('dry-run');
const assumeYes = hasFlag('yes') || hasFlag('non-interactive');

const config = {
  registry: option('registry', env.FAINENS_IMAGE_REGISTRY || 'docker.io'),
  namespace: option('namespace', env.FAINENS_IMAGE_NAMESPACE || 'fainens'),
  tag: option('tag', env.FAINENS_IMAGE_TAG || 'latest'),
  frontendPort: option('frontend-port', env.FAINENS_FRONTEND_PORT || '8082'),
};
config.frontendImage = `${config.registry}/${config.namespace}/fainens-frontend:${config.tag}`;
config.backendImage = `${config.registry}/${config.namespace}/fainens-backend:${config.tag}`;

function promptInterface() {
  return createInterface({ input, output });
}

async function askRequiredText(rl, label, fallback = '') {
  while (true) {
    const value = await askText(rl, label, fallback);
    if (value) return value;
    console.log(c.warning('This value is required.'));
    fallback = '';
  }
}

async function askText(rl, label, fallback = '') {
  const suffix = fallback ? ` [${fallback}]` : '';
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  return answer || fallback;
}

async function askSecret(label, current = '', optional = false, reader = null) {
  const suffix = current ? ' [press Enter to keep current value]' : optional ? ' [optional]' : '';
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    const rl = promptInterface();
    const answer = (await rl.question(`${label}${suffix}: `)).trim();
    rl.close();
    return answer || current;
  }
  output.write(`${label}${suffix}: `);
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const onData = (chunk) => {
      for (const key of chunk.toString()) {
        if (key === '\u0003') {
          cleanup();
          reject(new Error('Setup cancelled.'));
          return;
        }
        if (key === '\r' || key === '\n') {
          cleanup();
          output.write('\n');
          resolve(value || current);
          return;
        }
        if (key === '\u007f' || key === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            output.write('\b \b');
          }
          continue;
        }
        value += key;
        output.write('*');
      }
    };
    const cleanup = () => {
      input.removeListener('data', onData);
      input.setRawMode(false);
    };
    input.on('data', onData);
  });
}

async function askYesNo(rl, label, fallback = true) {
  const suffix = fallback ? 'Y/n' : 'y/N';
  const answer = (await rl.question(`${label} [${suffix}]: `)).trim().toLowerCase();
  if (!answer) return fallback;
  return answer === 'y' || answer === 'yes';
}

async function askUrl(rl, label, fallback = '') {
  while (true) {
    const value = await askText(rl, label, fallback);
    try {
      const parsed = new URL(value);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return value.replace(/\/$/, '');
    } catch {}
    console.log(c.warning('Please enter a complete http:// or https:// URL.'));
  }
}

function writeEnvFile(values) {
  const lines = Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${JSON.stringify(String(value))}`);
  writeFileSync(`${root}/.env`, `${lines.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
}

async function runSetupWizard() {
  printHeader();
  console.log(c.title('First-run deployment setup'));
  console.log('Answer these questions once and I will create/update .env for you.');
  console.log(c.muted('Secrets are masked while you type. Existing values are kept when you press Enter.\n'));

  let rl = promptInterface();
  const current = (key, fallback = '') => fileEnv[key] || env[key] || fallback;
  const values = { ...fileEnv };
  const wizardSecret = async (label, value = '', optional = false) => {
    if (input.isTTY) {
      rl.close();
      const result = await askSecret(label, value, optional);
      rl = promptInterface();
      return result;
    }
    return askSecret(label, value, optional, rl);
  };

  values.FRONTEND_URL = await askUrl(rl, 'Public app URL', current('FRONTEND_URL', 'http://localhost:8082'));
  values.GOOGLE_CALLBACK_URL = `${values.FRONTEND_URL}/api/auth/google/callback`;
  values.CORS_ORIGINS = values.FRONTEND_URL;
  values.GOOGLE_CLIENT_ID = await askRequiredText(rl, 'Google OAuth client ID', current('GOOGLE_CLIENT_ID'));
  values.GOOGLE_CLIENT_SECRET = await wizardSecret('Google OAuth client secret', current('GOOGLE_CLIENT_SECRET'));
  while (true) {
    values.ALLOWED_EMAIL = await askRequiredText(rl, 'Google account allowed to sign in', current('ALLOWED_EMAIL'));
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.ALLOWED_EMAIL)) break;
    console.log(c.warning('Please enter a valid email address.'));
  }
  const generateSecret = await askYesNo(rl, 'Generate a new session secret', !current('SESSION_SECRET'));
  values.SESSION_SECRET = generateSecret ? randomBytes(48).toString('base64') : await wizardSecret('Session secret', current('SESSION_SECRET'));

  const useOpenRouter = await askYesNo(rl, 'Configure OpenRouter for AI features', Boolean(current('OPENROUTER_API_KEY')));
  if (useOpenRouter) values.OPENROUTER_API_KEY = await wizardSecret('OpenRouter API key', current('OPENROUTER_API_KEY'), true);
  else delete values.OPENROUTER_API_KEY;

  values.REDIS_URL = await askText(rl, 'Redis URL', current('REDIS_URL', 'redis://redis:6379'));
  values.FAINENS_IMAGE_REGISTRY = await askText(rl, 'Container registry', current('FAINENS_IMAGE_REGISTRY', 'docker.io'));
  values.FAINENS_IMAGE_NAMESPACE = await askText(rl, 'Container registry namespace/account', current('FAINENS_IMAGE_NAMESPACE', 'fainens'));
  values.FAINENS_IMAGE_TAG = await askText(rl, 'Image tag', current('FAINENS_IMAGE_TAG', 'latest'));
  values.FAINENS_FRONTEND_PORT = await askText(rl, 'Frontend host port', current('FAINENS_FRONTEND_PORT', '8082'));
  rl.close();

  values.NODE_ENV = 'production';
  values.HOST = '0.0.0.0';
  values.PORT = '3000';
  values.JOB_RUNNER_MODE = 'queue';
  values.LOCAL_AUTH_BYPASS = 'false';
  values.LOCAL_AUTH_EMAIL = current('LOCAL_AUTH_EMAIL', 'local-dev@fainens.test');
  writeEnvFile(values);
  Object.assign(env, values);
  config.registry = values.FAINENS_IMAGE_REGISTRY;
  config.namespace = values.FAINENS_IMAGE_NAMESPACE;
  config.tag = values.FAINENS_IMAGE_TAG;
  config.frontendPort = values.FAINENS_FRONTEND_PORT;
  config.frontendImage = `${config.registry}/${config.namespace}/fainens-frontend:${config.tag}`;
  config.backendImage = `${config.registry}/${config.namespace}/fainens-backend:${config.tag}`;
  console.log(c.success('\n.env has been created/updated with production deployment settings.'));
  console.log(c.muted(`OAuth callback: ${values.GOOGLE_CALLBACK_URL}`));
  console.log(c.warning('Remember to add that exact callback URL in Google Cloud Console.'));
}
function printHeader() {
  console.log('');
  console.log(c.title('╭──────────────────────────────────────────────╮'));
  console.log(c.title('│              FAINENS DEPLOYMENT              │'));
  console.log(c.title('╰──────────────────────────────────────────────╯'));
  console.log(c.muted(`  ${config.namespace} · ${config.tag}`));
  console.log('');
}

function printConfig() {
  console.log(c.title('Deployment configuration'));
  console.log(`  Registry:       ${config.registry}`);
  console.log(`  Namespace:      ${config.namespace}`);
  console.log(`  Tag:             ${config.tag}`);
  console.log(`  Frontend port:   ${config.frontendPort}`);
  console.log(`  Frontend image:  ${config.frontendImage}`);
  console.log(`  Backend image:   ${config.backendImage}`);
  console.log(`  Compose env:     ${existsSync(`${root}/.env`) ? c.success('found') : c.error('missing')}`);
  console.log(`  Mode:            ${dryRun ? c.warning('dry run') : 'live'}`);
}

function composeEnv() {
  return {
    ...process.env,
    FAINENS_IMAGE_REGISTRY: config.registry,
    FAINENS_IMAGE_NAMESPACE: config.namespace,
    FAINENS_IMAGE_TAG: config.tag,
    FAINENS_FRONTEND_PORT: config.frontendPort,
  };
}

function run(command, args, { allowFailure = false } = {}) {
  const rendered = [command, ...args].map((part) => /\s/.test(part) ? JSON.stringify(part) : part).join(' ');
  console.log(c.muted(`\n$ ${rendered}`));
  if (dryRun) return Promise.resolve(0);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: composeEnv(), stdio: 'inherit', shell: false });
    child.on('error', (error) => reject(error));
    child.on('exit', (code, signal) => {
      const exitCode = code ?? 1;
      if (exitCode !== 0 && !allowFailure) reject(new Error(`${command} exited with ${signal || exitCode}`));
      else resolve(exitCode);
    });
  });
}

async function checkDocker() {
  if (dryRun) return;
  try {
    await run('docker', ['version', '--format', '{{.Server.Version}}']);
  } catch {
    throw new Error('Docker is unavailable. Start Docker Desktop and try again.');
  }
}

function validateEnvironment({ requireComposeEnv = false } = {}) {
  if (requireComposeEnv && !existsSync(`${root}/.env`)) throw new Error('Missing .env. Copy .env.example to .env and fill in deployment values first.');
  const required = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL', 'ALLOWED_EMAIL', 'SESSION_SECRET'];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) throw new Error(`Missing required environment values: ${missing.join(', ')}`);
  const placeholders = required.filter((key) => /your-|change-this|example\.com/i.test(env[key]));
  if (placeholders.length) console.log(c.warning(`Warning: placeholder values remain for ${placeholders.join(', ')}.`));
}

async function confirm(message) {
  if (assumeYes || dryRun) return true;
  const rl = createInterface({ input, output });
  const answer = await rl.question(`${c.warning(message)} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function buildImages() {
  await checkDocker();
  await run('docker', ['build', '-t', config.frontendImage, './frontend']);
  await run('docker', ['build', '-t', config.backendImage, './backend']);
  console.log(c.success('\nImages built successfully.'));
}

async function pushImages() {
  await checkDocker();
  await run('docker', ['push', config.frontendImage]);
  await run('docker', ['push', config.backendImage]);
  console.log(c.success('\nImages pushed successfully.'));
}

async function deployCompose() {
  validateEnvironment({ requireComposeEnv: true });
  await checkDocker();
  await run('docker', ['compose', 'pull']);
  await run('docker', ['compose', 'up', '-d', '--remove-orphans']);
  await run('docker', ['compose', 'ps']);
  console.log(c.success('\nDeployment is running.'));
}

async function showStatus() {
  await checkDocker();
  await run('docker', ['compose', 'ps'], { allowFailure: true });
}

async function showLogs() {
  await checkDocker();
  const service = option('service', '');
  const args = ['compose', 'logs', '--tail=100'];
  if (hasFlag('follow')) args.push('--follow');
  if (service) args.push(service);
  await run('docker', args, { allowFailure: true });
}

function printHelp() {
  console.log(`${c.title('Fainens deployment CLI')}

Usage:
  node scripts/deploy.mjs                 Open the interactive menu
  node scripts/deploy.mjs <action>        Run an action directly

Actions:
  config       Show resolved image and deployment configuration
  build        Build frontend and backend images
  push         Push the configured images
  deploy       Pull images and start Docker Compose
  release      Build, push, pull, and deploy
  status       Show running services
  logs         Show recent logs; add --follow or --service backend

Options:
  --tag <tag>                  Image tag (default: FAINENS_IMAGE_TAG or latest)
  --registry <name>            Image registry
  --namespace <name>           Image namespace/account
  --frontend-port <port>       Host port for the frontend
  --yes                        Skip confirmations
  --dry-run                    Print commands without executing them
  --setup                      Run the guided .env setup wizard
  --help                       Show this help

Examples:
  node scripts/deploy.mjs release --tag 2026-09-07 --yes
  node scripts/deploy.mjs deploy --dry-run
  node scripts/deploy.mjs logs --service backend --follow`);
}

async function interactiveMenu() {
  const rl = createInterface({ input, output });
  while (true) {
    printHeader();
    printConfig();
    console.log(`\n${c.accent('Choose an action')}`);
    console.log('  1. Build images');
    console.log('  2. Build and push images');
    console.log('  3. Deploy current tag');
    console.log('  4. Full release: build, push, deploy');
    console.log('  5. Service status');
    console.log('  6. Service logs');
    console.log('  7. Show help');
    console.log('  0. Exit');
    const choice = (await rl.question('\nSelect [0-7]: ')).trim();
    try {
      if (choice === '0') break;
      if (choice === '1') await buildImages();
      else if (choice === '2') {
        if (await confirm('Build and push both images?')) { await buildImages(); await pushImages(); }
      } else if (choice === '3') {
        if (await confirm('Pull and restart the deployment?')) await deployCompose();
      } else if (choice === '4') {
        if (await confirm(`Build, push, and deploy tag ${config.tag}?`)) { await buildImages(); await pushImages(); await deployCompose(); }
      } else if (choice === '5') await showStatus();
      else if (choice === '6') await showLogs();
      else if (choice === '7') printHelp();
      else console.log(c.warning('Please choose a number from 0 to 7.'));
    } catch (error) {
      console.error(c.error(`\n✖ ${error instanceof Error ? error.message : String(error)}`));
    }
    if (choice !== '0') await rl.question(c.muted('\nPress Enter to return to the menu...'));
  }
  rl.close();
}

async function main() {
  if (hasFlag('help') || hasFlag('h')) return printHelp();
  if (hasFlag('setup') || (!requestedAction && !existsSync(`${root}/.env`))) await runSetupWizard();
  if (!requestedAction) return interactiveMenu();
  printHeader();
  printConfig();
  if (requestedAction === 'config') return;
  if (requestedAction === 'build') return buildImages();
  if (requestedAction === 'push') return pushImages();
  if (requestedAction === 'deploy') return deployCompose();
  if (requestedAction === 'release') {
    validateEnvironment({ requireComposeEnv: true });
    if (!await confirm(`Build, push, and deploy tag ${config.tag}?`)) return console.log(c.muted('Cancelled.'));
    await buildImages();
    await pushImages();
    return deployCompose();
  }
  if (requestedAction === 'status') return showStatus();
  if (requestedAction === 'logs') return showLogs();
  throw new Error(`Unknown action: ${requestedAction}. Use --help for available actions.`);
}

main().catch((error) => {
  console.error(c.error(`\n✖ ${error instanceof Error ? error.message : String(error)}`));
  process.exitCode = 1;
});