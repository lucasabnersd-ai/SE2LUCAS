# -*- coding: utf-8 -*-
"""
deploy.py - Publica o relatorio SE2 (Posicao Diaria) no GitHub Pages, so com Python.

Baseado na logica do auto_commit.py do EXTRATO:
  - Localiza o git.exe (PATH > Program Files > git embutido no GitHub Desktop).
  - Inicializa/conserta o repositorio git desta pasta automaticamente.
  - Conecta no remoto existente (fetch + reset --mixed) sem apagar arquivos locais.
  - git add . / commit / push  (respeita o .gitignore).
  - Nao cria commit vazio; nao pede nada digitado (100% automatico).

Uso:
    python deploy.py
    python deploy.py --message "Atualizacao manual"

Em outro script (ex.: no fim do atualizar.py):
    import sys; sys.path.insert(0, r"C:/Users/lucas/Downloads/se2 - sistema/PUBLICAR_GITHUB")
    import deploy; deploy.publicar()
"""

import argparse
import glob
import os
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# ============================================================
# CONFIGURACAO - repositorio SE2LUCAS
# ============================================================
REPO_DIR   = Path(__file__).resolve().parent
REMOTE_URL = "https://github.com/lucasabnersd-ai/SE2LUCAS.git"
BRANCH     = "main"
USER_EMAIL = "lucas.abnersd@gmail.com"
USER_NAME  = "lucas-abnersd"
PAGES_URL  = "https://lucasabnersd-ai.github.io/SE2LUCAS/"

GIT_EXE = "git"  # preenchido em runtime por _localizar_git()
# ============================================================


def _localizar_git():
    """Acha o git.exe: PATH > Program Files > GitHub Desktop embutido."""
    achado = shutil.which("git")
    if achado:
        return achado

    candidatos = [
        r"C:\Program Files\Git\cmd\git.exe",
        r"C:\Program Files\Git\bin\git.exe",
        r"C:\Program Files (x86)\Git\cmd\git.exe",
        os.path.expandvars(r"%LocalAppData%\Programs\Git\cmd\git.exe"),
    ]
    # GitHub Desktop - a pasta da versao muda a cada update (app-*)
    for pattern in [
        r"%LocalAppData%\GitHubDesktop\app-*\resources\app\git\cmd\git.exe",
        r"%LocalAppData%\GitHubDesktop\app-*\resources\app\git\mingw64\bin\git.exe",
        r"%LocalAppData%\GitHubDesktop\app-*\resources\app\git\mingw32\bin\git.exe",
    ]:
        for p in sorted(glob.glob(os.path.expandvars(pattern)), reverse=True):
            candidatos.append(p)

    for c in candidatos:
        if c and os.path.isfile(c):
            return c

    raise RuntimeError(
        "git.exe nao encontrado.\n"
        "  - Se usa GitHub Desktop: abra-o uma vez (ele instala/atualiza o git).\n"
        "  - Senao, instale Git for Windows: https://git-scm.com/download/win"
    )


