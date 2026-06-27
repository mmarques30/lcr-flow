/**
 * src/sci/chrome_launcher.js
 *
 * Lança o Chrome REAL sem flags de automação e conecta via CDP.
 * Cloudflare vê um Chrome limpo — sem navigator.webdriver, sem --enable-automation.
 */

const { chromium } = require('playwright');
const { spawn }    = require('child_process');
const path         = require('path');
const fs           = require('fs');
const axios        = require('axios');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const PROFILE_DIR  = path.join(__dirname, '../../profiles/chrome-sci');
const DEBUG_PORT   = 9222;

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  ].filter(Boolean);
  return candidates.find(p => fs.existsSync(p)) || null;
}

async function waitForDebugPort(port, retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await axios.get(`http://localhost:${port}/json/version`, { timeout: 1000 });
      if (r.status === 200) return;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Chrome não iniciou na porta ${port} — verifique se já há um Chrome aberto nessa porta.`);
}

async function launchChrome(url) {
  const chromeExe = findChrome();
  if (!chromeExe) throw new Error('Chrome não encontrado. Defina CHROME_PATH no .env.');

  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  console.log(`Lançando Chrome: ${chromeExe}`);
  console.log(`Perfil: ${PROFILE_DIR}`);
  console.log(`CDP port: ${DEBUG_PORT}\n`);

  const proc = spawn(chromeExe, [
    `--user-data-dir=${PROFILE_DIR}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--start-maximized',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-popup-blocking',
    url || 'about:blank',
  ], { stdio: 'ignore', detached: true });
  proc.unref();

  await waitForDebugPort(DEBUG_PORT);
  console.log('Chrome iniciado e CDP disponível.\n');

  const browser = await chromium.connectOverCDP(`http://localhost:${DEBUG_PORT}`);
  const context  = browser.contexts()[0];
  const page     = context.pages()[0] || await context.newPage();

  return { browser, context, page };
}

async function connectChrome() {
  // Tenta conectar a um Chrome já rodando
  try {
    const browser  = await chromium.connectOverCDP(`http://localhost:${DEBUG_PORT}`);
    const context  = browser.contexts()[0];
    const page     = context.pages()[0] || await context.newPage();
    return { browser, context, page };
  } catch {
    throw new Error(`Nenhum Chrome com CDP na porta ${DEBUG_PORT}. Execute launchChrome() primeiro.`);
  }
}

module.exports = { launchChrome, connectChrome, PROFILE_DIR, DEBUG_PORT };
