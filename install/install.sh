#!/usr/bin/env bash
# Installs or updates the UwUSpeak Vencord plugin on Linux and macOS.
#
#   curl -fsSL https://github.com/MagicCat3022/UwU_Speak/releases/latest/download/install.sh | bash
#
# Options go after "bash -s --", for example:
#   curl -fsSL .../install.sh | bash -s -- --vencord ~/src/Vencord --version v0.1.0 --inject
#
# It clones Vencord from source if needed (custom plugins can't be loaded by the prebuilt
# installer), copies the plugin into src/userplugins/uwuSpeak, builds Vencord, and patches
# Discord the first time.
set -euo pipefail

repo="MagicCat3022/UwU_Speak"
vencord="${VENCORD_PATH:-$HOME/Vencord}"
version="${UWUSPEAK_VERSION:-latest}"
inject=false

while [ $# -gt 0 ]; do
  case "$1" in
    --vencord) vencord="$2"; shift 2 ;;
    --version) version="$2"; shift 2 ;;
    --inject) inject=true; shift ;;
    -h | --help) echo "Usage: install.sh [--vencord <path>] [--version <tag>] [--inject]"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

step() { printf '\033[36m==> %s\033[0m\n' "$1"; }
fail() { printf '\033[31m%s\033[0m\n' "$1" >&2; exit 1; }
has() { command -v "$1" > /dev/null 2>&1; }

step "Checking prerequisites"
has git || fail "git is required. Install it with your package manager and run this again."
has node || fail "Node.js 22 or newer is required. Install it from https://nodejs.org and run this again."
has curl || fail "curl is required."
node_major="$(node --version | sed 's/^v//; s/\..*//')"
[ "$node_major" -ge 22 ] || fail "Node.js 22 or newer is required; found $(node --version)."
if ! has pnpm; then
  step "Installing pnpm (npm install -g pnpm)"
  npm install -g pnpm
  has pnpm || fail "pnpm was installed but is not on PATH. Open a new terminal and run this again."
fi

fresh=false
if [ ! -e "$vencord" ]; then
  step "Cloning Vencord into $vencord"
  git clone https://github.com/Vendicated/Vencord "$vencord"
  fresh=true
elif [ ! -d "$vencord/src/plugins" ]; then
  fail "$vencord exists but is not a Vencord source checkout. Pass --vencord with a different folder."
fi

if [ "$version" = latest ]; then
  url="https://github.com/$repo/releases/latest/download/uwuSpeak.zip"
else
  url="https://github.com/$repo/releases/download/$version/uwuSpeak.zip"
fi
temp="$(mktemp -d)"
trap 'rm -rf "$temp"' EXIT

step "Downloading the plugin ($version)"
curl -fsSL "$url" -o "$temp/uwuSpeak.zip"
if has unzip; then unzip -q "$temp/uwuSpeak.zip" -d "$temp"; else tar -xf "$temp/uwuSpeak.zip" -C "$temp"; fi
[ -f "$temp/uwuSpeak/index.tsx" ] || fail "The downloaded archive does not contain the plugin."

target="$vencord/src/userplugins/uwuSpeak"
step "Installing the plugin into $target"
mkdir -p "$vencord/src/userplugins"
rm -rf "$target"
mv "$temp/uwuSpeak" "$target"

cd "$vencord"
step "Installing Vencord dependencies"
pnpm install --frozen-lockfile
step "Building Vencord"
pnpm build
if [ "$fresh" = true ] || [ "$inject" = true ]; then
  step "Patching Discord to use this Vencord build (choose your Discord install when asked)"
  # Piped through bash, stdin is this script, so the installer's prompts read the terminal.
  if [ -r /dev/tty ]; then pnpm inject < /dev/tty; else pnpm inject; fi
fi

printf '\n\033[32mUwUSpeak is installed.\033[0m\n'
if [ "$fresh" = true ] || [ "$inject" = true ]; then
  echo "Start Discord, then enable UwUSpeak under Settings > Vencord > Plugins."
else
  echo "Fully restart Discord, then enable UwUSpeak under Settings > Vencord > Plugins if it is not on yet."
  echo "If Discord does not show Vencord, run this again with --inject."
fi
