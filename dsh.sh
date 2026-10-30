#!/usr/bin/env bash
# 鲸生专属 dsh 入口（Git Bash / *nix）
# 独立程序副本（runtime/）+ 独立数据家（dsh-home/），不依赖也不污染机器上其他 dsh 环境
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR" || exit 1
export DSH_HOME="$DIR/dsh-home"
mkdir -p "$DSH_HOME/tmp"
export TEMP="$DSH_HOME/tmp"
export TMP="$DSH_HOME/tmp"
exec node "$DIR/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js" "$@"
