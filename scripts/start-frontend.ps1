param([switch]$Test)
. "$PSScriptRoot/env.ps1"
$previousPort = $env:VITE_PORT
$previousProxy = $env:VITE_API_PROXY
if ($Test) {
    $env:VITE_PORT = '5175'
    $env:VITE_API_PROXY = 'http://127.0.0.1:8091'
}
Push-Location (Join-Path $ProjectRoot 'frontend')
try {
    if (-not (Test-Path -LiteralPath 'node_modules')) { Invoke-HrPnpm install --frozen-lockfile }
    Invoke-HrPnpm dev --host 127.0.0.1
} finally { $env:VITE_PORT = $previousPort; $env:VITE_API_PROXY = $previousProxy; Pop-Location }
