/**
 * src/gestta/index.js
 * Automação do Gestta com Playwright stealth.
 * Seletores calibrados em 26/06/2026 — AngularJS app.
 *
 * Arquitetura do Gestta (descoberta via calibração):
 *  - Hash-based SPA: /#/sidebar/task/overview/dashboard
 *  - Framework: AngularJS (classes semânticas estáveis: li.task-item, .task-name, etc.)
 *  - Task ID: ObjectID de 24 hex chars, aparece na URL após clicar numa tarefa
 *  - Download: botão "Baixar tudo" na seção "DOCUMENTOS SOLICITADOS"
 *  - Concluir: dropdown de status "Aberta" → "Concluída"
 */

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

chromium.use(stealth());

const SESSION_PATH     = path.join(__dirname, '../../sessions/gestta-session.json');
const SCREENSHOTS_PATH = path.join(__dirname, '../../screenshots');
const COMPANY_USER     = '6a0f5f8891844ae54d5b6853'; // ID fixo da conta Mariana

fs.mkdirSync(SCREENSHOTS_PATH, { recursive: true });

// ── Helpers ────────────────────────────────────────────────────────────────

async function humanDelay(min = 600, max = 1400) {
  const ms = min + Math.random() * (max - min);
  await new Promise(r => setTimeout(r, ms));
}

async function criarContexto(browser) {
  const storageState = fs.existsSync(SESSION_PATH) ? SESSION_PATH : undefined;
  return browser.newContext({
    storageState,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    extraHTTPHeaders: { 'Accept-Language': 'pt-BR,pt;q=0.9' },
  });
}

async function screenshot(page, nome) {
  const p = path.join(SCREENSHOTS_PATH, `${nome}-${Date.now()}.png`);
  await page.screenshot({ path: p, fullPage: true });
  console.error('Screenshot:', p);
  return p;
}

async function sessaoValida(page) {
  try {
    await page.goto('https://app.gestta.com.br/tarefas', { waitUntil: 'networkidle', timeout: 20000 });
    return !page.url().includes('login');
  } catch {
    return false;
  }
}

// Extrai o ObjectID de 24 hex chars da URL do Gestta
function extrairTaskId(url) {
  const match = url.match(/dashboard\/([0-9a-f]{24})/);
  return match ? match[1] : null;
}

// Monta URL para lista de tarefas COBRANÇA (sem filtro document_request_sent)
function urlListaCobranca(ano, mes) {
  const start = new Date(ano, mes - 1, 1, 3, 0, 0).toISOString();
  const end   = new Date(ano, mes,     1, 2, 59, 59).toISOString();
  const qs = [
    'type=SERVICE_ORDER', 'type=RECURRENT', 'type=ACCOUNTING',
    // sem filtro company_user → Todos os Usuários (todos os colaboradores)
    `start_date=${encodeURIComponent(start)}`,
    `end_date=${encodeURIComponent(end)}`,
    'status=OPEN',
    'overdue=0', 'downloaded=0', 'not_downloaded=0', 'fine=0', 'on_time=0',
    'collaborator=0', 'email_not_sent=0', 'without_external_user=0',
  ].join('&');
  return `https://app.gestta.com.br/#/sidebar/task/overview/dashboard?${qs}`;
}

// Monta URL do sidebar "Abertas e com cobrança" para o mês/ano
function urlListaTarefas(ano, mes) {
  const start = new Date(ano, mes - 1, 1, 3, 0, 0).toISOString();
  const end   = new Date(ano, mes,     1, 2, 59, 59).toISOString();
  const qs = [
    'type=SERVICE_ORDER', 'type=RECURRENT', 'type=ACCOUNTING',
    // sem filtro company_user → Todos os Usuários (todos os colaboradores)
    'is_mutual_company_grouper=0',
    `start_date=${encodeURIComponent(start)}`,
    `end_date=${encodeURIComponent(end)}`,
    'status=OPEN', 'os_workflow=1',
    'overdue=0', 'downloaded=0', 'not_downloaded=0', 'fine=0', 'on_time=0',
    'collaborator=0', 'email_not_sent=0', 'document_request_sent=1',
    'without_external_user=0', 'cross_access=1',
  ].join('&');
  return `https://app.gestta.com.br/#/sidebar/task/overview/dashboard?${qs}`;
}

