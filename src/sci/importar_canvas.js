/**
 * src/sci/importar_canvas.js
 *
 * Automação completa do SCI Único via canvas HTML5 RDP.
 *
 * Estratégia:
 *  - Menu: click em Integrações + teclado (letras iniciais) para submenu
 *  - Formulário: Tab para navegar entre campos + type para preencher
 *  - Arquivo: coordenada para o ícone de pasta → digita caminho completo
 *  - Confirmar: coordenada do checkmark
 *
 * Pré-requisito: config/sci-coordenadas.json
 * Execute: node src/sci/importar_canvas.js [arquivo] [codigo_empresa] [competencia]
 */

const path = require('path');
const fs   = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { launchChrome } = require('./chrome_launcher');

const COORDS_PATH  = path.join(__dirname, '../../config/sci-coordenadas.json');
const SCREENS_PATH = path.join(__dirname, '../../screenshots');
const SCI_URL      = process.env.SCI_URL || 'https://novalcr.levelcloud.com.br';
const SERVIDOR_BASE = process.env.SCI_SERVIDOR_BASE || 'C:\\Troca_de_Arquivos\\Integracao\\TI\\MARI IAPLICADA\\';

fs.mkdirSync(SCREENS_PATH, { recursive: true });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function coords() {
  if (!fs.existsSync(COORDS_PATH)) throw new Error(`Coordenadas não encontradas: ${COORDS_PATH}\nExecute: node src/sci/mapear_coordenadas.js`);
  return JSON.parse(fs.readFileSync(COORDS_PATH));
}

async function shot(page, label) {
  const p = path.join(SCREENS_PATH, `sci-${label}-${Date.now()}.png`);
  await page.screenshot({ path: p }).catch(() => {});
  console.log(`    📸 ${p}`);
}

const ms = (n) => new Promise(r => setTimeout(r, n));

async function clicarRel(page, rx, ry, label = '') {
  const canvas = await page.$('canvas');
  const box    = await canvas.boundingBox();
  const x = box.x + rx * box.width;
  const y = box.y + ry * box.height;
  console.log(`  [click] ${label} → (${x.toFixed(0)}, ${y.toFixed(0)})`);
  await page.mouse.click(x, y);
  await ms(500);
}

async function tecla(page, key, label = '') {
  console.log(`  [key]   ${label || key}`);
  await page.keyboard.press(key);
  await ms(350);
}

async function digitar(page, texto, label = '') {
  console.log(`  [type]  ${label}: "${texto}"`);
  await page.keyboard.type(texto, { delay: 50 });
  await ms(200);
}

// ─── 1° Login no portal Citrix ────────────────────────────────────────────────

