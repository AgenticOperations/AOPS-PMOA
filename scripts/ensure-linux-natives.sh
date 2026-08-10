#!/usr/bin/env bash
# npm optional-deps bug (https://github.com/npm/cli/issues/4828): lockfiles
# generated on macOS often omit Linux native packages. Force-install the
# ubuntu-latest natives CI needs after `npm ci`.
set -euo pipefail

npm install --no-save \
  @rolldown/binding-linux-x64-gnu@1.1.4 \
  lightningcss-linux-x64-gnu@1.32.0 \
  @next/swc-linux-x64-gnu@15.5.23
