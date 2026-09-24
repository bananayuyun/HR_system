import { spawn, spawnSync } from 'node:child_process';
import { existsSync, openSync, closeSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const mysql = path.join(root, '.tools/mysql-8.4.11-winx64/bin/mysql.exe');
const client = path.join(root, '.local/test-db-client.cnf');
const jar = path.join(root, 'backend/target/hr-backend-1.0.0.jar');
const pidFile = path.join(root, '.local/test-db-init.pid');
const envFile = path.join(root, '.local/test-deploy.env');
const seed = path.join(root, 'db/data.sql');
const presetsOnly = process.argv.includes('--presets-only');
for (const file of [mysql, client, jar, envFile, seed])
  if (!existsSync(file)) throw new Error(`Missing ${file}`);
const mysqlArgs = [`--defaults-extra-file=${client}`, '--host=192.168.8.85', '--port=3306', '--database=hrms_test', '--default-character-set=utf8mb4', '--batch', '--skip-column-names'];
function sql(statement) {
  const result = spawnSync(mysql, [...mysqlArgs, `--execute=${statement}`], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'MySQL query failed');
  return result.stdout.trim();
}
const existing = sql("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='hrms_test'");
console.log('Existing test database table count:', existing);
if (presetsOnly) {
  if (existing !== '29' || sql('SELECT COUNT(*) FROM flyway_schema_history WHERE success=1') !== '11')
    throw new Error('Preset-only mode requires the complete V1-V11 schema.');
  const loaded = spawnSync(mysql, mysqlArgs, { input: readFileSync(seed), encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  if (loaded.status !== 0) throw new Error(loaded.stderr || 'Preset SQL failed');
  console.log('Preset SQL applied.');
  console.log('Baseline counts:', sql("SELECT 'org',COUNT(*) FROM org_department UNION ALL SELECT 'grade',COUNT(*) FROM grade UNION ALL SELECT 'job',COUNT(*) FROM job_position UNION ALL SELECT 'dictionary',COUNT(*) FROM base_dictionary UNION ALL SELECT 'dictionary_item',COUNT(*) FROM base_dictionary_item UNION ALL SELECT 'role',COUNT(*) FROM sys_role UNION ALL SELECT 'permission',COUNT(*) FROM sys_permission UNION ALL SELECT 'user',COUNT(*) FROM sys_user"));
  process.exit(0);
}
if (existing !== '0') throw new Error('Refusing first-time initialization because target database has tables.');
if (existsSync(pidFile)) throw new Error('Migration PID file already exists.');
const properties = Object.fromEntries(readFileSync(envFile, 'utf8').trim().split(/\r?\n/).map((line) => line.split(/=(.*)/s).slice(0, 2)));
const out = openSync(path.join(root, '.local/test-db-init.log'), 'w');
const err = openSync(path.join(root, '.local/test-db-init-error.log'), 'w');
const backend = spawn('java', ['-Dfile.encoding=UTF-8', '-jar', jar, '--spring.profiles.active=test'], {
  cwd: path.join(root, 'backend'),
  env: {
    ...process.env,
    SPRING_PROFILES_ACTIVE: 'test',
    SERVER_ADDRESS: '127.0.0.1',
    SERVER_PORT: '8092',
    HR_SEED_DEMO: 'false',
    HR_ENCRYPTION_KEY: properties.HR_ENCRYPTION_KEY,
    HR_USER_CENTER_BASE_URL: 'https://test.medianos.com/smart-site-cloud/user',
    HR_UPLOAD_DIRECTORY: path.join(root, '.local/test-remote-uploads'),
  },
  windowsHide: true,
  stdio: ['ignore', out, err],
});
closeSync(out);
closeSync(err);
writeFileSync(pidFile, String(backend.pid));
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (backend.exitCode !== null) throw new Error('Migration backend exited; see .local/test-db-init.log');
    try {
      const response = await fetch('http://127.0.0.1:8092/actuator/health');
      if (response.ok && (await response.json()).status === 'UP') { ready = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('Migration backend was not ready; see .local/test-db-init.log');
  console.log('Flyway completed:', sql('SELECT GROUP_CONCAT(version ORDER BY installed_rank) FROM flyway_schema_history WHERE success=1'));
  console.log('Table count after Flyway:', sql("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='hrms_test'"));
  const loaded = spawnSync(mysql, mysqlArgs, { input: readFileSync(seed), encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  if (loaded.status !== 0) throw new Error(loaded.stderr || 'Preset SQL failed');
  console.log('Preset SQL applied.');
  console.log('Baseline counts:', sql("SELECT 'org',COUNT(*) FROM org_department UNION ALL SELECT 'grade',COUNT(*) FROM grade UNION ALL SELECT 'job',COUNT(*) FROM job_position UNION ALL SELECT 'dictionary',COUNT(*) FROM base_dictionary UNION ALL SELECT 'dictionary_item',COUNT(*) FROM base_dictionary_item UNION ALL SELECT 'role',COUNT(*) FROM sys_role UNION ALL SELECT 'permission',COUNT(*) FROM sys_permission UNION ALL SELECT 'user',COUNT(*) FROM sys_user"));
} finally {
  const pid = Number(readFileSync(pidFile, 'utf8'));
  if (pid === backend.pid && backend.exitCode === null) process.kill(pid, 'SIGTERM');
  unlinkSync(pidFile);
}
