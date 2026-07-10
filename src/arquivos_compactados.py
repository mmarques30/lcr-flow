"""
Descompacta .zip/.rar baixados do Gestta antes do upload/processamento.

Chamado por bridge_front.processar_arquivos — substitui cada compactado pelos
arquivos internos processáveis (PDF, planilhas, imagens, CSV/XML etc.).
"""

from __future__ import annotations

import shutil
import subprocess
import zipfile
from pathlib import Path

ARCHIVE_EXT = {".zip", ".rar"}
MAX_DEPTH = 3
JUNK_NAMES = {".ds_store", "thumbs.db", "desktop.ini"}
JUNK_DIRS = {"__macosx"}

# Extensões que o bridge/edge conseguem processar (demais são ignoradas dentro do zip).
PROCESSAVEL = {
    ".pdf", ".xls", ".xlsx", ".csv", ".xml", ".txt", ".ofx",
    ".png", ".jpg", ".jpeg", ".gif", ".webp",
    ".html", ".htm",
}


def _log(msg: str):
    print(msg, flush=True)


def _nome_seguro(stem: str) -> str:
    s = stem.strip().replace("\\", "_").replace("/", "_")
    return s[:80] or "compactado"


def _destino_extracao(arquivo: Path) -> Path:
    return arquivo.parent / "_extraido" / _nome_seguro(arquivo.stem)


def _membro_ignorar(rel: str) -> bool:
    p = Path(rel.replace("\\", "/"))
    if any(part.lower() in JUNK_DIRS for part in p.parts):
        return True
    if p.name.lower() in JUNK_NAMES:
        return True
    if p.name.startswith("._"):
        return True
    return False


def _destino_membro(pasta: Path, rel: str) -> Path:
    """Resolve caminho de extração com proteção contra zip slip."""
    rel_norm = rel.replace("\\", "/").lstrip("/")
    dest = (pasta / rel_norm).resolve()
    base = pasta.resolve()
    if not str(dest).startswith(str(base)):
        raise ValueError(f"caminho inseguro no compactado: {rel}")
    return dest


def _find_7z() -> str | None:
    for cand in (
        shutil.which("7z"),
        shutil.which("7zz"),
        r"C:\Program Files\7-Zip\7z.exe",
        r"C:\Program Files (x86)\7-Zip\7z.exe",
    ):
        if cand and Path(cand).exists():
            return str(cand)
    return None


def _find_unrar() -> str | None:
    for cand in (shutil.which("unrar"), "/usr/bin/unrar"):
        if cand and Path(cand).exists():
            return str(cand)
    return None


def _extrair_com_unrar(arquivo: Path, destino: Path) -> None:
    exe = _find_unrar()
    if not exe:
        raise RuntimeError("unrar nao encontrado (apt install unrar)")
    destino.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(
        [exe, "x", "-o+", "-y", str(arquivo), str(destino) + "/"],
        capture_output=True,
        text=True,
        timeout=300,
    )
    if r.returncode != 0:
        err = (r.stderr or r.stdout or "").strip()[:200]
        raise RuntimeError(err or f"unrar exit {r.returncode}")


def _extrair_com_7z(arquivo: Path, destino: Path) -> None:
    exe = _find_7z()
    if not exe:
        raise RuntimeError("7z não encontrado (instale p7zip-full na VPS ou 7-Zip no Windows)")
    destino.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(
        [exe, "x", "-y", f"-o{destino}", str(arquivo)],
        capture_output=True,
        text=True,
        timeout=300,
    )
    if r.returncode != 0:
        err = (r.stderr or r.stdout or "").strip()[:200]
        raise RuntimeError(err or f"7z exit {r.returncode}")


def _extrair_zip(arquivo: Path, destino: Path) -> None:
    destino.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(arquivo, "r") as zf:
        for info in zf.infolist():
            if info.is_dir() or _membro_ignorar(info.filename):
                continue
            target = _destino_membro(destino, info.filename)
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info, "r") as src, open(target, "wb") as dst:
                shutil.copyfileobj(src, dst)


def _extrair_rar(arquivo: Path, destino: Path) -> None:
    # RAR5 exige unrar (RARLab); p7zip costuma falhar com "Unsupported Method".
    if _find_unrar():
        _extrair_com_unrar(arquivo, destino)
        return
    if _find_7z():
        _extrair_com_7z(arquivo, destino)
        return
    try:
        import rarfile  # type: ignore
    except ImportError as e:
        raise RuntimeError("unrar/7z indisponivel — instale unrar ou p7zip-full") from e
    destino.mkdir(parents=True, exist_ok=True)
    with rarfile.RarFile(arquivo) as rf:
        for info in rf.infolist():
            if info.is_dir() or _membro_ignorar(info.filename):
                continue
            target = _destino_membro(destino, info.filename)
            target.parent.mkdir(parents=True, exist_ok=True)
            with rf.open(info) as src, open(target, "wb") as dst:
                shutil.copyfileobj(src, dst)


def _extrair_arquivo(arquivo: Path) -> list[Path]:
    ext = arquivo.suffix.lower()
    destino = _destino_extracao(arquivo)
    if destino.exists():
        shutil.rmtree(destino, ignore_errors=True)
    if ext == ".zip":
        _extrair_zip(arquivo, destino)
    elif ext == ".rar":
        _extrair_rar(arquivo, destino)
    else:
        return []
    return _listar_processaveis(destino)


def _listar_processaveis(pasta: Path) -> list[Path]:
    out: list[Path] = []
    if not pasta.is_dir():
        return out
    for p in sorted(pasta.rglob("*")):
        if not p.is_file():
            continue
        if _membro_ignorar(str(p.relative_to(pasta))):
            continue
        if p.suffix.lower() in PROCESSAVEL:
            out.append(p)
    return out


def _expandir_recursivo(arquivos: list[Path], depth: int = 0) -> tuple[list[Path], list[str]]:
    saida: list[Path] = []
    avisos: list[str] = []
    for p in arquivos:
        if p.suffix.lower() in ARCHIVE_EXT:
            try:
                extraidos = _extrair_arquivo(p)
                if not extraidos:
                    avisos.append(f"{p.name}: compactado vazio ou sem arquivos processáveis")
                    continue
                _log(f"    {p.name} -> {len(extraidos)} arquivo(s) extraido(s)")
                if depth < MAX_DEPTH:
                    exp, av = _expandir_recursivo(extraidos, depth + 1)
                    saida.extend(exp)
                    avisos.extend(av)
                else:
                    saida.extend(extraidos)
            except Exception as e:
                avisos.append(f"{p.name}: falha ao extrair ({str(e)[:160]})")
        else:
            saida.append(p)
    return saida, avisos


def expandir_arquivos_compactados(arquivos: list[str]) -> tuple[list[str], list[str]]:
    """Substitui .zip/.rar pelos arquivos internos. Retorna (paths, avisos)."""
    paths = [Path(a) for a in arquivos if a]
    expandidos, avisos = _expandir_recursivo(paths)
    # Dedup por caminho absoluto (mesmo arquivo citado 2x)
    vistos: set[str] = set()
    unicos: list[str] = []
    for p in expandidos:
        key = str(p.resolve())
        if key in vistos:
            continue
        vistos.add(key)
        unicos.append(str(p))
    return unicos, avisos
