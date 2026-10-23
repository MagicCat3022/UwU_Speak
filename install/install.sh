#!/usr/bin/env bash
# UwUSpeak installer for Linux and macOS.
#
#   curl -fsSL https://github.com/MagicCat3022/UwU_Speak/releases/latest/download/install.sh | bash
#
# This only makes sure Node.js is available (downloading a private copy when it isn't), then starts
# installer.mjs, which asks a few questions and does the rest. Options go after "bash -s --", for
# example: curl -fsSL .../install.sh | bash -s -- --yes --target discord. See --help.
#
# Environment: UWUSPEAK_RELEASE picks a release tag (default latest), UWUSPEAK_INSTALLER runs a
# local installer.mjs, UWUSPEAK_PORTABLE_NODE=1 ignores system Node.js.
set -euo pipefail

repo="MagicCat3022/UwU_Speak"
node_line="latest-v24.x"
release="${UWUSPEAK_RELEASE:-latest}"

fail() {
  printf '\n\033[31mx %s\033[0m\n' "$1" >&2
  echo "Need help? https://github.com/$repo/issues" >&2
  exit 1
}
has() { command -v "$1" > /dev/null 2>&1; }

case "$(uname -s)" in
  Linux) os=linux; state_dir="${XDG_DATA_HOME:-$HOME/.local/share}/uwuspeak" ;;
  Darwin) os=darwin; state_dir="$HOME/Library/Application Support/UwUSpeak" ;;
  *) fail "This installer supports Linux and macOS. On Windows, use install.ps1." ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) fail "Unsupported processor: $(uname -m)." ;;
esac
tools_dir="$state_dir/tools"

if has curl; then
  get() { curl -fsSL --retry 3 --retry-delay 1 "$1" -o "$2"; }
  get_text() { curl -fsSL --retry 3 --retry-delay 1 "$1"; }
elif has wget; then
  get() { wget -q --tries=3 -O "$2" "$1"; }
  get_text() { wget -q --tries=3 -O - "$1"; }
else
  fail "curl or wget is needed to download files."
fi

if has sha256sum; then
  sha256() { sha256sum "$1" | cut -d' ' -f1; }
else
  sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
fi

# True when the given node binary is at least 22.13.
node_ok() {
  "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' 2> /dev/null
}

node=""
if [ -z "${UWUSPEAK_PORTABLE_NODE:-}" ] && has node && node_ok node; then
  node="$(command -v node)"
fi
if [ -z "$node" ]; then
  for dir in $(ls -d "$tools_dir"/node-v*-"$os-$arch" 2> /dev/null | sort -rV 2> /dev/null || true); do
    if [ -x "$dir/bin/node" ] && node_ok "$dir/bin/node"; then node="$dir/bin/node"; break; fi
  done
fi
if [ -z "$node" ]; then
  if [ "$os" = linux ] && ldd --version 2>&1 | grep -qi musl; then
    fail "Install Node.js 22.13 or newer with your package manager (for example: apk add nodejs), then run this again."
  fi
  printf '\033[36mDownloading Node.js for the installer (about 30 MB, only once)...\033[0m\n'
  mkdir -p "$tools_dir"
  line="$(get_text "https://nodejs.org/dist/$node_line/SHASUMS256.txt" | grep -E "  node-v[0-9.]+-$os-$arch\.tar\.gz$" | head -1)" ||
    fail "Couldn't reach nodejs.org. Check your internet connection."
  [ -n "$line" ] || fail "Couldn't find a Node.js download for $os $arch."
  expected="${line%% *}"
  name="${line##* }"
  name="${name%.tar.gz}"
  version="${name#node-v}"
  version="${version%%-*}"
  archive="$tools_dir/$name.tar.gz"
  get "https://nodejs.org/dist/v$version/$name.tar.gz" "$archive" || fail "Couldn't download Node.js."
  if [ "$(sha256 "$archive")" != "$expected" ]; then
    rm -f "$archive"
    fail "The Node.js download is damaged (checksum mismatch). Run the installer again."
  fi
  rm -rf "${tools_dir:?}/$name"
  tar -xzf "$archive" -C "$tools_dir"
  rm -f "$archive"
  node="$tools_dir/$name/bin/node"
  [ -x "$node" ] || fail "Node.js was downloaded but can't be run on this system."
fi

if [ -n "${UWUSPEAK_INSTALLER:-}" ]; then
  installer="$UWUSPEAK_INSTALLER"
else
  if [ "$release" = latest ]; then
    base="https://github.com/$repo/releases/latest/download"
  else
    base="https://github.com/$repo/releases/download/$release"
  fi
  mkdir -p "$state_dir"
  installer="$state_dir/installer.mjs"
  get "$base/installer.mjs" "$installer" || fail "Couldn't download the installer. Check your internet connection."
  expected="$(get_text "$base/SHA256SUMS.txt" | awk '$2 == "installer.mjs" || $2 == "*installer.mjs" { print $1 }')" ||
    fail "Couldn't download the installer checksums."
  if [ -z "$expected" ] || [ "$(sha256 "$installer")" != "$expected" ]; then
    rm -f "$installer"
    fail "The installer download is damaged (checksum mismatch). Run the command again."
  fi
fi

args=("$installer")
[ "$release" = latest ] || args+=(--release "$release")
export NODE_USE_ENV_PROXY=1
# Piped through bash, stdin is this script; give the installer the terminal so it can ask questions.
if [ ! -t 0 ] && { true < /dev/tty; } 2> /dev/null; then
  exec "$node" "${args[@]}" "$@" < /dev/tty
fi
exec "$node" "${args[@]}" "$@"
