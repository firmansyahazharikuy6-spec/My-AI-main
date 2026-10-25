$ErrorActionPreference = "Stop"

$appRoot = Split-Path -Parent $PSScriptRoot
$output = Join-Path $PSScriptRoot "dist"

Push-Location $appRoot
try {
  npm.cmd run build:web
  if ($LASTEXITCODE -ne 0) {
    throw "Vite production build failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}

New-Item -ItemType Directory -Path $output -Force | Out-Null
Copy-Item -Path (Join-Path $appRoot "www\*") -Destination $output -Recurse -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "_headers") -Destination (Join-Path $output "_headers") -Force
$currentAssets = Join-Path $appRoot "www\assets"
$staleBundles = Get-ChildItem -Path (Join-Path $output "assets") -Filter "*.js" -File |
  Where-Object {
    $_.Name -match '^(index|web|highlight|katex|markdown)-.+\.js$' -and
    -not (Test-Path (Join-Path $currentAssets $_.Name))
  }
foreach ($bundle in $staleBundles) {
  Remove-Item -LiteralPath $bundle.FullName -Force
}
$legacyAppBundle = Join-Path $output "js\app.js"
if (Test-Path $legacyAppBundle) {
  Remove-Item -LiteralPath $legacyAppBundle -Force
}
Write-Output "Pages build ready: $output"