// Monta URL de detalhe de uma tarefa específica
function urlDetalhe(tarefaId, ano, mes) {
  const start = new Date(ano, mes - 1, 1, 3, 0, 0).toISOString();
  const end   = new Date(ano, mes,     1, 2, 59, 59).toISOString();
  const qs = [
    'type=SERVICE_ORDER', 'type=RECURRENT', 'type=ACCOUNTING',
    // sem filtro company_user → Todos os Usuários (todos os colaboradores)
    `start_date=${encodeURIComponent(start)}`,
    `end_date=${encodeURIComponent(end)}`,
    'status=OPEN', 'os_workflow=1',
    'overdue=0', 'downloaded=0', 'not_downloaded=0', 'fine=0', 'on_time=0',
    'collaborator=0', 'email_not_sent=0', 'document_request_sent=1',
    'without_external_user=0',
  ].join('&');
  return `https://app.gestta.com.br/#/sidebar/task/overview/dashboard/${tarefaId}?${qs}`;
}

// ── FUNÇÃO 1: Buscar tarefas pendentes ────────────────────────────────────
//
// Retorna array com dados de cada tarefa incluindo o task ID do Gestta.
// Estratégia: clica em cada card e extrai o ID da URL resultante.

async function buscarTarefasPendentes(competencia = null) {
  const agora = new Date();
  const ano   = competencia ? parseInt(competencia.split('/')[1]) : agora.getFullYear();
  const mes   = competencia ? parseInt(competencia.split('/')[0]) : agora.getMonth() + 1;

  const browser = await chromium.launch({ headless: true });
  const context = await criarContexto(browser);
  const page    = await context.newPage();

  try {
    if (!(await sessaoValida(page))) {
      throw new Error('SESSAO_EXPIRADA: rode npm run save-session:gestta');
    }

    await humanDelay();
    await page.goto(urlListaTarefas(ano, mes), { waitUntil: 'networkidle', timeout: 30000 });
    await humanDelay(2000, 3500);

    // Aguarda lista carregar
    const temTarefas = await page.waitForSelector('li.task-item', { timeout: 15000 })
      .then(() => true)
      .catch(() => false);

    if (!temTarefas) {
      console.log(`Nenhuma tarefa pendente em ${mes}/${ano}`);
      return [];
    }

    // Extrai dados básicos do DOM (texto visível — seletores AngularJS estáveis)
    const dadosDom = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('li.task-item')).map((li, i) => {
        const nome   = li.querySelector('.task-name span')?.textContent?.trim() || '';
        const raw    = li.querySelector('.task-customer-name')?.textContent?.trim() || '';
        const match  = raw.match(/^([A-Z0-9]+)\s*-\s*(.+)$/);
        const meta   = li.querySelector('[ng-bind*="due_date"], .task-due-date')?.textContent?.trim() || '';
        const atrasada = !!li.querySelector('.task-card-item.overdue');
        // Colaborador responsável (ex.: "Cleyton - Contábil") — best-effort.
        // TODO: confirmar seletor exato com sessão ativa; fallbacks abaixo.
        let responsavel = '';
        const respEl = li.querySelector(
          '.task-owner-name, .task-responsible, .task-collaborator-name, ' +
          '.task-company-user, [ng-bind*="owner"], [ng-bind*="responsible"], [ng-bind*="company_user"]'
        );
        if (respEl) responsavel = (respEl.textContent || '').trim();
        if (!responsavel) {
          const av = li.querySelector('img[title], [title]');
          const t = av && av.getAttribute('title');
          if (t) responsavel = t.trim();
        }
        return {
          indice: i,
          nome,
          clienteCodigo: match?.[1] || '',
          clienteNome:   match?.[2] || raw,
          responsavel,                 // colaborador (mapeado p/ consultor_id no nosso sistema)
          meta,
          atrasada,
          status: 'OPEN',
          taskId: null, // preenchido abaixo via click
        };
      });
    });

    // Para cada tarefa, clica para extrair o task ID da URL
    for (const tarefa of dadosDom) {
      await humanDelay(600, 1200);
      const cards = await page.$$('li.task-item .task-card-item');
      if (!cards[tarefa.indice]) continue;

      await cards[tarefa.indice].click();
      await humanDelay(1500, 2500);

      tarefa.taskId = extrairTaskId(page.url());

      // Tenta também pegar a competência do detalhe
      const competenciaEl = await page.$('[ng-bind*="reference_date"], .task-competencia, td:has-text("COMPETÊNCIA") + td');
      if (competenciaEl) {
        tarefa.competencia = (await competenciaEl.textContent())?.trim();
      }

      // Volta para a lista
      await page.goto(urlListaTarefas(ano, mes), { waitUntil: 'networkidle', timeout: 30000 });
      await humanDelay(1500, 2500);
    }

    console.log(`Encontradas ${dadosDom.length} tarefa(s) pendente(s) — ${mes}/${ano}`);
    return dadosDom;

  } catch (error) {
    await screenshot(page, 'gestta-erro-busca');
    throw error;
  } finally {
    await browser.close();
  }
}

