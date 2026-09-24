param(
    [string]$Schema = 'hrms_acceptance_20260924',
    [switch]$Accounts
)
. "$PSScriptRoot/env.ps1"
Import-HrEnvironment

if ($Schema -notmatch '^hrms_acceptance_[0-9]{8}(_[a-z0-9]+)?$') {
    throw 'Acceptance schema must use hrms_acceptance_YYYYMMDD with an optional suffix.'
}
if ($env:TEST_DB_URL -notmatch '^jdbc:mysql://127[.]0[.]0[.]1:3307/hrms_test[?]') {
    throw 'Acceptance preparation requires the local MySQL instance on 127.0.0.1:3307.'
}
$mysql = Join-Path $ProjectRoot '.tools/mysql-8.4.11-winx64/bin/mysql.exe'
if (-not (Test-Path -LiteralPath $mysql)) { throw 'Local MySQL client is missing.' }

if (-not $Accounts) {
    $admin = Join-Path $ProjectRoot '.local/mysql-admin.cnf'
    if (-not (Test-Path -LiteralPath $admin)) { throw 'Local MySQL admin config is missing.' }
    & $mysql "--defaults-extra-file=$admin" --batch --skip-column-names --execute="CREATE DATABASE IF NOT EXISTS $Schema CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci; GRANT ALL PRIVILEGES ON $Schema.* TO 'hr_app'@'127.0.0.1'; SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$Schema';"
    if ($LASTEXITCODE -ne 0) { throw 'Acceptance schema creation failed.' }
    Write-Host "Acceptance schema prepared: $Schema. Start the backend to apply Flyway and demo fixtures."
    return
}

$env:MYSQL_PWD = $env:DB_PASSWORD
$sql = @"
INSERT INTO sys_user(username,display_name,password_hash,org_id)
SELECT 'admin','验收 HR','acceptance-only',NULL
WHERE NOT EXISTS (SELECT 1 FROM sys_user WHERE username='admin');
INSERT INTO sys_user(username,display_name,password_hash,org_id)
SELECT 'manager','验收主管','acceptance-only',id FROM org_department
WHERE code='ORG_18' AND NOT EXISTS (SELECT 1 FROM sys_user WHERE username='manager');
INSERT IGNORE INTO sys_user_role(user_id,role_id)
SELECT u.id,r.id FROM sys_user u JOIN sys_role r
ON (u.username='admin' AND r.code='HR_ADMIN')
OR (u.username='manager' AND r.code='DEPT_MANAGER')
WHERE u.username IN ('admin','manager');
UPDATE sys_user u JOIN employee e ON e.employee_no='E0005'
SET u.employee_id=e.id WHERE u.username='admin';
UPDATE sys_user u JOIN employee e ON e.employee_no='E0002'
SET u.employee_id=e.id WHERE u.username='manager';
SELECT u.username,r.code,r.data_scope,e.employee_no
FROM sys_user u JOIN sys_user_role ur ON ur.user_id=u.id
JOIN sys_role r ON r.id=ur.role_id
LEFT JOIN employee e ON e.id=u.employee_id
WHERE u.username IN ('admin','manager') ORDER BY u.username;
"@
& $mysql --no-defaults --host=127.0.0.1 --port=3307 --user=hr_app "--database=$Schema" --batch --skip-column-names "--execute=$sql"
if ($LASTEXITCODE -ne 0) { throw 'Acceptance account fixtures failed.' }
