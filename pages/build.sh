#!/usr/bin/env bash
set -euo pipefail

pages_dir="$(cd "$(dirname "$0")" && pwd)"
app_root="$(dirname "$pages_dir")"
output="$pages_dir/dist"

(
  cd "$app_root"
  npm run build:web
)

mkdir -p "$output"
cp -R "$app_root/www/." "$output/"
for bundle in "$output"/assets/{index,web,highlight,katex,markdown}-*.js; do
  [ -e "$bundle" ] || continue
  if [ ! -f "$app_root/www/assets/$(basename "$bundle")" ]; then
    rm "$bundle"
  fi
done
rm -f "$output/js/app.js"
echo "Pages build ready: $output"