// ── FUNÇÃO 2: Baixar documentos de uma tarefa ─────────────────────────────
//
// Estrutura descoberta via calibração (26/06/2026):
//  - "Baixar tudo" está desabilitado quando a tarefa não tem responsável
//  - Cada doc com arquivo tem: a.accordion-toggle > i.fa-chevron-right
//  - Clicar no toggle expande e revela: span.file-name.has-file (ng-click=downloadDocument)
//  - downloadDocument abre uma nova aba com o arquivo → capturamos via popup event
//
// Retorna array com caminhos dos arquivos baixados.

async function baixarDocumentosCliente(tarefaId, competencia, destino) {
  const agora = new Date();
  const ano   = competencia ? parseInt(competencia.split('/')[1]) : agora.getFullYear();
  const mes   = competencia ? parseInt(competencia.split('/')[0]) : agora.getMonth() + 1;

  fs.mkdirSync(destino, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await criarContexto(browser);
  const page    = await context.newPage();
  const arquivos = [];
  const jaiBaixados = new Set(); // evita duplicatas

  try {
    if (!(await sessaoValida(page))) throw new Error('SESSAO_EXPIRADA');

    await humanDelay();
    await page.goto(urlDetalhe(tarefaId, ano, mes), { waitUntil: 'networkidle', timeout: 30000 });
    await humanDelay(2500, 4000);

    // ── Passo 1: Expande a seção "DOCUMENTOS SOLICITADOS" ─────────────────
    await page.waitForSelector('text=DOCUMENTOS SOLICITADOS', { timeout: 20000 });
    await humanDelay(500, 800);

    // Clica no header da seção (accordion pai)
    const headerSecao = page.locator('.panel-heading:has-text("DOCUMENTOS SOLICITADOS"), h4:has-text("DOCUMENTOS SOLICITADOS"), [ng-bind*="REQUESTED_DOCUMENTS"]').first();
    await headerSecao.click({ force: true });
    await humanDelay(1500, 2500);

    // ── Passo 2: Acessa Angular scope e extrai todos os arquivos de uma vez ──
    // Evita clicar em elementos animados — chama downloadDocument via scope
    await humanDelay(1000, 1500);

    const todosArquivos = await page.evaluate(() => {
      // Percorre o scope Angular procurando taskDocumentRequest
      let scopeEl = document.querySelector('.download-all, [ng-click*="downloadAll"], [ng-disabled*="documentRequestHasFiles"]');
      if (!scopeEl) return { erro: 'elemento download-all não encontrado' };

      let scope = angular.element(scopeEl).scope();
      // Sobe na hierarquia até encontrar taskDocumentRequest
      let tentativas = 0;
      while (scope && !scope.taskDocumentRequest && tentativas++ < 10) {
        scope = scope.$parent;
      }

      if (!scope || !scope.taskDocumentRequest) return { erro: 'scope taskDocumentRequest não encontrado' };

      const tdr  = scope.taskDocumentRequest;
      const lista = tdr.list || tdr.docList || tdr.docs || [];
      const arquivos = [];

      lista.forEach(doc => {
        (doc.files || []).forEach(file => {
          if (file.file_name || file.path) {
            arquivos.push({ docNome: doc.name, fileName: file.file_name, fileId: file._id, path: file.path });
          }
        });
      });

      return { arquivos, totalDocs: lista.length };
    });

    if (todosArquivos.erro) {
      console.log(`Scope inacessível: ${todosArquivos.erro}`);
      console.log('Fallback: clicando em itens individuais...');
    } else {
      console.log(`Scope Angular: ${todosArquivos.totalDocs} docs, ${todosArquivos.arquivos.length} arquivo(s)`);
    }

    // ── Passo 3: Dispara download de cada arquivo via JS click no span ────
    // Usamos aria-controls do toggle para localizar o panel correto
    const numToggles = await page.evaluate(
      () => document.querySelectorAll('a.accordion-toggle[aria-controls]').length
    );
    console.log(`Itens de documento com arquivo: ${numToggles}`);

    if (numToggles === 0) {
      await screenshot(page, `gestta-sem-docs-${tarefaId}`);
      console.warn('Nenhum item de documento encontrado na seção');
      return [];
    }

    for (let i = 0; i < numToggles; i++) {
      await humanDelay(500, 900);

      // Lê o panelId e nomeDoc via evaluate (evita stale element refs)
      const itemInfo = await page.evaluate((idx) => {
        const toggles = document.querySelectorAll('a.accordion-toggle[aria-controls]');
        const toggle  = toggles[idx];
        if (!toggle) return null;
        return {
          panelId: toggle.getAttribute('aria-controls'),
          nomeDoc: toggle.querySelector('p.file-name')?.textContent?.trim() || `doc_${idx}`,
          temArquivo: !!toggle.querySelector('i.fa-chevron-right, i.fa-chevron-down'),
        };
      }, i);

      if (!itemInfo || !itemInfo.temArquivo) continue;

      console.log(`Expandindo: "${itemInfo.nomeDoc}"`);

      // Abre o accordion clicando via JS (evita problema de visibilidade)
      await page.evaluate((idx) => {
        const toggles = document.querySelectorAll('a.accordion-toggle[aria-controls]');
        if (toggles[idx]) toggles[idx].click();
      }, i);

      // Aguarda o painel abrir completamente
      await page.waitForFunction((panelId) => {
        const panel = document.getElementById(panelId);
        return panel && !panel.classList.contains('collapse') && panel.offsetHeight > 0;
      }, itemInfo.panelId, { timeout: 6000 }).catch(() => {});

      await humanDelay(400, 600);

      // Lê nomes dos arquivos dentro do painel
      const filesNoPainel = await page.evaluate((panelId) => {
        const panel = document.getElementById(panelId);
        if (!panel) return [];
        return Array.from(panel.querySelectorAll('span.file-name.has-file')).map(s => s.textContent?.trim());
      }, itemInfo.panelId);

      if (filesNoPainel.length === 0) {
        console.log(`  Nenhum arquivo visível em "${itemInfo.nomeDoc}"`);
        continue;
      }

      for (let j = 0; j < filesNoPainel.length; j++) {
        const nomeArquivo = filesNoPainel[j];
        if (jaiBaixados.has(nomeArquivo)) {
          console.log(`  Ignorando duplicata: ${nomeArquivo}`);
          continue;
        }
        console.log(`  Baixando: ${nomeArquivo}`);
        await humanDelay(300, 600);

        // Dispara o ng-click via JS (bypassa restrições de visibilidade do Playwright)
        const [popupOuDownload] = await Promise.all([
          Promise.race([
            page.waitForEvent('download', { timeout: 20000 }),
            context.waitForEvent('page',   { timeout: 20000 }),
          ]).catch(() => null),
          page.evaluate(({ panelId, fileIdx }) => {
            const panel = document.getElementById(panelId);
            if (!panel) return;
            const spans = panel.querySelectorAll('span.file-name.has-file');
            if (spans[fileIdx]) {
              spans[fileIdx].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            }
          }, { panelId: itemInfo.panelId, fileIdx: j }),
        ]);

        if (!popupOuDownload) {
          console.warn(`  Sem resposta para: ${nomeArquivo}`);
          continue;
        }

        if (typeof popupOuDownload.suggestedFilename === 'function') {
          // É um download direto — usa nomeArquivo se já tem extensão (evita .pdf.pdf)
          const dl   = popupOuDownload;
          const nome = nomeArquivo.includes('.') ? nomeArquivo : (dl.suggestedFilename() || nomeArquivo);
          const dest = path.join(destino, nome);
          await dl.saveAs(dest);
          jaiBaixados.add(nomeArquivo);
          arquivos.push(dest);
          console.log(`  Salvo: ${dest}`);
        } else {
          // É uma nova aba — extrai a URL e baixa via fetch com cookies
          const popup = popupOuDownload;
          await popup.waitForLoadState('domcontentloaded').catch(() => {});
          const fileUrl = popup.url();
          console.log(`  URL do arquivo: ${fileUrl}`);
          await popup.close();

          // Baixa o arquivo via request autenticado (usa cookies da sessão)
          const cookies = await context.cookies();
          const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

          const https = require('https');
          const http  = require('http');
          const lib   = fileUrl.startsWith('https') ? https : http;
          const ext   = path.extname(new URL(fileUrl).pathname) || '.bin';
          const nome  = nomeArquivo.includes('.') ? nomeArquivo : nomeArquivo + ext;
          const dest  = path.join(destino, nome);

          await new Promise((resolve, reject) => {
            const req = lib.get(fileUrl, { headers: { Cookie: cookieStr } }, (res) => {
              if (res.statusCode === 301 || res.statusCode === 302) {
                const redirLib = res.headers.location?.startsWith('https') ? https : http;
                redirLib.get(res.headers.location, { headers: { Cookie: cookieStr } }, (res2) => {
                  const out = fs.createWriteStream(dest);
                  res2.pipe(out);
                  out.on('finish', () => { out.close(); resolve(); });
                  out.on('error', reject);
                }).on('error', reject);
                return;
              }
              const out = fs.createWriteStream(dest);
              res.pipe(out);
              out.on('finish', () => { out.close(); resolve(); });
              out.on('error', reject);
            });
            req.on('error', reject);
          });

          jaiBaixados.add(nomeArquivo);
          arquivos.push(dest);
          console.log(`  Salvo (via URL): ${dest}`);
        }
      }

      // Recolhe o toggle para fechar e ir para o próximo
      await humanDelay(500, 800);
    }

    if (arquivos.length === 0) {
      await screenshot(page, `gestta-sem-downloads-${tarefaId}`);
      console.warn(`Download concluído mas 0 arquivos salvos — verificar screenshots`);
    } else {
      console.log(`\nTotal: ${arquivos.length} arquivo(s) baixado(s)`);
    }

    return arquivos;

  } catch (error) {
    await screenshot(page, `gestta-erro-download-${tarefaId}`);
    throw error;
  } finally {
    await browser.close();
  }
}

// ── Helper: muda status de tarefa via ui-select AngularJS ────────────────
//
// O Gestta usa ui-select (não <select> nativo). Estratégia:
//   1. Via AngularJS scope: chama onSelectStatus() diretamente (mais confiável)
//   2. Fallback: clica no .ui-select-toggle, espera dropdown, clica "Concluída"

async function _concluirTarefa(page, tarefaId) {
  // Tenta via AngularJS scope
  const result = await page.evaluate(() => {
    const container = document.querySelector('[ui-select][ng-model="taskDetails.details.status"]');
    if (!container) return { ok: false, motivo: 'ui-select nao encontrado' };

    const scope = angular.element(container).scope();
    if (!scope || !scope.taskDetails) return { ok: false, motivo: 'scope nao encontrado' };

    const choices = scope.taskDetails.TASK_STATUS_AS_CHOICES || [];
    const done = choices.find(c => c.name === 'DONE' || c._id === 'DONE');
    if (!done) return { ok: false, motivo: 'opcao DONE nao encontrada', disponiveis: choices.map(c => c.name || c._id) };

    scope.taskDetails.actions.onSelectStatus(done);
    scope.$apply();
    return { ok: true };
  });

  if (!result.ok) {
    console.log(`Fallback dropdown (${result.motivo})...`);
    // Clica no botão toggle do ui-select para abrir o dropdown
    await page.click('.ui-select-container .ui-select-toggle');
    await humanDelay(800, 1200);

    // Aguarda e clica na opção "Concluída"
    await page.waitForSelector('.ui-select-choices .ui-select-choice', { timeout: 8000 });
    const opcoes = await page.$$('.ui-select-choices .ui-select-choice');
    let clicou = false;
    for (const op of opcoes) {
      const txt = await op.textContent();
      if (txt && txt.includes('Conclu')) {
        await op.click();
        clicou = true;
        break;
      }
    }
    if (!clicou) throw new Error('Opcao "Concluida" nao encontrada no dropdown');
    await humanDelay(800, 1200);
  }

  // Confirma modal se aparecer (alguns status disparam confirmação)
  const btnConfirmar = page.getByRole('button', { name: /confirmar|ok|sim/i });
  if (await btnConfirmar.isVisible({ timeout: 3000 }).catch(() => false)) {
    await btnConfirmar.click();
    await humanDelay(500, 1000);
  }

  // Verifica que o status mudou
  await humanDelay(1500, 2500);
  const novoStatus = await page.evaluate(() => {
    const span = document.querySelector('.ui-select-match-text span[ng-bind]');
    return span?.textContent?.trim() || '';
  });
  if (novoStatus.includes('Conclu')) {
    console.log(`Status confirmado: ${novoStatus}`);
  } else {
    console.warn(`Status apos clique: "${novoStatus}" — pode nao ter mudado`);
  }
}

// ── FUNÇÃO 3: Concluir tarefa LANÇAMENTOS ────────────────────────────────
async function concluirTarefaLancamentos(tarefaId, competencia = null) {
  const agora = new Date();
  const ano   = competencia ? parseInt(competencia.split('/')[1]) : agora.getFullYear();
  const mes   = competencia ? parseInt(competencia.split('/')[0]) : agora.getMonth() + 1;

  const browser = await chromium.launch({ headless: true });
  const context = await criarContexto(browser);
  const page    = await context.newPage();

  try {
    if (!(await sessaoValida(page))) throw new Error('SESSAO_EXPIRADA');

    await page.goto(urlDetalhe(tarefaId, ano, mes), { waitUntil: 'networkidle', timeout: 30000 });
    await humanDelay(2000, 3000);

    await _concluirTarefa(page, tarefaId);
    console.log(`Tarefa lancamentos ${tarefaId} concluida`);
    return true;

  } catch (error) {
    await screenshot(page, `gestta-erro-conclusao-${tarefaId}`);
    throw error;
  } finally {
    await browser.close();
  }
}

// ── FUNÇÃO 4: Buscar tarefas COBRANÇA DE MOVIMENTO MENSAL ─────────────────
//
// Busca todas as tarefas COBRANÇA abertas no período. Usa URL sem filtro
// document_request_sent para capturar tarefas antes e depois do envio da cobrança.

async function buscarTarefasCobranca(competencia = null) {
  const agora = new Date();
  const ano   = competencia ? parseInt(competencia.split('/')[1]) : agora.getFullYear();
  const mes   = competencia ? parseInt(competencia.split('/')[0]) : agora.getMonth() + 1;

  const browser = await chromium.launch({ headless: true });
  const context = await criarContexto(browser);
  const page    = await context.newPage();

  try {
    if (!(await sessaoValida(page))) throw new Error('SESSAO_EXPIRADA');

    await humanDelay();
    await page.goto(urlListaCobranca(ano, mes), { waitUntil: 'networkidle', timeout: 30000 });
    await humanDelay(2000, 3500);

    const temTarefas = await page.waitForSelector('li.task-item', { timeout: 15000 })
      .then(() => true).catch(() => false);

    if (!temTarefas) {
      console.log(`Nenhuma tarefa COBRANCA em ${mes}/${ano}`);
      return [];
    }

    // Filtra apenas tarefas COBRANÇA pelo nome
    const dadosDom = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('li.task-item')).map((li, i) => {
        const nome = li.querySelector('.task-name span')?.textContent?.trim() || '';
        if (!nome.toUpperCase().includes('COBRAN')) return null;
        const raw   = li.querySelector('.task-customer-name')?.textContent?.trim() || '';
        const match = raw.match(/^([A-Z0-9]+)\s*-\s*(.+)$/);
        return {
          indice:        i,
          nome,
          clienteCodigo: match?.[1] || '',
          clienteNome:   match?.[2] || raw,
          taskId:        null,
        };
      }).filter(Boolean);
    });

    console.log(`${dadosDom.length} tarefa(s) COBRANCA encontrada(s) em ${mes}/${ano}`);

    // Clica em cada card para extrair o taskId da URL
    for (const tarefa of dadosDom) {
      await humanDelay(600, 1200);
      const cards = await page.$$('li.task-item .task-card-item');
      if (!cards[tarefa.indice]) continue;

      await cards[tarefa.indice].click();
      await humanDelay(1500, 2500);
      tarefa.taskId = extrairTaskId(page.url());
      console.log(`  ${tarefa.clienteCodigo}: taskId=${tarefa.taskId}`);

      await page.goto(urlListaCobranca(ano, mes), { waitUntil: 'networkidle', timeout: 30000 });
      await humanDelay(1500, 2500);
    }

    return dadosDom;

  } catch (error) {
    await screenshot(page, 'gestta-erro-cobranca');
    throw error;
  } finally {
    await browser.close();
  }
}

