#!/usr/bin/env python3
"""Parseia os logs do drain e lista os documentos NÃO parseados por cliente,
correlacionando cada ⚠️ ao cabeçalho da tarefa (── [i/N] CODIGO - Nome ──).
Gera resumo por categoria + detalhe por cliente. Salva em outputs/orquestracao/nao_parseados.txt."""
import re
import glob
import json
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parent.parent
LOGS = sorted(glob.glob(str(ROOT / "outputs" / "orquestracao" / "drain-*.log")))

RE_HEADER = re.compile(r"── \[\d+/\d+\] (.+?) ──")
RE_WARN = re.compile(r"⚠️\s+(?:extrato|documento) não processado \((.+?)\): (.+)")
RE_CONV = re.compile(r"⚠️\s+não consegui converter (.+?) p/ CSV \((.+?)\)")


def categoria(motivo: str) -> str:
    m = motivo.lower()
    if "nenhuma transação" in m:
        return "layout não reconhecido (0 transações)"
    if "formato não suportado" in m:
        ext = motivo.split(":")[-1].strip()
        return f"formato não suportado ({ext})"
    if "no /root object" in m or "unexpected eof" in m or "content_types" in m:
        return "arquivo corrompido (PDF/XLSX)"
    if "not a zip" in m or "unknown zip" in m or "expected bof" in m:
        return "'.xls' que é HTML/corrompido"
    if "upload" in m and "falhou" in m:
        return "falha de upload (storage)"
    return "outro"


por_cliente = defaultdict(list)   # cliente -> [(arquivo, motivo, categoria)]
por_categoria = defaultdict(int)
clientes_afetados = set()

for log in LOGS:
    cliente = "(desconhecido)"
    for linha in Path(log).read_text(encoding="utf-8", errors="replace").splitlines():
        h = RE_HEADER.search(linha)
        if h:
            cliente = h.group(1).strip()
            continue
        w = RE_WARN.search(linha)
        c = RE_CONV.search(linha)
        if w:
            arq, mot = w.group(1), w.group(2).strip()[:80]
        elif c:
            arq, mot = c.group(1), f"conversão .xls→CSV: {c.group(2).strip()}"[:80]
        else:
            continue
        cat = categoria(mot)
        por_cliente[cliente].append((arq, mot, cat))
        por_categoria[cat] += 1
        clientes_afetados.add(cliente)

total = sum(len(v) for v in por_cliente.values())
linhas_out = []
linhas_out.append(f"=== DOCS NÃO PARSEADOS — {total} arquivos · {len(clientes_afetados)} clientes ===\n")
linhas_out.append("── POR CATEGORIA ──")
for cat, n in sorted(por_categoria.items(), key=lambda x: -x[1]):
    linhas_out.append(f"  {n:4d}  {cat}")
linhas_out.append("\n── POR CLIENTE ──")
for cli in sorted(por_cliente, key=lambda c: -len(por_cliente[c])):
    itens = por_cliente[cli]
    linhas_out.append(f"\n{cli}  ({len(itens)} arquivo(s))")
    for arq, mot, cat in itens:
        linhas_out.append(f"    • {arq}  →  {mot}")

txt = "\n".join(linhas_out)
out = ROOT / "outputs" / "orquestracao" / "nao_parseados.txt"
out.write_text(txt, encoding="utf-8")
print(txt[:2500])
print(f"\n[salvo em {out}]")
