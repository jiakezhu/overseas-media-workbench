#!/bin/zsh
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo '请先安装 Node.js 20 或更新版本。'
  read -r '?按回车关闭…'
  exit 1
fi
node server.mjs
