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
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const ROOT = path.join(__dirname, '..');
const PORT = parseInt(process.env.PORT || '8080', 10);
const TOKEN = process.env.ORQUESTRAR_TOKEN || '';
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
