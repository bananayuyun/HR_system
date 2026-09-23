#requires -Version 7.0
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/env.ps1"
Import-HrEnvironment
if ($env:DB_URL -notmatch '/hrms_dev[?]') { throw 'Only the local hrms_dev database may be changed.' }

$source = Get-Content -LiteralPath (Join-Path $ProjectRoot 'backend/src/main/resources/dev/prototype-seed.json') -Raw -Encoding utf8 | ConvertFrom-Json
$mysql = Join-Path $ProjectRoot '.tools/mysql-8.4.11-winx64/bin/mysql.exe'
$config = Join-Path $ProjectRoot '.local/mysql-admin.cnf'
if (-not (Test-Path -LiteralPath $mysql) -or -not (Test-Path -LiteralPath $config)) { throw 'Local MySQL tools or configuration are missing.' }
function Sql([string]$statement) {
    $result = & $mysql "--defaults-extra-file=$config" -h 127.0.0.1 -P 3307 --default-character-set=utf8mb4 -N --execute=$statement hrms_dev
    if ($LASTEXITCODE -ne 0) { throw 'The database rejected the demo retirement statement.' }
    return $result
}
function Codes($items) {
    $codes = @($items | ForEach-Object { [string]$_.id })
    if ($codes.Count -eq 0 -or @($codes | Where-Object { $_ -cnotmatch '^[A-Za-z0-9_-]+$' }).Count -gt 0) { throw 'Unexpected demo identifier.' }
    return '(' + (($codes | ForEach-Object { "'$_'" }) -join ',') + ')'
}
$jobs = Codes $source.jobs
$employees = Codes $source.emps
$requests = Codes $source.reqs
$candidates = Codes $source.candidates
$assets = Codes $source.assets
$already = Sql "SELECT COUNT(*) FROM sys_setting WHERE setting_key='demo_retired'"
if ([int]$already -eq 1) {
    $release = @"
START TRANSACTION;
UPDATE employee SET extra=JSON_SET(COALESCE(extra,JSON_OBJECT()),'$.demoOriginalEmployeeNo',employee_no,'$.demoOriginalPhone',phone),employee_no=CONCAT('DEMO-',employee_no),phone=NULL WHERE employee_no IN $employees AND deleted_at IS NOT NULL;
UPDATE job_position SET extra=JSON_SET(COALESCE(extra,JSON_OBJECT()),'$.demoOriginalCode',code,'$.demoOriginalName',name),code=CONCAT('DEMO-',code),name=CONCAT(name,'（演示留存）') WHERE code IN $jobs AND code<>'JT001' AND deleted_at IS NOT NULL;
COMMIT;
"@
    Sql $release | Out-Null
    Write-Host 'Initial demo records are retired; demo identifiers no longer block future real records.'
    return
}
$checks = @(
    @('job_position', 'code', $jobs, @($source.jobs).Count),
    @('employee', 'employee_no', $employees, @($source.emps).Count),
    @('recruitment_request', 'request_no', $requests, @($source.reqs).Count),
    @('candidate', 'code', $candidates, @($source.candidates).Count),
    @('asset', 'asset_no', $assets, @($source.assets).Count)
)
foreach ($check in $checks) {
    $count = Sql "SELECT COUNT(*) FROM $($check[0]) WHERE $($check[1]) IN $($check[2]) AND deleted_at IS NULL"
    if ([int]$count -ne [int]$check[3]) { throw "Demo $($check[0]) count differs from the initial seed; no records changed." }
}
$real = Sql "SELECT COUNT(*) FROM employee e JOIN job_position j ON j.id=e.job_id JOIN org_department o ON o.id=e.org_id WHERE e.employee_no='00158' AND e.deleted_at IS NULL AND j.code='JT001' AND j.name='产品经理' AND o.code='ORG_27'"
if ([int]$real -ne 1) { throw 'The imported roster employee and verified position must exist first.' }
$demo = Sql "SELECT COUNT(*) FROM sys_setting WHERE setting_key='demo_initialized'"
if ([int]$demo -ne 1) { throw 'This database has no initial demo marker.' }

$statement = @"
START TRANSACTION;
UPDATE sys_user SET employee_id=NULL WHERE employee_id IN (SELECT id FROM employee WHERE employee_no IN $employees);
UPDATE org_department SET manager_employee_id=NULL WHERE manager_employee_id IN (SELECT id FROM employee WHERE employee_no IN $employees);
UPDATE candidate SET deleted_at=NOW() WHERE code IN $candidates AND deleted_at IS NULL;
UPDATE recruitment_request SET deleted_at=NOW() WHERE request_no IN $requests AND deleted_at IS NULL;
UPDATE asset SET deleted_at=NOW() WHERE asset_no IN $assets AND deleted_at IS NULL;
UPDATE employee SET deleted_at=NOW() WHERE employee_no IN $employees AND deleted_at IS NULL;
UPDATE job_position SET deleted_at=NOW() WHERE code IN $jobs AND code<>'JT001' AND deleted_at IS NULL;
UPDATE employee SET extra=JSON_SET(COALESCE(extra,JSON_OBJECT()),'$.demoOriginalEmployeeNo',employee_no,'$.demoOriginalPhone',phone),employee_no=CONCAT('DEMO-',employee_no),phone=NULL WHERE employee_no IN $employees AND deleted_at IS NOT NULL;
UPDATE job_position SET extra=JSON_SET(COALESCE(extra,JSON_OBJECT()),'$.demoOriginalCode',code,'$.demoOriginalName',name),code=CONCAT('DEMO-',code),name=CONCAT(name,'（演示留存）') WHERE code IN $jobs AND code<>'JT001' AND deleted_at IS NOT NULL;
UPDATE job_position SET location=NULL,duties=NULL,requirements=NULL WHERE code='JT001';
INSERT INTO sys_setting(setting_key,value_json) VALUES('demo_retired',JSON_OBJECT('source','initial_prototype_seed','preserved',true));
COMMIT;
"@
Sql $statement | Out-Null
Write-Host "Retired $(@($source.emps).Count) demo employees and $(@($source.jobs).Count - 1) demo jobs; kept the verified roster position and all historical rows."
