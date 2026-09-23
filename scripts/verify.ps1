. "$PSScriptRoot/env.ps1"
Import-HrEnvironment
Push-Location (Join-Path $ProjectRoot 'backend')
try {
    $devUrl = $env:DB_URL
    $env:DB_URL = $env:TEST_DB_URL
    $env:SPRING_PROFILES_ACTIVE = 'dev'
    & mvn.cmd -B verify
    if ($LASTEXITCODE -ne 0) { throw 'Backend verification failed.' }
} finally { $env:DB_URL = $devUrl; $env:SPRING_PROFILES_ACTIVE = 'dev'; Pop-Location }
Push-Location (Join-Path $ProjectRoot 'frontend')
try { Invoke-HrPnpm install --frozen-lockfile; Invoke-HrPnpm build } finally { Pop-Location }