async function fazerLogin(portalPage) {
  // Se já estiver na página HTML5, sessão ainda ativa — pula login
  if (portalPage.url().includes('html5')) {
    console.log('    Sessão SCI já ativa, pulando login.');
    return;
  }

  await portalPage.goto(SCI_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Aguarda o formulário de login aparecer (até 10s)
  const formOk = await portalPage.waitForSelector('#Editbox1', { timeout: 10000 })
    .then(() => true).catch(() => false);

  if (!formOk) {
    console.log('    ⚠️  Formulário de login não detectado — pode já estar logado');
  } else {
    await portalPage.mainFrame().evaluate(({ user, pass }) => {
      const l = document.querySelector('#Editbox1');
      const p = document.querySelector('#Editbox2');
      const h = document.querySelector('#accesstypeuserchoice_html5');
      const b = document.querySelector('#buttonLogOn');
      if (!l) return;
      l.value = user;
      l.dispatchEvent(new Event('input', { bubbles: true }));
      l.dispatchEvent(new Event('change', { bubbles: true }));
      if (p) {
        p.value = pass;
        p.dispatchEvent(new Event('input', { bubbles: true }));
        p.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (h) h.click();
      if (b) b.click();
    }, { user: process.env.SCI_USER_LEVEL || 'level40', pass: process.env.SCI_PASSWORD_LEVEL || '' }).catch(() => {});
    console.log('    Login submetido. Aguardando abertura da sessão HTML5...');
  }
}

// ─── Detecta aba com canvas ───────────────────────────────────────────────────

async function esperarCanvas(context) {
  // Aguarda até 180s (90 × 2s) — popup html5.html pode demorar após StoreFront
  for (let t = 0; t < 90; t++) {
    const pages = context.pages();
    const urls = pages.map(p => {
      const u = p.url();
      return u.length > 70 ? u.slice(-70) : u;
    }).join(' | ');
    console.log(`    [${String((t + 1) * 2).padStart(3)}s/180s] ${pages.length} aba(s): ${urls || '(nenhuma)'}`);

    // 1ª prioridade: aba com 'html5' na URL (popup ou redirect)
    for (const aba of pages) {
      try {
        const c = await aba.$('canvas');
        if (!c || !aba.url().includes('html5')) continue;
        const box = await c.boundingBox();
        if (box && box.width > 400 && box.height > 200) {
          console.log(`    ✅ Canvas html5 ${Math.round(box.width)}×${Math.round(box.height)}`);
          return aba;
        }
      } catch {}
    }
    // Fallback: qualquer canvas grande (só após 30s para popup ter tempo de abrir)
    if (t >= 15) {
      for (const aba of pages) {
        try {
          if (aba.url() === 'about:blank') continue;
          const c = await aba.$('canvas');
          if (!c) continue;
          const box = await c.boundingBox();
          if (box && box.width > 400 && box.height > 200) {
            console.log(`    Canvas fallback ${Math.round(box.width)}×${Math.round(box.height)} em: ...${aba.url().slice(-50)}`);
            return aba;
          }
        } catch {}
      }
    }
    await ms(2000);
  }
  throw new Error('Canvas não encontrado após 180s.');
}

// ─── 2° Login dentro do canvas (mariana.marques@lcr) ─────────────────────────
// O form de login SCI aparece dentro do RDP antes de abrir o sistema.
// Coordenadas relativas ao canvas JWTS (1920×944).
// Se a sessão já estiver logada, o clique cai na área de FAQ (inofensivo).

async function fazerLogin2(cp) {
  console.log('[2b] Fazendo 2° login (mariana.marques@lcr)...');

  const canvas = await cp.$('canvas');
  const box    = await canvas.boundingBox();

  const clickAt = async (rx, ry, label) => {
    const x = box.x + rx * box.width;
    const y = box.y + ry * box.height;
    console.log(`  [click] ${label} → (${x.toFixed(0)}, ${y.toFixed(0)})`);
    await cp.mouse.click(x, y);
    await ms(400);
  };

  // Coordenadas do form de login SCI (estimadas, ajuste via .env se necessário)
  const RX   = parseFloat(process.env.SCI_LOGIN2_RX   || '0.227');
  const RY_U = parseFloat(process.env.SCI_LOGIN2_RY_U || '0.375');

  await clickAt(RX, RY_U, 'campo Usuário');
  await cp.keyboard.press('Control+a');
  await ms(200);
  await cp.keyboard.type(process.env.SCI_EMAIL || 'mariana.marques@lcr', { delay: 50 });
  await cp.keyboard.press('Tab');
  await ms(300);
  await cp.keyboard.type(process.env.SCI_PASSWORD || 'Lcr@2205', { delay: 50 });
  await cp.keyboard.press('Enter');
  await ms(800);
  await cp.keyboard.press('Escape'); // descarta eventual dialog de erro
  console.log('    2° login submetido. Aguardando SCI menu principal (45s)...');
  await ms(45000);
}

// ─── Atualiza referência da página canvas ────────────────────────────────────
// Usa quando cp pode ter ficado stale (Citrix reabre sessão em nova aba)

async function refreshCp(cp, context) {
  // 1ª opção: aba com 'html5' na URL (mais específica)
  const html5 = context.pages().find(p => p.url().includes('html5'));
  if (html5) return html5;
  // 2ª opção: cp atual ainda válido
  const valido = await cp.title().then(() => true).catch(() => false);
  if (valido) return cp;
  // 3ª opção: re-detectar qualquer canvas grande
  console.log('    cp stale — re-detectando canvas...');
  return await esperarCanvas(context);
}

// ─── Navegação via menu (Integrações → Importações → Lançamentos) ─────────────

async function navegarParaImportacao(cp, c) {
  console.log('\n[3] Navegando para Integrações → Importações → Lançamentos...');

  // Clica no menu Integrações
  await clicarRel(cp, c.menu_integracoes.rx, c.menu_integracoes.ry, 'Integrações');
  await ms(800);
  await shot(cp, 'nav-integracoes');

  // Navega com teclado para Importações
  await digitar(cp, 'i', 'jump Importações');
  await ms(600);
  await shot(cp, 'nav-importacoes');
  await tecla(cp, 'Enter', 'abre Importações');
  await ms(800);

  // Submenu Importações abre com TXT (1° item) focado — ArrowDown vai para planilha (2°)
  await tecla(cp, 'ArrowDown', 'planilha = 2° item');
  await ms(400);
  await shot(cp, 'nav-lancamentos');
  await tecla(cp, 'Enter', 'abre formulário planilha');
  await ms(2000);
  await shot(cp, 'form-aberto');
  console.log('    ✅ Formulário aberto');
}

// ─── Preenche formulário via Tab ──────────────────────────────────────────────

async function preencherFormulario(cp, c, { empresaCodigo, dataInicial, dataFinal, gerador = '1' }) {
  console.log('\n[4] Preenchendo formulário...');
  // O dialog abre com foco no campo Empresa (padrão Windows) — não clicamos.

  // ── Empresa ──────────────────────────────────────────────────────────────
  await cp.keyboard.press('Control+a');
  await digitar(cp, empresaCodigo, 'empresa');
  await tecla(cp, 'Tab', 'Tab → data inicial');
  await ms(1500); // aguarda lookup de empresa

  // ── Data inicial ─────────────────────────────────────────────────────────
  // Campo mascarado DD/MM/AAAA — barras já estão fixas, digitar só 8 dígitos
  await cp.keyboard.press('Control+a');
  await digitar(cp, dataInicial, 'data inicial (DDMMAAAA)');
  await ms(400);
  await tecla(cp, 'Tab', 'Tab → data final');
  await ms(400);

  // ── Data final ───────────────────────────────────────────────────────────
  await cp.keyboard.press('Control+a');
  await digitar(cp, dataFinal, 'data final (DDMMAAAA)');
  await ms(400);
  await tecla(cp, 'Tab', 'Tab → gerador');
  await ms(400);

  // ── Gerador: clica diretamente para garantir foco certo ──────────────────
  // Calcula coordenada do campo Gerador = abaixo de data_fim, mesma coluna x
  // Como não temos coord mapeada, clicamos em data_fim + offset de ~1.5 linha
  const geradRx = c.form_data_fim.rx;
  const geradRy = c.form_data_fim.ry + 0.045; // ~1.5 linha abaixo do data_fim
  await clicarRel(cp, geradRx, geradRy, 'Gerador (estimado)');
  await cp.keyboard.press('Control+a');
  await digitar(cp, gerador, 'gerador');
  await tecla(cp, 'Tab', 'Tab → plano troca');

  // ── Plano de troca (pular, vai para campo Arquivo) ────────────────────────
  await tecla(cp, 'Tab', 'Tab → arquivo');

  await shot(cp, 'form-preenchido');
  console.log('    ✅ Formulário preenchido');
}

// ─── Seleciona arquivo via diálogo Windows ────────────────────────────────────

async function selecionarArquivo(cp, c, nomeArquivo) {
  console.log('\n[5] Abrindo seletor de arquivo...');
  const caminhoCompleto = SERVIDOR_BASE + nomeArquivo;

  // Clica no ícone de pasta
  await clicarRel(cp, c.form_arquivo_icone.rx, c.form_arquivo_icone.ry, 'ícone pasta');
  await ms(3000); // aguarda diálogo Windows abrir
  await shot(cp, 'dialogo-arquivo');

  // Alt+N foca o campo "Nome:" no diálogo Windows padrão
  await cp.keyboard.press('Alt+n');
  await ms(500);
  await cp.keyboard.press('Control+a');
  await ms(200);

  // Digita caminho completo
  console.log(`    Caminho: ${caminhoCompleto}`);
  await cp.keyboard.type(caminhoCompleto, { delay: 30 });
  await ms(500);
  await shot(cp, 'dialogo-caminho');

  // Enter = Abrir
  await cp.keyboard.press('Enter');
  await ms(2000);
  await shot(cp, 'dialogo-confirmado');
  console.log('    ✅ Arquivo selecionado');
}

// ─── Confirma importação (Enter = botão padrão do form Delphi) ────────────────

async function confirmarImportacao(cp) {
  console.log('\n[6] Confirmando importação...');
  await shot(cp, 'pre-importacao');

  // Após fechar o diálogo de arquivo, foco volta ao form de importação.
  // Enter dispara o botão padrão (checkmark ✓) em qualquer form Delphi.
  await tecla(cp, 'Enter', 'Enter = checkmark confirmar importação');
  console.log('    Aguardando processamento (40s)...');
  await ms(40000);
  await shot(cp, 'pos-importacao');
  console.log('    ✅ Importação finalizada');
}

// ─── Função principal exportada ───────────────────────────────────────────────

async function importarPlanilhaSCI({ nomeArquivo, empresaCodigo, competencia }) {
  const c = coords();

  const [mes, ano] = competencia.split('/');
  const ultimoDia  = new Date(parseInt(ano), parseInt(mes), 0).getDate();
  // Campos de data no SCI usam máscara DD/MM/AAAA com separadores fixos —
  // digitar apenas 8 dígitos, sem barras, para não deslocar cursor.
  const dataInicial = `01${mes}${ano}`;
  const dataFinal   = `${String(ultimoDia).padStart(2, '0')}${mes}${ano}`;

  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║  IMPORTAÇÃO SCI — ${empresaCodigo} / ${competencia}  ║`);
  console.log(`╚══════════════════════════════════════╝`);
  console.log(`  Arquivo : ${nomeArquivo}`);
  console.log(`  Período : ${dataInicial} → ${dataFinal}`);
  console.log(`  Servidor: ${SERVIDOR_BASE}${nomeArquivo}\n`);

  const { browser, context, page: portalPage } = await launchChrome(SCI_URL);

  try {
    // Fecha TODAS as abas exceto o portal — garante que não há sessão SCI antiga
    const abasAntigas = context.pages().filter(p => p !== portalPage);
    if (abasAntigas.length > 0) {
      console.log(`    Fechando ${abasAntigas.length} aba(s) antigas...`);
      await Promise.all(abasAntigas.map(p => p.close().catch(() => {})));
      await ms(1000);
    }

    console.log('[1] Fazendo 1° login (level40)...');
    await fazerLogin(portalPage);

    // Aguarda StoreFront carregar após redirecionamento do login
    console.log('[1b] Aguardando StoreFront...');
    await ms(6000);
    await shot(portalPage, 'storefront').catch(() => {});
    const urlStoreFront = await portalPage.url().catch ? portalPage.url() : '(inacessível)';
    console.log(`    URL pós-login: ${urlStoreFront}`);

    // Tenta clicar no app SCI via DOM (StoreFront é HTML, não canvas)
    if (!urlStoreFront.includes('html5')) {
      const sciLancado = await portalPage.evaluate(() => {
        for (const el of document.querySelectorAll('a, button, [role="button"], [data-appid], li')) {
          const txt   = (el.textContent || '').trim();
          const attrs = [el.getAttribute('title'), el.getAttribute('data-appid'), el.getAttribute('data-name')]
                          .filter(Boolean).join(' ');
          if ((txt + ' ' + attrs).match(/\bSCI\b/i) && el.offsetWidth > 0) {
            el.click();
            return txt || attrs;
          }
        }
        return null;
      }).catch(() => null);

      if (sciLancado) {
        console.log(`    ✅ App SCI clicado no StoreFront: "${sciLancado}"`);
      } else {
        console.log('    ⚠️  SCI não encontrado via DOM — verifique sci-storefront-*.png');
      }
    }

    console.log('[2] Detectando canvas HTML5 (aguarda popup)...');
    let cp = await esperarCanvas(context);
    await cp.bringToFront();
    await shot(cp, 'canvas-detectado');
    console.log('    Canvas html5 encontrado. Aguardando login SCI (15s)...');
    await ms(15000);

    // Portal/canvas pode reabrir em nova aba — re-adquire
    cp = await refreshCp(cp, context);
    await cp.bringToFront();
    await shot(cp, 'canvas-login2');
    await fazerLogin2(cp);

    // Citrix pode reabrir sessão em nova aba após 2° login — re-adquire novamente
    await ms(2000);
    cp = await refreshCp(cp, context);
    await cp.bringToFront();
    await shot(cp, 'canvas-pronto');

    await navegarParaImportacao(cp, c);
    await preencherFormulario(cp, c, { empresaCodigo, dataInicial, dataFinal });
    await selecionarArquivo(cp, c, nomeArquivo);
    await confirmarImportacao(cp);

    console.log('\n✅ IMPORTAÇÃO CONCLUÍDA NO SCI ÚNICO\n');
    return { sucesso: true, empresa: empresaCodigo, competencia };

  } catch (err) {
    try { await portalPage.screenshot({ path: path.join(SCREENS_PATH, `sci-ERRO-${Date.now()}.png`) }); } catch {}
    console.error('\n❌ ERRO:', err.message);
    throw err;
  } finally {
    await ms(3000);
    await browser.close();
  }
}

module.exports = { importarPlanilhaSCI, SERVIDOR_BASE };

// ─── CLI ─────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const nomeArquivo = process.argv[2] || 'CAPITALIS HOLDING LTDA - Lancamentos 05-2026.xlsx';
  const empresaCod  = process.argv[3] || process.env.SCI_EMPRESA_CAPI || '1810';
  const competencia = process.argv[4] || '05/2026';

  importarPlanilhaSCI({ nomeArquivo, empresaCodigo: empresaCod, competencia })
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
