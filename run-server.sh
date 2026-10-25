#!/bin/bash
# Launcher for the weather MCP server.
#
# Claude Desktop is started by launchd, so it inherits a bare PATH with no node
# on it -- which is why invoking npx/node by name (or by a hardcoded nvm path)
# is fragile. Source nvm here instead, so the server always runs under whatever
# node version nvm resolves, including after an nvm upgrade.
#
# Everything before the exec must keep stdout clean: the MCP stdio transport
# speaks JSON-RPC on stdout, and a stray "Now using node v24.18.0" corrupts the
# stream. Hence the >&2 redirects.

set -eo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh" >&2

if [ -f .nvmrc ]; then
  nvm use >&2
else
  nvm use default >&2
fi

exec node node_modules/tsx/dist/cli.mjs src/index.ts
