#!/bin/zsh
cd "${0:A:h}" || exit 1
if node scripts/local-test-stack.mjs start; then
  open "http://127.0.0.1:${DSH_MAHJONG_PORT:-3082}/"
else
  read -k 1 "?按任意键关闭…"
fi
