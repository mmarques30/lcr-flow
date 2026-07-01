const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
chromium.use(stealth());

const SESSION_PATH = path.join(__dirname, '../../sessions/gestta-session.json');
const URL = process.env.GESTTA_URL || 'https://app.gestta.com.br';
const EMAIL = process.env.GESTTA_EMAIL;
const PASSWORD = process.env.GESTTA_PASSWORD;

(async () => {
  if (!EMAIL || !PASSWORD) { console.error('GESTTA_EMAIL/PASSWORD ausentes no .env'); process.exit(1); }
  console.log('=== AUTO LOGIN GESTTA (headless) ===');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ locale: 'pt-BR',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' });
  const page = await context.newPage();
  // seletores possíveis do formulário de login
  const emailSel = ['input[type="email"]','input[name="email"]','input[name="username"]','input[id*="email" i]','input[placeholder*="mail" i]'];
  const passSel  = ['input[type="password"]','input[name="password"]','input[id*="senha" i]','input[placeholder*="senha" i]'];
  const btnSel   = ['button[type="submit"]','button:has-text("Entrar")','button:has-text("Login")','button:has-text("Acessar")','input[type="submit"]'];

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  console.log('URL inicial:', page.url());
  // AngularJS: o guard redireciona p/ login e SÓ ENTÃO renderiza o formulário.
  // Sem esperar, os campos não existem no domcontentloaded → falsa "campo não encontrado".
  await page.waitForSelector(emailSel.join(','), { timeout: 30000 }).catch(() => {});

  async function firstVisible(sels) {
    for (const s of sels) {
      const el = page.locator(s).first();
      if (await el.count() && await el.isVisible().catch(() => false)) return el;
    }
    return null;
  }

  const eEmail = await firstVisible(emailSel);
  if (!eEmail) { console.error('❌ Campo de email não encontrado. HTML:'); console.error((await page.content()).slice(0, 3000)); process.exit(2); }
  await eEmail.fill(EMAIL);
  const ePass = await firstVisible(passSel);
  if (!ePass) { console.error('❌ Campo de senha não encontrado'); process.exit(3); }
  await ePass.fill(PASSWORD);
  const eBtn = await firstVisible(btnSel);
  if (eBtn) await eBtn.click(); else await ePass.press('Enter');
  console.log('Login submetido, aguardando redirect...');

  // espera sair da página de login
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    await new Promise(r => setTimeout(r, 2000));
    const u = page.url();
    if (u.includes('gestta') && !u.includes('login') && !u.includes('auth') && !u.includes('signin')) {
      console.log('✅ Logado, URL:', u);
      break;
    }
  }
  await context.storageState({ path: SESSION_PATH });
  console.log('✅ Sessão salva em', SESSION_PATH);
  await browser.close();
  process.exit(0);
})().catch(e => { console.error('Erro:', e.message); process.exit(9); });
