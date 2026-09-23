#requires -Version 7.0
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
function Import-HrEnvironment {
    param([string]$Path = (Join-Path $ProjectRoot '.env'))
    if (-not (Test-Path -LiteralPath $Path)) { throw "Missing configuration: $Path. Run scripts/bootstrap-dev.ps1 first." }
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match '^\s*(#|$)') { continue }
        if ($line -match '^([A-Z][A-Z0-9_]*)=(.*)$') {
            [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim().Trim('"').Trim("'"), 'Process')
        }
    }
}
function Get-HrNode {
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw 'Node.js 22+ is required.'
}
function Get-HrPnpm {
    $cmd = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $node = Get-HrNode
    $bundled = Join-Path (Split-Path (Split-Path $node -Parent) -Parent) 'node_modules/pnpm/bin/pnpm.cjs'
    if (Test-Path -LiteralPath $bundled) { return $bundled }
    throw 'pnpm is required (corepack enable; corepack prepare pnpm@11.25.0 --activate).'
}
function Invoke-HrPnpm {
    param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)
    $pnpm = Get-HrPnpm
    if ($pnpm.EndsWith('.cjs')) { & (Get-HrNode) $pnpm @Arguments }
    else { & $pnpm @Arguments }
    if ($LASTEXITCODE -ne 0) { throw "pnpm failed with exit code $LASTEXITCODE" }
}
