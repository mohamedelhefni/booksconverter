#!/bin/sh
# Builds boko to wasm into ./pkg. Needs rustup (wasm32-unknown-unknown target) + wasm-pack.
# .boko/ is a throwaway checkout: it's reset to BOKO_REV and patches/*.patch are applied on top.
set -eu
BOKO_REV=b148716498fdac70134555293a7405913988256a
cd "$(dirname "$0")"
[ -d .boko ] || git clone https://github.com/zacharydenton/boko.git .boko
git -C .boko fetch -q --depth 1 origin "$BOKO_REV"
git -C .boko reset -q --hard "$BOKO_REV"
for p in patches/*.patch; do git -C .boko apply "$PWD/$p"; done
wasm-pack build .boko --release --target web --out-dir "$PWD/pkg" --no-default-features --features wasm
rm -f pkg/.gitignore pkg/package.json pkg/README.md pkg/LICENSE
