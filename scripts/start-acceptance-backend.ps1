param([string]$Schema = 'hrms_acceptance_20260924')
. "$PSScriptRoot/env.ps1"
Import-HrEnvironment

if ($Schema -notmatch '^hrms_acceptance_[0-9]{8}(_[a-z0-9]+)?$') {
    throw 'Acceptance schema must use hrms_acceptance_YYYYMMDD with an optional suffix.'
}
if (-not $env:TEST_DB_URL -or $env:TEST_DB_URL -notmatch '/hrms_test[?]') {
    throw 'TEST_DB_URL must identify the local isolated hrms_test database.'
}
if (Get-NetTCPConnection -LocalPort 8091 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Port 8091 is already in use.'
}

$env:DB_URL = $env:TEST_DB_URL.Replace('/hrms_test?', "/${Schema}?")
$env:SPRING_PROFILES_ACTIVE = 'dev'
$env:SERVER_ADDRESS = '127.0.0.1'
$env:SERVER_PORT = '8091'
$env:HR_SEED_DEMO = 'true'
$env:HR_UPLOAD_DIRECTORY = "../.local/${Schema}-uploads"
$env:HR_ALLOWED_ORIGINS = 'http://127.0.0.1:5175,http://localhost:5175,http://127.0.0.1:5180'
$classpathFile = Join-Path $ProjectRoot '.local/acceptance-classpath.txt'
if (-not (Test-Path -LiteralPath $classpathFile)) {
    throw 'Run Maven test-compile and dependency:build-classpath first.'
}
$classpath = @(
    (Join-Path $ProjectRoot 'backend/target/test-classes'),
    (Join-Path $ProjectRoot 'backend/target/classes'),
    ([IO.File]::ReadAllText($classpathFile).Trim())
) -join ';'
$log = Join-Path $ProjectRoot ".local/${Schema}-backend.log"
$errorLog = Join-Path $ProjectRoot ".local/${Schema}-backend-error.log"
$process = Start-Process -FilePath (Get-Command java.exe).Source -ArgumentList @('-Dfile.encoding=UTF-8', '-cp', "`"$classpath`"", 'cn.hrplatform.AcceptanceApplication') -WorkingDirectory (Join-Path $ProjectRoot 'backend') -WindowStyle Hidden -PassThru -RedirectStandardOutput $log -RedirectStandardError $errorLog
[IO.File]::WriteAllText((Join-Path $ProjectRoot ".local/${Schema}-backend.pid"), [string]$process.Id)
for ($attempt = 0; $attempt -lt 90; $attempt++) {
    Start-Sleep -Milliseconds 500
    if ($process.HasExited) { throw "Acceptance backend stopped. See $log" }
    try {
        $health = Invoke-RestMethod 'http://127.0.0.1:8091/actuator/health' -TimeoutSec 1
        if ($health.status -eq 'UP') {
            Write-Host "Acceptance backend ready on 127.0.0.1:8091, schema $Schema, PID $($process.Id)"
            return
        }
    } catch { }
}
throw "Acceptance backend did not become healthy. See $log"
