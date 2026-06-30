/**
 * src/server.js
 *
 * Endpoint HTTP que dispara o orquestrador PROC-001 (Etapas 1–4).
 * Pensado para o n8n Cloud chamar via HTTP Request (o n8n na nuvem não alcança a
 * máquina local; aqui ele alcança o VPS).
 *
 * O run é LONGO (lista tarefas + Playwright por tarefa), então o disparo é
 * ASSÍNCRONO: POST /orquestrar inicia e retorna 202 imediatamente; o resultado
 * fica no log (outputs/orquestracao/) e em GET /runs/latest.
 *
 * Segurança: todas as rotas (exceto /health) exigem  Authorization: Bearer <ORQUESTRAR_TOKEN>.
 *
 * Env: ORQUESTRAR_TOKEN (obrigatório), PORT (default 8080).
 * Start: node src/server.js   (ou via systemd — ver deploy)
 */

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const ROOT = path.join(__dirname, '..');
const PORT = parseInt(process.env.PORT || '8080', 10);
const TOKEN = process.env.ORQUESTRAR_TOKEN || '';
// Token só-leitura do painel de monitor (separado do ORQUESTRAR_TOKEN).
const MONITOR_TOKEN = process.env.MONITOR_TOKEN || '';
// Watchdog: tempo máximo de um run antes de ser encerrado à força (evita que um
// processo travado deixe `running=true` pra sempre e bloqueie os disparos do n8n).
const MAX_RUN_MIN = parseInt(process.env.MAX_RUN_MIN || '45', 10);
const KILL_GRACE_MS = 10 * 1000; // espera após SIGTERM antes do SIGKILL

const app = express();
app.use(express.json({ limit: '256kb' }));

let estado = { running: false, started_at: null, last: null };

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  if (!TOKEN || h !== `Bearer ${TOKEN}`) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  next();
}

app.get('/health', (_req, res) => res.json({ ok: true, running: estado.running, ts: new Date().toISOString() }));

app.get('/runs/latest', auth, (_req, res) => res.json({ ok: true, ...estado }));

app.post('/orquestrar', auth, (req, res) => {
  const { competencia, limite, cliente } = req.body || {};
  if (!competencia || !/^\d{4}-\d{2}$/.test(competencia)) {
    return res.status(400).json({ ok: false, error: 'competencia (YYYY-MM) obrigatória' });
  }
  if (estado.running) {
    return res.status(409).json({ ok: false, error: 'orquestração já em andamento', started_at: estado.started_at });
  }

  const args = ['src/orquestrar.py', '--competencia', competencia];
  if (limite) args.push('--limite', String(parseInt(limite, 10)));
  if (cliente) args.push('--cliente', String(cliente));

  const env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
  // detached: o filho vira líder de grupo → conseguimos matar a árvore toda
  // (python + Node + chromium) de uma vez, sem deixar processo órfão.
  const proc = spawn(process.env.PYTHON_BIN || 'python3', args, { cwd: ROOT, env, detached: true });

  estado = { running: true, started_at: new Date().toISOString(), last: null, args };
  let out = '', err = '';
  let killedByTimeout = false;

  // Mata a árvore de processos do run (grupo do líder = -pid).
  function matarArvore(sig) {
    try { process.kill(-proc.pid, sig); } catch (_) { try { proc.kill(sig); } catch (_) { /* já morreu */ } }
  }

  // Watchdog: encerra o run se exceder MAX_RUN_MIN.
  const watchdog = setTimeout(() => {
    killedByTimeout = true;
    console.warn(`[server] run excedeu ${MAX_RUN_MIN}min — encerrando (SIGTERM → SIGKILL)`);
    matarArvore('SIGTERM');
    setTimeout(() => matarArvore('SIGKILL'), KILL_GRACE_MS);
  }, MAX_RUN_MIN * 60 * 1000);

  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { err += d; });
  proc.on('close', (code) => {
    clearTimeout(watchdog);
    // tenta extrair o JSON final impresso pelo orquestrador
    let resumo = null;
    const linhas = out.trim().split('\n').filter(Boolean);
    try { resumo = JSON.parse(linhas[linhas.length - 1]); } catch { /* ignore */ }
    estado = {
      running: false,
      started_at: estado.started_at,
      finished_at: new Date().toISOString(),
      exit_code: code,
      timed_out: killedByTimeout,
      resumo,
      stderr_tail: (killedByTimeout ? `[encerrado por timeout de ${MAX_RUN_MIN}min] ` : '') + (err.slice(-1000) || ''),
      args,
    };
  });
  proc.on('error', (e) => { clearTimeout(watchdog); estado = { running: false, error: e.message, args }; });

  return res.status(202).json({ ok: true, started: true, competencia, args });
});

