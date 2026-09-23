#requires -Version 7.0
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$localDir = Join-Path $projectRoot '.local'
New-Item -ItemType Directory -Path $localDir -Force | Out-Null
$lockPath = Join-Path $localDir 'gitlab-sync.lock'
$lock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
Start-Transcript -Path (Join-Path $localDir 'gitlab-sync.log') -Append | Out-Null
try {
    Push-Location $projectRoot
    try {
        $before = @(git status --porcelain=v1)
        if ($LASTEXITCODE -ne 0) { throw 'Could not read Git status.' }
        if ($before.Count -gt 0) {
            Push-Location (Join-Path $projectRoot 'backend')
            try {
                & mvn.cmd -q test
                if ($LASTEXITCODE -ne 0) { throw 'Backend tests failed; synchronization skipped.' }
            } finally { Pop-Location }

            $node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
            if (-not $node) { $node = Join-Path $projectRoot '.tools/node-v24.21.0-win-x64/node.exe' }
            if (-not (Test-Path -LiteralPath $node)) { throw 'Node.js was not found; synchronization skipped.' }
            Push-Location (Join-Path $projectRoot 'frontend')
            try {
                & $node '.\node_modules\vite\bin\vite.js' build
                if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed; synchronization skipped.' }
            } finally { Pop-Location }

            $after = @(git status --porcelain=v1)
            if ($LASTEXITCODE -ne 0 -or ($before -join "`n") -ne ($after -join "`n")) {
                throw 'Workspace changed during validation; synchronization skipped.'
            }
            git add --all
            if ($LASTEXITCODE -ne 0) { throw 'Could not stage changes.' }
            $staged = @(git diff --cached --name-only)
            if ($LASTEXITCODE -ne 0) { throw 'Could not inspect staged files.' }
            $forbidden = @($staged | Where-Object {
                (($_ -match '(^|/)\.env($|\.)') -and ($_ -notmatch '(^|/)\.env\.(example|development)$')) -or
                $_ -match '(^|/)(\.local/|\.tools/|node_modules/|target/|dist/)' -or
                $_ -match '(?i)(\.pem$|\.key$|id_rsa|credential|secret)'
            })
            if ($forbidden.Count -gt 0) { throw "Sensitive or generated files were staged: $($forbidden -join ', ')" }
            if ($staged.Count -gt 0) {
                $date = Get-Date -Format 'yyyy-MM-dd HH:mm'
                git commit -m "chore: sync local updates $date"
                if ($LASTEXITCODE -ne 0) { throw 'Could not create the Git commit.' }
            }
        }
        git push origin main
        if ($LASTEXITCODE -ne 0) { throw 'GitLab push failed; the local commit is retained for retry.' }
        Write-Host "GitLab synchronization complete: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    } finally { Pop-Location }
} finally {
    Stop-Transcript | Out-Null
    $lock.Dispose()
}
