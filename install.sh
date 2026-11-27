#!/bin/sh
# Installs Antigravity Computer Use on macOS.
#
# Downloads the release archive for this Mac (Apple silicon or Intel), checks
# its SHA-256 against the digest pinned here and stops if it differs,
# installs the global /computer-use skill with background startup, then opens
# the permission setup, where you grant Accessibility and Screen Recording.
#
#   curl -fsSL https://raw.githubusercontent.com/shayann07/antigravity-computer-use/main/install.sh | sh
#
# Options after `sh -s --` go to install.command, for example:
#   curl -fsSL .../install.sh | sh -s -- --permission-mode host-managed
set -eu

VERSION=1.0.6
BASE="https://github.com/shayann07/antigravity-computer-use/releases/download/v$VERSION"

fail() { echo "$1" >&2; exit 1; }

[ "$(uname -s)" = Darwin ] || fail "This installer is for macOS. On Windows, follow the Install section of the README."

# A Terminal running under Rosetta reports x86_64 on Apple silicon, so ask the
# hardware rather than the current process.
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = 1 ]; then
  ARCH=macos-arm64
  EXPECTED=83da10769c1e9efe5308503a546390b7d629ee376d8d7c36689b8cde055544ff
else
  case "$(uname -m)" in
    x86_64) ARCH=macos-x64; EXPECTED=00cea6c959822e186c4056f4e9438879b271dc82c62b1b1b6e2f26976cc5d6e8 ;;
    *) fail "Unsupported Mac architecture: $(uname -m)" ;;
  esac
fi

ARCHIVE="AntigravityComputerUse-$VERSION-$ARCH.tar.gz"
CACHE="$HOME/Library/Caches/AntigravityComputerUse"
mkdir -p "$CACHE"
# Each run gets its own private folder, so a second installer running at the
# same time cannot delete this one's verified archive (#140). Folders from
# runs more than a day old are removed; a running install is never that old.
find "$CACHE" -maxdepth 1 -type d -name 'install-*' -mtime +1 -exec rm -rf {} + 2>/dev/null || true
STAGE=$(mktemp -d "$CACHE/install-$VERSION-$ARCH.XXXXXX") || fail "Could not create a private staging folder. Nothing was installed."
chmod 700 "$STAGE"
cd "$STAGE"

echo "Downloading $ARCHIVE..."
curl -fsSL --proto '=https' --tlsv1.2 -o "$ARCHIVE" "$BASE/$ARCHIVE" || fail "Download failed. Nothing was installed."
ACTUAL=$(shasum -a 256 "$ARCHIVE" | awk '{ print $1 }')
[ -n "$EXPECTED" ] && [ "$EXPECTED" = "$ACTUAL" ] || fail "SHA-256 check failed for $ARCHIVE. Nothing was installed."
echo "SHA-256 verified."

tar -xzf "$ARCHIVE"
for option in "$@"; do
  if [ "$option" = --also-claude-code ] && ! grep -Fq -- '--also-claude-code' ./macos-bundle/scripts/install.mjs; then
    fail "Release $VERSION does not include the Claude Code install option. Use a newer bundle that supports --also-claude-code."
  fi
done
./macos-bundle/install.command "$@"

echo
echo "Opening the permission setup. Grant Accessibility and Screen Recording when macOS asks;"
echo "only you can approve these. The setup files stay in $STAGE/macos-bundle."
./macos-bundle/Setup.Mac.Permissions.command
echo "Then type /computer-use in the host where you installed the skill."