// ── FUNÇÃO 5: Analisar suficiência dos documentos ─────────────────────────
//
// Lê a Observação do cliente (Dados Cadastrais) e o status de cada
// documento solicitado. Determina se todos estão "Enviado" ou "Desconsiderado".
//
// Seletores calibrados em 26/06/2026:
//  - Botão ℹ️: button[ng-click="taskDetails.actions.openCustomerDetailsModal()"]
//  - Nome do doc: p.file-name dentro de a.accordion-toggle
//  - Status do doc: p.file-upload-date (texto "Enviado em:" / "Desconsiderado em:" / ausente=pendente)

async function analisarSuficienciaDocumentos(tarefaId, competencia = null) {
  const agora = new Date();
  const ano   = competencia ? parseInt(competencia.split('/')[1]) : agora.getFullYear();
  const mes   = competencia ? parseInt(competencia.split('/')[0]) : agora.getMonth() + 1;

  const browser = await chromium.launch({ headless: true });
  const context = await criarContexto(browser);
  const page    = await context.newPage();

  try {
    if (!(await sessaoValida(page))) throw new Error('SESSAO_EXPIRADA');

    await page.goto(urlDetalhe(tarefaId, ano, mes), { waitUntil: 'networkidle', timeout: 30000 });
    await humanDelay(2500, 4000);

    // ── 1. Lê Observação via modal Dados Cadastrais ───────────────────────
    let observacao = '';
    const infoBtn = await page.$('button[ng-click="taskDetails.actions.openCustomerDetailsModal()"]');
    if (infoBtn) {
      await infoBtn.click();
      await humanDelay(1500, 2500);

      // Aguarda modal abrir
      await page.waitForSelector('.modal.in, .modal[aria-hidden="false"]', { timeout: 8000 }).catch(() => {});
      await humanDelay(500, 800);

      observacao = await page.evaluate(() => {
        const modal = document.querySelector('.modal.in .modal-body, .modal[aria-hidden="false"] .modal-body');
        if (!modal) return '';
        const txt = modal.innerText || '';
        const idx = txt.indexOf('Observação');
        return idx >= 0 ? txt.slice(idx).trim() : txt.trim().slice(0, 2000);
      });

      const fechar = await page.$('.modal.in .close, .modal.in [data-dismiss="modal"], .modal.in [ng-click*="close"]');
      if (fechar) await fechar.click();
      await humanDelay(800, 1200);
    } else {
      console.warn('Botão Dados Cadastrais nao encontrado — observacao vazia');
    }

    // ── 2. Expande DOCUMENTOS SOLICITADOS (se fechado) ────────────────────
    await page.waitForSelector('text=DOCUMENTOS SOLICITADOS', { timeout: 15000 });
    const secaoAberta = await page.evaluate(() =>
      document.querySelectorAll('.document-request-list a.accordion-toggle').length > 0
    );
    if (!secaoAberta) {
      await page.locator('.panel-heading:has-text("DOCUMENTOS SOLICITADOS")').first().click({ force: true });
      await humanDelay(1500, 2500);
    }

    // ── 3. Lê status de cada documento ────────────────────────────────────
    // p.file-name = nome, p.file-upload-date = status (dentro do toggle, não do panel)
    const documentos = await page.evaluate(() => {
      const toggles = document.querySelectorAll('.document-request-list a.accordion-toggle');
      return Array.from(toggles).map(toggle => {
        const nome      = toggle.querySelector('p.file-name')?.textContent?.trim() || '';
        const dateText  = toggle.querySelector('p.file-upload-date')?.textContent?.trim() || '';
        const panelId   = toggle.getAttribute('aria-controls');
        const panel     = panelId ? document.getElementById(panelId) : null;
        const panelText = panel ? (panel.textContent || '') : '';

        let status;
        let numArquivos = 0;
        if (dateText.includes('Desconsiderado em:')) {
          status = 'desconsiderado';
        } else if (dateText.includes('Enviado em:')) {
          status = 'enviado';
          const m = panelText.match(/(\d+)\s+arquivo/);
          numArquivos = m ? parseInt(m[1]) : 1;
        } else {
          status = 'pendente';
        }

        return { nome, status, numArquivos };
      });
    });

    // ── 4. Determina suficiência ──────────────────────────────────────────
    const pendentes = documentos.filter(d => d.status === 'pendente').map(d => d.nome);
    const suficiente = pendentes.length === 0;

    console.log(`Suficiencia: ${documentos.length} docs | pendentes: ${pendentes.length}`);
    documentos.forEach(d => {
      const icone = d.status === 'enviado' ? '[OK]' : d.status === 'desconsiderado' ? '[N/A]' : '[PEND]';
      console.log(`  ${icone} ${d.nome}`);
    });
    if (observacao) console.log(`  Observacao: ${observacao.slice(0, 100)}...`);

    return { observacao, documentos, suficiente, pendentes };

  } catch (error) {
    await screenshot(page, `gestta-erro-analise-${tarefaId}`);
    throw error;
  } finally {
    await browser.close();
  }
}

