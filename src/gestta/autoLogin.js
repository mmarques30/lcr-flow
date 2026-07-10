const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
chromium.use(stealth());

const SESSION_PATH = path.join(__dirname, '../../sessions/gestta-session.json');
const SCREENSHOTS_PATH = path.join(__dirname, '../../screenshots');
const URL = process.env.GESTTA_URL || 'https://app.gestta.com.br';
const EMAIL = process.env.GESTTA_EMAIL;
const PASSWORD = process.env.GESTTA_PASSWORD;

fs.mkdirSync(SCREENSHOTS_PATH, { recursive: true });
fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });

const emailSel = ['input[type="email"]', 'input[name="email"]', 'input[name="username"]', 'input[id*="email" i]', 'input[placeholder*="mail" i]'];
const passSel = ['input[type="password"]', 'input[name="password"]', 'input[id*="senha" i]', 'input[placeholder*="senha" i]'];
const btnSel = ['button[type="submit"]', 'button:has-text("Entrar")', 'button:has-text("Login")', 'button:has-text("Acessar")', 'input[type="submit"]'];

function jwtOkInSession(sessionPath) {
  try {
    const s = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    for (const o of (s.origins || [])) {
      for (const kv of (o.localStorage || [])) {
        if (kv.name === 'ngStorage-jwt' && kv.value && String(kv.value).length > 20) return true;
      }
    }
  } catch (_) { /* ignore */ }
  return false;
}

async function firstVisible(page, sels) {
  for (const s of sels) {
    const el = page.locator(s).first();
    if (await el.count() && await el.isVisible().catch(() => false)) return el;
  }
  return null;
}

async function tentarLogin(page, context) {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  console.log('URL inicial:', page.url());
  await page.waitForSelector(emailSel.join(','), { timeout: 30000 }).catch(() => {});

  let eEmail = await firstVisible(page, emailSel);
  if (!eEmail) {
    console.log('Formulário não visível — limpando cookies e forçando rota de login...');
    await context.clearCookies();
    await page.goto(`${URL}/#/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(emailSel.join(','), { timeout: 30000 }).catch(() => {});
    eEmail = await firstVisible(page, emailSel);
  }
  if (!eEmail) {
    const shot = path.join(SCREENSHOTS_PATH, `autologin-sem-email-${Date.now()}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    console.error('❌ Campo de email não encontrado. Screenshot:', shot);
    console.error((await page.content()).slice(0, 3000));
    return false;
  }
  await eEmail.fill(EMAIL);
  const ePass = await firstVisible(page, passSel);
  if (!ePass) {
    console.error('❌ Campo de senha não encontrado');
    return false;
  }
  await ePass.fill(PASSWORD);
  const eBtn = await firstVisible(page, btnSel);
  if (eBtn) await eBtn.click(); else await ePass.press('Enter');
  console.log('Login submetido, aguardando redirect...');

  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    await new Promise(r => setTimeout(r, 2000));
    const u = page.url();
    if (u.includes('gestta') && !u.includes('login') && !u.includes('auth') && !u.includes('signin')) {
      console.log('✅ Logado, URL:', u);
      return true;
    }
  }
  console.error('❌ Timeout aguardando redirect pós-login');
  return false;
}

(async () => {
  if (!EMAIL || !PASSWORD) { console.error('GESTTA_EMAIL/PASSWORD ausentes no .env'); process.exit(1); }
  console.log('=== AUTO LOGIN GESTTA (headless) ===');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    locale: 'pt-BR',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  try {
    const ok = await tentarLogin(page, context);
    if (!ok) process.exit(2);
    await context.storageState({ path: SESSION_PATH });
    if (!jwtOkInSession(SESSION_PATH)) {
      console.error('❌ Sessão salva mas ngStorage-jwt ausente — login incompleto');
      process.exit(4);
    }
    console.log('✅ Sessão salva em', SESSION_PATH);
    process.exit(0);
  } catch (e) {
    const shot = path.join(SCREENSHOTS_PATH, `autologin-erro-${Date.now()}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    console.error('Erro:', e.message, shot ? `(screenshot: ${shot})` : '');
    process.exit(9);
  } finally {
    await browser.close();
  }
})();
