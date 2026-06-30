#!/usr/bin/env python3
"""
scripts/drain_backlog.py — esvazia o backlog PROC-001 em LOTES FRESCOS.

Chama src/orquestrar.py --limite N em processos SEPARADOS: cada lote roda, sai e
libera a RAM (mesma unidade segura do tick horário do n8n, mas em sequência).
Assim drena rápido sem o risco de OOM de um processo Python longo no 2 GB.

Segurança:
  - Serializa contra o tick do n8n: se outro orquestrar.py já estiver rodando,
    espera (evita 2 processos pesados simultâneos; o guard 409 só cobre o HTTP).
  - Para quando não há mais pendentes, OU quando 2 lotes seguidos não processam
    nada (só sobram erro/aguardando_docs → precisam de humano), OU no teto de lotes.

Uso (na VPS, da raiz /opt/lcr):
  setsid nohup PYTHONUTF8=1 venv/bin/python3 scripts/drain_backlog.py \
      --competencia 2026-06 --limite 8 > outputs/orquestracao/drain.log 2>&1 < /dev/null &
"""
import argparse
import datetime as dt
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY = str(ROOT / "venv" / "bin" / "python3")
ORQ = str(ROOT / "src" / "orquestrar.py")


def log(msg):
    print(f"[drain {dt.datetime.utcnow().strftime('%H:%M:%S')}Z] {msg}", flush=True)


def outro_orquestrar_rodando() -> bool:
    """True se já existe um orquestrar.py rodando (ex.: tick do n8n via server.js).
    Chamado SÓ entre lotes — nesse instante o driver não tem filho ativo."""
    try:
        r = subprocess.run(["pgrep", "-af", "orquestrar.py"], capture_output=True, text=True)
        linhas = [l for l in r.stdout.splitlines() if "drain_backlog" not in l and l.strip()]
        return bool(linhas)
    except Exception:
        return False


def rodar_lote(competencia: str, limite: int) -> dict:
    """Roda um lote fresco e devolve a contagem (lê a última linha JSON do stdout)."""
    cmd = [PY, ORQ, "--competencia", competencia, "--limite", str(limite)]
    env = {"PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
    import os
    p = subprocess.run(cmd, capture_output=True, text=True, cwd=str(ROOT),
                       env={**os.environ, **env})
    # log bruto do filho vai junto (stderr inclui traceback se houver)
    if p.stdout:
        print(p.stdout, flush=True)
    if p.returncode != 0 and p.stderr:
        print("STDERR:\n" + p.stderr[-1500:], flush=True)
    for linha in reversed([l for l in (p.stdout or "").splitlines() if l.strip()]):
        try:
            obj = json.loads(linha)
            if isinstance(obj, dict) and "contagem" in obj:
                return obj
        except Exception:
            continue
    return {"ok": False, "rc": p.returncode, "contagem": {}, "total_tarefas": None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--competencia", required=True)
    ap.add_argument("--limite", type=int, default=8)
    ap.add_argument("--pausa", type=float, default=30, help="segundos entre lotes")
    ap.add_argument("--max-lotes", type=int, default=100)
    args = ap.parse_args()

    log(f"INÍCIO drain · competência {args.competencia} · limite {args.limite}/lote · pausa {args.pausa:g}s")
    total_proc = total_erro = total_pulada = total_aguard = 0
    sem_progresso = 0

    for i in range(1, args.max_lotes + 1):
        # serializa contra o tick do n8n
        esperas = 0
        while outro_orquestrar_rodando():
            if esperas == 0:
                log("outro orquestrar.py rodando (tick n8n?) — aguardando liberar...")
            esperas += 1
            time.sleep(20)
            if esperas > 30:  # 10 min travado → segue mesmo assim
                log("aviso: esperei 10min, seguindo com o lote")
                break

        log(f"── lote {i}/{args.max_lotes} ──")
        res = rodar_lote(args.competencia, args.limite)
        c = res.get("contagem", {}) or {}
        proc = c.get("processada", 0)
        erro = c.get("erro", 0)
        pulada = c.get("pulada_idempotencia", 0)
        aguard = c.get("aguardando_docs", 0)
        total = res.get("total_tarefas")
        total_proc += proc; total_erro += erro; total_pulada += pulada; total_aguard += aguard
        log(f"   lote: processada={proc} erro={erro} aguardando={aguard} pulada={pulada} (selecionadas={total})"
            f" | acumulado: proc={total_proc} erro={total_erro} aguard={total_aguard}")

        if res.get("rc") not in (0, None):
            log(f"   ⚠️ lote retornou rc={res.get('rc')} — registrado, seguindo")

        # parada 1: nada selecionado → backlog limpo
        if total == 0:
            log("✅ FIM: nenhuma tarefa pendente selecionada — backlog esvaziado.")
            break

        # parada 2: lotes seguidos sem nenhuma processada → só restam erro/aguardando
        if proc == 0:
            sem_progresso += 1
            if sem_progresso >= 2:
                log(f"⏹️ FIM: 2 lotes sem processar nada — restam {erro} erro / {aguard} aguardando_docs "
                    f"(precisam de revisão humana). Encerrando.")
                break
        else:
            sem_progresso = 0

        time.sleep(args.pausa)
    else:
        log(f"⏹️ FIM: atingiu o teto de {args.max_lotes} lotes.")

    log(f"RESUMO FINAL · processada={total_proc} · erro={total_erro} · aguardando={total_aguard} · pulada(idemp)={total_pulada}")


if __name__ == "__main__":
    main()