// ── Painel de monitor (HTML leve, auto-refresh, só dados locais) ─────────────
function lerRunsRecentes(n) {
  const dir = path.join(ROOT, 'outputs', 'orquestracao');
  try {
    return fs.readdirSync(dir)
      .filter((f) => /^run-.*\.json$/.test(f))
      .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)
      .slice(0, n)
      .map(({ f }) => {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          return { arquivo: f, gerado_em: d.gerado_em, total: d.total_tarefas, contagem: d.contagem || {}, tarefas: d.tarefas || [] };
        } catch { return { arquivo: f, contagem: {}, tarefas: [] }; }
      });
  } catch { return []; }
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const brDate = (iso) => { try { return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }); } catch { return esc(iso); } };
const CHIP_COR = { processada: '#16a34a', pulada_idempotencia: '#64748b', aguardando_docs: '#d97706', erro: '#dc2626' };
function chips(contagem) {
  return Object.entries(contagem).map(([k, v]) => `<span class="chip" style="background:${CHIP_COR[k] || '#475569'}">${esc(k)}: ${v}</span>`).join(' ') || '<span class="muted">—</span>';
}

app.get('/monitor', (req, res) => {
  if (!MONITOR_TOKEN || req.query.token !== MONITOR_TOKEN) {
    return res.status(401).type('html').send('<body style="font-family:sans-serif;background:#0f172a;color:#e2e8f0;padding:2rem"><h2>401</h2><p>Use <code>/monitor?token=…</code> com o token do monitor.</p></body>');
  }
  const tk = encodeURIComponent(req.query.token);
  const runs = lerRunsRecentes(12);
  const ultimo = runs[0];
  const memTot = os.totalmem() / 1048576, memFree = os.freemem() / 1048576, memUso = memTot - memFree;
  const memPct = Math.round((memUso / memTot) * 100);
  const memCor = memPct >= 85 ? '#dc2626' : memPct >= 70 ? '#d97706' : '#16a34a';
  const load = os.loadavg().map((x) => x.toFixed(2)).join('  ');
  const upH = (os.uptime() / 3600).toFixed(1);
  const running = estado.running;

  const linhasUltimo = (ultimo?.tarefas || []).map((t) => {
    const cor = CHIP_COR[t.status] || '#475569';
    const extra = t.motivo || (t.lancamentos_extrato != null ? `${t.lancamentos_extrato} lanç. extrato` : '');
    return `<tr><td><span class="dot" style="background:${cor}"></span>${esc(t.status)}</td><td>${esc(t.cliente)}</td><td class="muted">${esc(String(extra).slice(0, 80))}</td></tr>`;
  }).join('') || '<tr><td colspan="3" class="muted">sem tarefas</td></tr>';

  const linhasHist = runs.map((r) => `<tr><td class="muted">${brDate(r.gerado_em)}</td><td>${r.total ?? '—'}</td><td>${chips(r.contagem)}</td></tr>`).join('');

  const html = `<!doctype html><html lang="pt-br"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="60"><title>LCR PROC-001 · Monitor</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f172a;color:#e2e8f0;padding:18px;line-height:1.4}
h1{font-size:1.2rem;margin:0}h2{font-size:.95rem;margin:0 0 .6rem;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em}
.top{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;margin-bottom:14px}
.muted{color:#64748b}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin-bottom:14px}
.card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px}
.big{font-size:1.6rem;font-weight:700}
.badge{display:inline-block;padding:.25rem .7rem;border-radius:999px;font-weight:700;font-size:.85rem}
.run{background:#16a34a;color:#fff}.idle{background:#475569;color:#fff}
.chip{display:inline-block;padding:.12rem .5rem;border-radius:999px;color:#fff;font-size:.74rem;margin:1px 0}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle}
table{width:100%;border-collapse:collapse;font-size:.85rem}td,th{text-align:left;padding:.35rem .5rem;border-bottom:1px solid #2b3a52}th{color:#94a3b8;font-weight:600}
.bar{height:10px;background:#334155;border-radius:999px;overflow:hidden;margin-top:6px}.bar>div{height:100%}
a{color:#60a5fa}
</style></head><body>
<div class="top"><h1>🩺 LCR PROC-001 · Monitor <span class="muted" style="font-size:.8rem">VPS 206.189.229.35</span></h1>
<div class="muted">${brDate(new Date().toISOString())} · atualiza a cada 60s</div></div>

<div class="grid">
  <div class="card"><h2>Orquestrador</h2>
    <span class="badge ${running ? 'run' : 'idle'}">${running ? '● RODANDO' : '○ ocioso'}</span>
    <div style="margin-top:10px;font-size:.85rem">
      ${running
        ? `<div>Início: ${brDate(estado.started_at)}</div><div class="muted">args: ${esc((estado.args || []).join(' '))}</div>`
        : `<div>Último: ${estado.finished_at ? brDate(estado.finished_at) : '—'}</div>
           <div>exit: <b>${estado.exit_code ?? '—'}</b>${estado.timed_out ? ' <span style="color:#dc2626">(TIMEOUT)</span>' : ''}</div>
           <div style="margin-top:6px">${chips((estado.resumo && estado.resumo.contagem) || {})}</div>`}
    </div>
  </div>
  <div class="card"><h2>Recursos VPS</h2>
    <div class="big" style="color:${memCor}">${memPct}% RAM</div>
    <div class="muted">${memUso.toFixed(0)} / ${memTot.toFixed(0)} MB</div>
    <div class="bar"><div style="width:${memPct}%;background:${memCor}"></div></div>
    <div style="margin-top:10px;font-size:.85rem">load (1/5/15m): <b>${load}</b></div>
    <div class="muted" style="font-size:.85rem">uptime: ${upH} h</div>
  </div>
</div>

<div class="card" style="margin-bottom:14px"><h2>Última execução ${ultimo ? '· ' + brDate(ultimo.gerado_em) : ''}</h2>
  <table><thead><tr><th>Status</th><th>Cliente</th><th>Detalhe</th></tr></thead><tbody>${linhasUltimo}</tbody></table>
</div>

<div class="card"><h2>Histórico (últimas ${runs.length} execuções)</h2>
  <table><thead><tr><th>Quando</th><th>Tarefas</th><th>Resultado</th></tr></thead><tbody>${linhasHist}</tbody></table>
</div>
</body></html>`;
  res.type('html').send(html);
});

// HTTPS se TLS_CERT/TLS_KEY existirem (cert self-signed no VPS), senão HTTP.
const TLS_CERT = process.env.TLS_CERT;
const TLS_KEY = process.env.TLS_KEY;
if (TLS_CERT && TLS_KEY && fs.existsSync(TLS_CERT) && fs.existsSync(TLS_KEY)) {
  const https = require('https');
  https.createServer({ cert: fs.readFileSync(TLS_CERT), key: fs.readFileSync(TLS_KEY) }, app)
    .listen(PORT, () => console.log(`[server] HTTPS :${PORT} (token ${TOKEN ? 'ON' : 'OFF!'})`));
} else {
  app.listen(PORT, () => console.log(`[server] HTTP :${PORT} (token ${TOKEN ? 'ON' : 'OFF!'}) — sem TLS`));
}
