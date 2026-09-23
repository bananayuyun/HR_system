param([switch]$Database,[switch]$Test)
. "$PSScriptRoot/env.ps1"
$pidFile = Join-Path $ProjectRoot $(if($Test){'.local/test-backend.pid'}else{'.local/backend.pid'})
if (Test-Path -LiteralPath $pidFile) {
    $processId = [int](Get-Content -LiteralPath $pidFile)
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
    if ($process) {
        $backendTarget = Join-Path $ProjectRoot 'backend/target'
        if ($process.Name -ne 'java.exe' -or -not $process.CommandLine -or $process.CommandLine.IndexOf($backendTarget, [StringComparison]::OrdinalIgnoreCase) -lt 0) { throw 'PID no longer belongs to the HR backend; refusing to stop it.' }
        $ownedProcess = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($ownedProcess) {
            try { Stop-Process -InputObject $ownedProcess -ErrorAction Stop }
            catch {
                if (Get-Process -Id $processId -ErrorAction SilentlyContinue) { throw "Failed to stop HR backend process ${processId}; the PID file was retained. $($_.Exception.Message)" }
            }
            for ($attempt = 0; $attempt -lt 20; $attempt++) {
                if (-not (Get-Process -Id $processId -ErrorAction SilentlyContinue)) { break }
                Start-Sleep -Milliseconds 100
            }
            if (Get-Process -Id $processId -ErrorAction SilentlyContinue) { throw "HR backend process $processId is still running; the PID file was retained." }
        }
    }
    Remove-Item -LiteralPath $pidFile
}
if ($Database) {
    $admin = Join-Path $ProjectRoot '.local/mysql-admin.cnf'
    $client = Join-Path $ProjectRoot '.tools/mysql-8.4.11-winx64/bin/mysqladmin.exe'
    if (-not (Test-Path -LiteralPath $admin)) { throw 'Local MySQL admin configuration not found.' }
    & $client "--defaults-extra-file=$admin" shutdown
    if ($LASTEXITCODE -ne 0) { throw 'MySQL did not shut down.' }
}
Write-Host 'Requested local services stopped. Database files and uploads are preserved.'
