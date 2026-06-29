/**
 * src/gestta/saveSession.js
 *
 * Abre o Gestta num browser VISÍVEL para você fazer login manualmente.
 * Após o login, pressione ENTER no terminal — o script salva a sessão.
 *
 * Execute: npm run save-session:gestta
 */

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const readline = require('readline');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

chromium.use(stealth());

const SESSION_PATH = path.join(__dirname, '../../sessions/gestta-session.json');
const URL = process.env.GESTTA_URL || 'https://app.gestta.com.br';

async function saveSession() {
  console.log('\n=== SAVE SESSION — GESTTA ===');
  console.log('Abrindo browser...\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized'],
  });

  const context = await browser.newContext({
    viewport: null,
    locale: 'pt-BR',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });

  console.log(`URL: ${URL}`);
  console.log(`Login: ${process.env.GESTTA_EMAIL}`);
  console.log('\n👉 Faça login manualmente no browser que abriu.');
  console.log('   A sessão será salva AUTOMATICAMENTE assim que o login for detectado.\n');

  // Detecção automática de login (sem precisar de ENTER — funciona em background).
  // Logado = URL não está mais na rota de login/auth do Gestta, estável por 2 checagens.
  const ehLogado = () => {
    const u = page.url() || '';
    return u.includes('gestta') && !u.includes('login') && !u.includes('auth');
  };

  const inicioEspera = Date.now();
  const TIMEOUT_MS = 300000; // 5 min para o login manual
  let estaveis = 0;
  while (Date.now() - inicioEspera < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, 3000));
    if (ehLogado()) {
      estaveis += 1;
      if (estaveis >= 2) break; // ~6s logado de forma estável
    } else {
      estaveis = 0;
    }
  }

  if (!ehLogado()) {
    console.error('\n⚠️  Login não detectado dentro do tempo limite. Salvando estado atual mesmo assim.');
  }

  await context.storageState({ path: SESSION_PATH });
  console.log(`\n✅ Sessão salva em: ${SESSION_PATH}`);

  await browser.close();
  process.exit(0);
}

saveSession().catch((err) => {
  console.error('Erro:', err.message);
  process.exit(1);
});
