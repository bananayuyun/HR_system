param([switch]$SkipBuild)
. "$PSScriptRoot/env.ps1"
Import-HrEnvironment
$backend = Join-Path $ProjectRoot 'backend'
Push-Location $backend
try {
    if (-not $SkipBuild) {
        & mvn.cmd -B -DskipTests package
        if ($LASTEXITCODE -ne 0) { throw 'Backend build failed.' }
    }
    $jar = Get-ChildItem -LiteralPath "$backend/target" -Filter '*.jar' | Where-Object { $_.Name -notmatch 'sources|javadoc|original' } | Select-Object -First 1
    if (-not $jar) { throw 'Backend JAR not found; build first.' }
    $existing = Get-NetTCPConnection -LocalPort ([int]$env:SERVER_PORT) -State Listen -ErrorAction SilentlyContinue
    if ($existing) { throw "Port $env:SERVER_PORT is already in use." }
    $java = (Get-Command java.exe).Source
    $process = Start-Process -FilePath $java -ArgumentList @('-Dfile.encoding=UTF-8','-jar', "`"$($jar.FullName)`"") -WorkingDirectory $backend -WindowStyle Hidden -PassThru -RedirectStandardOutput "$ProjectRoot/.local/backend.log" -RedirectStandardError "$ProjectRoot/.local/backend-error.log"
    [IO.File]::WriteAllText("$ProjectRoot/.local/backend.pid", [string]$process.Id)
    for ($attempt=0; $attempt -lt 60; $attempt++) {
        Start-Sleep -Milliseconds 500
        if ($process.HasExited) { throw "Backend stopped. See .local/backend.log and .local/backend-error.log." }
        try { $health = Invoke-RestMethod "http://127.0.0.1:$env:SERVER_PORT/actuator/health" -TimeoutSec 1; if ($health.status -eq 'UP') { Write-Host "Backend ready at http://127.0.0.1:$env:SERVER_PORT"; return } } catch { }
    }
    throw 'Backend did not become healthy within 30 seconds. Check .local/backend.log.'
} finally { Pop-Location }