// ── FUNÇÃO 6: Marcar checklist e concluir tarefa COBRANÇA ─────────────────
//
// 1. Expande o CHECKLIST (seção de steps)
// 2. Clica em cada um dos 9 checkboxes (ng-model="step.done")
// 3. Muda o status da tarefa para "Concluída"
//
// Seletores calibrados em 26/06/2026:
//  - Checkboxes: .step-list .step-row input[type="checkbox"]
//  - ng-change: taskSteps.actions.toggleDone(step) — disparado ao clicar

async function marcarChecklistEConcluir(tarefaId, competencia = null) {
  const agora = new Date();
  const ano   = competencia ? parseInt(competencia.split('/')[1]) : agora.getFullYear();
  const mes   = competencia ? parseInt(competencia.split('/')[0]) : agora.getMonth() + 1;

  const browser = await chromium.launch({ headless: true });
  const context = await criarContexto(browser);
  const page    = await context.newPage();

  try {
    if (!(await sessaoValida(page))) throw new Error('SESSAO_EXPIRADA');

    await page.goto(urlDetalhe(tarefaId, ano, mes), { waitUntil: 'networkidle', timeout: 30000 });
    await humanDelay(2500, 4000);

    // ── 1. Garante que o CHECKLIST está expandido ─────────────────────────
    await page.waitForSelector('text=CHECKLIST', { timeout: 15000 });
    const checklistVisivel = await page.evaluate(
      () => document.querySelectorAll('.step-list .step-row input[type="checkbox"]').length > 0
    );
    if (!checklistVisivel) {
      await page.locator('.panel-heading:has-text("CHECKLIST")').first().click({ force: true });
      await humanDelay(1500, 2500);
    }

    await page.waitForSelector('.step-list .step-row input[type="checkbox"]', { timeout: 10000 });

    // ── 2. Clica em cada checkbox ainda não marcado ───────────────────────
    const total = await page.evaluate(
      () => document.querySelectorAll('.step-list .step-row input[type="checkbox"]').length
    );
    console.log(`Marcando ${total} itens do checklist...`);

    for (let i = 0; i < total; i++) {
      await humanDelay(500, 900);

      const info = await page.evaluate((idx) => {
        const cbs = document.querySelectorAll('.step-list .step-row input[type="checkbox"]');
        const cb  = cbs[idx];
        if (!cb) return { ok: false };
        const label  = document.querySelector(`label[for="${cb.id}"]`);
        const texto  = label?.textContent?.trim().slice(0, 60) || `item ${idx + 1}`;
        const jaOk   = cb.checked;
        if (!jaOk) cb.click();
        return { ok: true, jaOk, texto };
      }, i);

      if (!info.ok) continue;
      const estado = info.jaOk ? 'ja marcado' : 'marcado agora';
      console.log(`  [${i + 1}] ${estado}: ${info.texto}...`);
      if (!info.jaOk) await humanDelay(600, 1000); // aguarda ng-change processar
    }

    // ── 3. Verifica quantos foram marcados ────────────────────────────────
    await humanDelay(1000, 1500);
    const marcados = await page.evaluate(
      () => Array.from(document.querySelectorAll('.step-list .step-row input[type="checkbox"]'))
                  .filter(cb => cb.checked).length
    );
    console.log(`${marcados}/${total} checkboxes marcados`);

    if (marcados < total) {
      // Segunda tentativa para os que não foram marcados
      await page.evaluate(() => {
        document.querySelectorAll('.step-list .step-row input[type="checkbox"]').forEach(cb => {
          if (!cb.checked) cb.click();
        });
      });
      await humanDelay(2000, 3000);
    }

    // ── 4. Conclui a tarefa ───────────────────────────────────────────────
    console.log('Concluindo tarefa COBRANCA...');
    await _concluirTarefa(page, tarefaId);

    console.log(`Tarefa cobranca ${tarefaId} concluida com ${total} itens de checklist`);
    return { ok: true, totalChecklist: total, marcados };

  } catch (error) {
    await screenshot(page, `gestta-erro-checklist-${tarefaId}`);
    throw error;
  } finally {
    await browser.close();
  }
}

module.exports = {
  buscarTarefasPendentes,
  buscarTarefasCobranca,
  baixarDocumentosCliente,
  analisarSuficienciaDocumentos,
  marcarChecklistEConcluir,
  concluirTarefaLancamentos,
};
