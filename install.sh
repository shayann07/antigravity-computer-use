#!/bin/sh
# Installs Antigravity Computer Use on macOS.
#
# Downloads the release archive for this Mac (Apple silicon or Intel), checks
# its SHA-256 against the release's SHA256SUMS.txt and stops if it differs,
# installs the global /computer-use skill with background startup, then opens
# the permission setup, where you grant Accessibility and Screen Recording.
#
#   curl -fsSL https://raw.githubusercontent.com/shayann07/antigravity-computer-use/main/install.sh | sh
#
# Options after `sh -s --` go to install.command, for example:
#   curl -fsSL .../install.sh | sh -s -- --permission-mode host-managed
set -eu

VERSION=1.0.4
BASE="https://github.com/shayann07/antigravity-computer-use/releases/download/v$VERSION"

fail() { echo "$1" >&2; exit 1; }

[ "$(uname -s)" = Darwin ] || fail "This installer is for macOS. On Windows, follow the Install section of the README."

# A Terminal running under Rosetta reports x86_64 on Apple silicon, so ask the
# hardware rather than the current process.
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = 1 ]; then
  ARCH=macos-arm64
else
  case "$(uname -m)" in
    x86_64) ARCH=macos-x64 ;;
    *) fail "Unsupported Mac architecture: $(uname -m)" ;;
  esac
fi

ARCHIVE="AntigravityComputerUse-$VERSION-$ARCH.tar.gz"
STAGE="$HOME/Library/Caches/AntigravityComputerUse/install-$VERSION-$ARCH"
rm -rf "$STAGE"
mkdir -p "$STAGE"
chmod 700 "$STAGE"
cd "$STAGE"

echo "Downloading $ARCHIVE..."
curl -fsSL --proto '=https' --tlsv1.2 -o "$ARCHIVE" "$BASE/$ARCHIVE" || fail "Download failed. Nothing was installed."
curl -fsSL --proto '=https' --tlsv1.2 -o SHA256SUMS.txt "$BASE/SHA256SUMS.txt" || fail "Checksum download failed. Nothing was installed."

EXPECTED=$(awk -v name="$ARCHIVE" '$2 == name { print $1 }' SHA256SUMS.txt)
ACTUAL=$(shasum -a 256 "$ARCHIVE" | awk '{ print $1 }')
[ -n "$EXPECTED" ] && [ "$EXPECTED" = "$ACTUAL" ] || fail "SHA-256 check failed for $ARCHIVE. Nothing was installed."
echo "SHA-256 verified."

tar -xzf "$ARCHIVE"
./macos-bundle/install.command "$@"

echo
echo "Opening the permission setup. Grant Accessibility and Screen Recording when macOS asks;"
echo "only you can approve these. The setup files stay in $STAGE/macos-bundle."
./macos-bundle/Setup.Mac.Permissions.command
echo "Then, in Antigravity, type /computer-use and describe your task."