def _run(cmd, cwd=None, check=True, quiet=False):
    if not quiet:
        print("  $ " + " ".join(str(c) for c in cmd))
    try:
        res = subprocess.run(
            cmd, cwd=str(cwd) if cwd else None,
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
    except FileNotFoundError:
        raise RuntimeError("Executavel nao encontrado: " + str(cmd[0]))
    if not quiet:
        if res.stdout.strip():
            print(res.stdout.rstrip())
        if res.stderr.strip():
            print(res.stderr.rstrip())
    if check and res.returncode != 0:
        raise RuntimeError(
            "Comando falhou (codigo %d): %s\nstderr: %s"
            % (res.returncode, " ".join(str(c) for c in cmd), res.stderr.strip())
        )
    return res.returncode, res.stdout, res.stderr


def _repo_saudavel(repo_dir):
    """True se .git existe E o git reconhece o diretorio como repo valido."""
    if not (Path(repo_dir) / ".git").exists():
        return False
    rc, out, _ = _run([GIT_EXE, "rev-parse", "--is-inside-work-tree"],
                      cwd=repo_dir, check=False, quiet=True)
    return rc == 0 and "true" in (out or "")


def _config_basico(repo_dir):
    _run([GIT_EXE, "config", "user.email", USER_EMAIL], cwd=repo_dir, check=False)
    _run([GIT_EXE, "config", "user.name", USER_NAME], cwd=repo_dir, check=False)
    rc, helper, _ = _run([GIT_EXE, "config", "--get", "credential.helper"],
                         cwd=repo_dir, check=False, quiet=True)
    if not helper.strip():
        _run([GIT_EXE, "config", "credential.helper", "manager"],
             cwd=repo_dir, check=False)


def _inicializar_repo(repo_dir):
    """Init + remote + fetch + reset, mantendo arquivos locais para o proximo commit."""
    gitdir = Path(repo_dir) / ".git"
    if gitdir.exists():
        print("\n[INIT] .git invalido/incompleto em '%s'. Recriando do zero..." % repo_dir)
        shutil.rmtree(gitdir, ignore_errors=True)
    else:
        print("\n[INIT] '%s' ainda nao e repo git. Configurando..." % repo_dir)

    _run([GIT_EXE, "init"], cwd=repo_dir)
    _run([GIT_EXE, "checkout", "-B", BRANCH], cwd=repo_dir, check=False)
    _config_basico(repo_dir)

    rc, _, _ = _run([GIT_EXE, "remote", "get-url", "origin"],
                    cwd=repo_dir, check=False, quiet=True)
    if rc != 0:
        _run([GIT_EXE, "remote", "add", "origin", REMOTE_URL], cwd=repo_dir)
    else:
        _run([GIT_EXE, "remote", "set-url", "origin", REMOTE_URL], cwd=repo_dir)

    rc, _, _ = _run([GIT_EXE, "fetch", "origin", BRANCH], cwd=repo_dir, check=False)
    if rc != 0:
        print("  AVISO: 'git fetch' falhou (repo remoto vazio ou sem rede). Fara push inicial.")
    else:
        rc, _, _ = _run([GIT_EXE, "reset", "--mixed", "origin/" + BRANCH],
                        cwd=repo_dir, check=False)
        if rc != 0:
            print("  Branch remoto inexistente; fara push inicial.")
    print("[INIT] OK\n")


def _ha_mudancas(repo_dir):
    rc, out, _ = _run([GIT_EXE, "status", "--porcelain"],
                      cwd=repo_dir, check=False, quiet=True)
    return bool(out.strip())


def _resumo(repo_dir):
    rc, out, _ = _run([GIT_EXE, "status", "--short"],
                      cwd=repo_dir, check=False, quiet=True)
    return out.strip()


def publicar(message=None, repo_dir=None):
    """Retorna: 0 sucesso | 1 erro | 2 nada a publicar."""
    repo = Path(repo_dir) if repo_dir else REPO_DIR

    print("=" * 60)
    print("  Publicando relatorio SE2 em: %s" % repo)
    print("  Remote: %s  |  Branch: %s" % (REMOTE_URL, BRANCH))
    print("=" * 60)

    global GIT_EXE
    try:
        GIT_EXE = _localizar_git()
    except RuntimeError as exc:
        print("\nERRO: %s" % exc)
        return 1
    print("\n[i] Usando git em: %s" % GIT_EXE)

    if not repo.is_dir():
        print("\nERRO: pasta do repo nao existe: %s" % repo)
        return 1

    # 1) Garante repo git saudavel (recria se .git estiver quebrado)
    if not _repo_saudavel(repo):
        _inicializar_repo(repo)
    else:
        _config_basico(repo)

    # 2) git add .
    # Fase 2: garante que backup.js (modificacoes) NUNCA seja publicado (vive so no Supabase).
    _run([GIT_EXE, "rm", "--cached", "--ignore-unmatch", "--", "backup.js"], cwd=repo, check=False)
    print("[1/3] git add .")
    _run([GIT_EXE, "add", "."], cwd=repo)

    if not _ha_mudancas(repo):
        print("\n  Nada mudou desde o ultimo commit. Nada a publicar.")
        return 2

    print("\n  Mudancas detectadas:")
    print("  " + _resumo(repo).replace("\n", "\n  "))

    msg = message or ("Atualizacao automatica " + datetime.now().strftime("%d/%m/%Y %H:%M:%S"))
    print("\n[2/3] git commit -m \"%s\"" % msg)
    _run([GIT_EXE, "commit", "-m", msg], cwd=repo)

    # 3) push
    print("\n[3/3] git push origin %s" % BRANCH)
    try:
        _run([GIT_EXE, "push", "-u", "origin", BRANCH], cwd=repo)
    except RuntimeError as exc:
        print("\nERRO no push: %s" % exc)
        print("\nDicas:")
        print(" - Abra o GitHub Desktop uma vez para garantir o login ativo.")
        print(" - Ou rode 'git push' manual nesta pasta para salvar as credenciais.")
        return 1

    print("\n" + "=" * 60)
    print("  PUBLICADO COM SUCESSO")
    print("  " + PAGES_URL)
    print("  (O GitHub Pages leva ~1 min para refletir as mudancas.)")
    print("=" * 60)
    return 0


def main():
    parser = argparse.ArgumentParser(description="Publica o relatorio SE2 no GitHub Pages.")
    parser.add_argument("--message", help="Mensagem do commit.")
    parser.add_argument("--repo", help="Pasta do repositorio local.")
    args = parser.parse_args()
    try:
        return publicar(message=args.message, repo_dir=args.repo)
    except Exception as exc:
        print("\nERRO FATAL: %s" % exc)
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
