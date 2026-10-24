#!/usr/bin/env sh

set -eu

repo_dir=".vendor/effect"
repo_url="https://github.com/Effect-TS/effect"

if [ -d "$repo_dir/.git" ]; then
  exit 0
fi

mkdir -p ".vendor"
git clone "$repo_url" "$repo_dir"
