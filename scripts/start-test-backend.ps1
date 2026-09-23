param([switch]$SkipBuild)
. "$PSScriptRoot/env.ps1"
Import-HrEnvironment
if (-not $env:TEST_DB_URL -or $env:TEST_DB_URL -notmatch '/hrms_test[?]') { throw 'TEST_DB_URL must identify the isolated hrms_test database.' }
$env:DB_URL = $env:TEST_DB_URL
$env:SPRING_PROFILES_ACTIVE = 'test'
$env:HR_SEED_DEMO = 'true'
$env:SERVER_PORT = '8091'
$env:HR_UPLOAD_DIRECTORY = '../.local/test-uploads'
$env:HR_ALLOWED_ORIGINS = 'http://127.0.0.1:5180,http://localhost:5180,http://127.0.0.1:5175,http://localhost:5175'
$backend = Join-Path $ProjectRoot 'backend'
Push-Location $backend
try {
    if (-not $SkipBuild) { & mvn.cmd -B -DskipTests package; if ($LASTEXITCODE -ne 0) { throw 'Backend build failed.' } }
    if (Get-NetTCPConnection -LocalPort 8091 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 8091 is already in use.' }
    $jar = Join-Path $backend 'target/hr-backend-1.0.0.jar'
    $process = Start-Process -FilePath (Get-Command java.exe).Source -ArgumentList @('-Dfile.encoding=UTF-8','-jar', "`"$jar`"") -WorkingDirectory $backend -WindowStyle Hidden -PassThru -RedirectStandardOutput "$ProjectRoot/.local/test-backend.log" -RedirectStandardError "$ProjectRoot/.local/test-backend-error.log"
    [IO.File]::WriteAllText("$ProjectRoot/.local/test-backend.pid", [string]$process.Id)
    for ($attempt=0; $attempt -lt 60; $attempt++) {
        Start-Sleep -Milliseconds 500
        if ($process.HasExited) { throw 'Test backend stopped. See .local/test-backend.log.' }
        try { $health = Invoke-RestMethod 'http://127.0.0.1:8091/actuator/health' -TimeoutSec 1; if ($health.status -eq 'UP') { Write-Host 'Isolated test backend ready at http://127.0.0.1:8091'; return } } catch { }
    }
    throw 'Test backend did not become healthy within 30 seconds.'
} finally { Pop-Location }
