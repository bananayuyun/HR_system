param([string]$MySqlVersion = '8.4.11', [int]$Port = 3307)
. "$PSScriptRoot/env.ps1"
$toolsDir = Join-Path $ProjectRoot '.tools'
$localDir = Join-Path $ProjectRoot '.local'
$mysqlRoot = Join-Path $toolsDir "mysql-$MySqlVersion-winx64"
$mysqlData = Join-Path $localDir 'mysql-data'
$mysqlLog = Join-Path $localDir 'mysql-error.log'
New-Item -ItemType Directory -Force -Path $toolsDir,$localDir | Out-Null
if (-not (Test-Path -LiteralPath "$mysqlRoot/bin/mysqld.exe")) {
    $archive = Join-Path $toolsDir "mysql-$MySqlVersion-winx64.zip"
    & curl.exe --fail --location --silent --show-error --output $archive "https://dev.mysql.com/get/Downloads/MySQL-8.4/mysql-$MySqlVersion-winx64.zip"
    if ($LASTEXITCODE -ne 0) { throw 'MySQL download failed.' }
    if ($MySqlVersion -eq '8.4.11' -and (Get-FileHash -LiteralPath $archive -Algorithm MD5).Hash -ne '2e833921898a9a030ea6bfe81bd811bc') { throw 'MySQL archive checksum mismatch.' }
    & tar.exe -xf $archive -C $toolsDir
    if ($LASTEXITCODE -ne 0) { throw 'MySQL extraction failed.' }
}
$configPath = Join-Path $ProjectRoot '.env'
if (-not (Test-Path -LiteralPath $configPath)) {
    if (Test-Path -LiteralPath (Join-Path $mysqlData 'mysql')) { throw 'Existing database detected but .env is missing. Restore the original configuration; do not generate a replacement encryption key.' }
    $dbPassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
    $encryptionKey = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    $lines = @('# Local development only. Never copy this file to production.',
        'SPRING_PROFILES_ACTIVE=dev', "DB_URL=jdbc:mysql://127.0.0.1:${Port}/hrms_dev?useUnicode=true&characterEncoding=UTF-8&serverTimezone=UTC&allowPublicKeyRetrieval=true&useSSL=false",
        'DB_USERNAME=hr_app', "DB_PASSWORD=$dbPassword", "HR_ENCRYPTION_KEY=$encryptionKey", 'HR_SEED_DEMO=true',
        'SERVER_PORT=8090', 'HR_UPLOAD_DIRECTORY=../.local/uploads',
        'HR_ALLOWED_ORIGINS=http://127.0.0.1:5180,http://localhost:5180,http://127.0.0.1:8090,http://localhost:8090',
        "TEST_DB_URL=jdbc:mysql://127.0.0.1:${Port}/hrms_test?useUnicode=true&characterEncoding=UTF-8&serverTimezone=UTC&allowPublicKeyRetrieval=true&useSSL=false")
    [IO.File]::WriteAllLines($configPath, $lines, [Text.UTF8Encoding]::new($false))
}
Import-HrEnvironment
$isNew = -not (Test-Path -LiteralPath (Join-Path $mysqlData 'mysql'))
if ($isNew) {
    New-Item -ItemType Directory -Force -Path $mysqlData | Out-Null
    & "$mysqlRoot/bin/mysqld.exe" --no-defaults --initialize-insecure "--basedir=$mysqlRoot" "--datadir=$mysqlData" --console
    if ($LASTEXITCODE -ne 0) { throw 'MySQL initialization failed.' }
}
$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listening) {
    foreach ($listener in $listening) {
        $existing = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
        if ($existing.ExecutablePath -ne "$mysqlRoot\bin\mysqld.exe" -or $existing.CommandLine -notlike "*$mysqlData*") { throw "Port $Port belongs to another database/process. Choose a different port without changing that process." }
    }
}
if (-not $listening) {
    $mysqlStartArguments = @('--no-defaults', "--basedir=`"$mysqlRoot`"", "--datadir=`"$mysqlData`"", '--bind-address=127.0.0.1', "--port=$Port", '--mysqlx=OFF', '--character-set-server=utf8mb4', '--collation-server=utf8mb4_0900_ai_ci', '--default-time-zone=+00:00', "--log-error=`"$mysqlLog`"")
    $proc = Start-Process -FilePath "$mysqlRoot/bin/mysqld.exe" -ArgumentList $mysqlStartArguments -WindowStyle Hidden -PassThru
    [IO.File]::WriteAllText((Join-Path $localDir 'mysql.pid'), [string]$proc.Id)
    for ($attempt=0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 500
        if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { break }
        if ($proc.HasExited) { throw "MySQL stopped. See $mysqlLog" }
    }
}
if (-not (Test-Path -LiteralPath (Join-Path $localDir 'mysql-admin.cnf'))) {
    $adminPassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    $sql = "CREATE DATABASE IF NOT EXISTS hrms_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci; CREATE DATABASE IF NOT EXISTS hrms_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci; CREATE USER 'hr_app'@'127.0.0.1' IDENTIFIED BY '$env:DB_PASSWORD'; GRANT ALL PRIVILEGES ON hrms_dev.* TO 'hr_app'@'127.0.0.1'; GRANT ALL PRIVILEGES ON hrms_test.* TO 'hr_app'@'127.0.0.1'; ALTER USER 'root'@'localhost' IDENTIFIED BY '$adminPassword';"
    $sql | & "$mysqlRoot/bin/mysql.exe" --no-defaults --host=127.0.0.1 "--port=$Port" --user=root --default-character-set=utf8mb4
    if ($LASTEXITCODE -ne 0) { throw 'MySQL database/user setup failed.' }
    [IO.File]::WriteAllLines((Join-Path $localDir 'mysql-admin.cnf'), @('[client]', 'host=127.0.0.1', "port=$Port", 'user=root', "password=$adminPassword"), [Text.UTF8Encoding]::new($false))
}
Write-Host "Local MySQL available at 127.0.0.1:$Port; schemas hrms_dev and hrms_test. Configuration: .env"
