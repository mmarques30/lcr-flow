#!/usr/bin/env python3
"""Teste unitário OPT-0004 — competência_front usa competence_date do Gestta."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from orquestrar import competencia_front_da_tarefa  # noqa: E402


def test_usa_competence_date():
    assert competencia_front_da_tarefa({"competence": "2025-12"}, "2026-01") == "2025-12"


def test_fallback_cli_quando_vazio():
    assert competencia_front_da_tarefa({"competence": ""}, "2026-01") == "2026-01"
    assert competencia_front_da_tarefa({}, "2026-02") == "2026-02"


def test_ignora_formato_invalido():
    assert competencia_front_da_tarefa({"competence": "12/2025"}, "2026-01") == "2026-01"
    assert competencia_front_da_tarefa({"competence": "2025-12-01"}, "2026-01") == "2026-01"


if __name__ == "__main__":
    test_usa_competence_date()
    test_fallback_cli_quando_vazio()
    test_ignora_formato_invalido()
    print("OK — competencia_front_da_tarefa (OPT-0004)")
