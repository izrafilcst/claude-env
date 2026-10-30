#!/usr/bin/env bash
# claude-env: bootstrap para Linux, macOS e WSL.
#
#   curl -fsSL https://raw.githubusercontent.com/izrafilcst/claude-env/main/install.sh | bash
#   curl -fsSL .../install.sh | bash -s -- --dry-run        # repassa opções ao instalador
#   ~/.claude-env/install.sh doctor                         # depois de instalado
#
# Garante git, Node.js, Python e Claude Code; baixa este repositório em ~/.claude-env
# e entrega o resto para scripts/install.mjs, que lê environment.json.
#
# Tudo fica dentro de main() para que o bash leia o script inteiro antes de rodar:
# assim nenhum comando filho "come" o restante do script quando ele chega via pipe.

main() {
  set -euo pipefail

  local repo_url="${CLAUDE_ENV_REPO:-https://github.com/izrafilcst/claude-env.git}"
  local dest="${CLAUDE_ENV_HOME:-$HOME/.claude-env}"

  ensure_git
  ensure_node
  ensure_python
  ensure_claude

  local src
  src="$(local_checkout)"
  if [ -z "$src" ]; then
    if [ -d "$dest/.git" ]; then
      say "Atualizando $dest"
      git -C "$dest" pull --ff-only --quiet
    else
      say "Baixando claude-env em $dest"
      git clone --depth 1 --quiet "$repo_url" "$dest"
    fi
    src="$dest"
  fi

  node "$src/scripts/install.mjs" "$@"
}

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
have() { command -v "$1" >/dev/null 2>&1; }

# Rodando de um clone (./install.sh)? Então usa ele mesmo em vez de baixar.
local_checkout() {
  local dir
  dir="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" 2>/dev/null && pwd)" || return 0
  if [ -f "$dir/environment.json" ] && [ -f "$dir/scripts/install.mjs" ]; then echo "$dir"; fi
}

pkg_install() {
  local sudo=""
  [ "$(id -u)" -ne 0 ] && have sudo && sudo="sudo"
  if have brew; then brew install "$@"
  elif have apt-get; then $sudo apt-get update -qq && $sudo apt-get install -y -qq "$@"
  elif have dnf; then $sudo dnf install -y -q "$@"
  elif have pacman; then $sudo pacman -Sy --noconfirm --needed "$@"
  elif have zypper; then $sudo zypper --non-interactive install "$@"
  elif have apk; then $sudo apk add --no-cache "$@"
  else return 1
  fi
}

ensure_git() {
  have git && return
  say "Instalando git"
  pkg_install git || { warn "Instale o git manualmente e rode de novo."; exit 1; }
}

node_ok() { have node && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ]; }

ensure_node() {
  node_ok && return
  say "Instalando Node.js LTS via nvm"
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [ -s "$NVM_DIR/nvm.sh" ] || curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  # nvm não foi escrito para "set -u"
  set +u
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
  nvm install --lts
  set -u
  node_ok || { warn "Não consegui instalar o Node.js 18+."; exit 1; }
}

ensure_python() {
  have python3 && return
  say "Instalando Python 3 (usado pelas skills hunter-*)"
  pkg_install python3 || warn "Sem Python 3: as skills hunter-* não vão rodar seus scripts."
}

ensure_claude() {
  have claude && return
  say "Instalando Claude Code"
  curl -fsSL https://claude.ai/install.sh | bash
  export PATH="$HOME/.local/bin:$PATH"
  have claude || { warn "Claude Code instalado, mas fora do PATH. Abra um novo terminal e rode de novo."; exit 1; }
}

main "$@"
