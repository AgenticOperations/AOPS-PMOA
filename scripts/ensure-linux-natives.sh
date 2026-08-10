#!/usr/bin/env bash
# npm optional-deps bug (https://github.com/npm/cli/issues/4828): lockfiles
# generated on macOS often omit Linux native packages. Force-install the
# ubuntu-latest natives CI needs after `npm ci`.
set -euo pipefail

# Keep versions pinned to what this repo currently resolves.
# Prefer adding new packages here over whack-a-mole CI failures.
npm install --no-save \
  @rolldown/binding-linux-x64-gnu@1.1.4 \
  lightningcss-linux-x64-gnu@1.32.0 \
  @next/swc-linux-x64-gnu@15.5.23 \
  @tailwindcss/oxide-linux-x64-gnu@4.3.2 \
  @esbuild/linux-x64@0.28.1 \
  @img/sharp-linux-x64@0.34.5 \
  @img/sharp-libvips-linux-x64@1.2.4 \
  @unrs/resolver-binding-linux-x64-gnu@1.12.2 \
  @open-wallet-standard/core-linux-x64-gnu@1.2.4
