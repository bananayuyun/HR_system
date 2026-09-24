import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const mysql = path.join(root, '.tools/mysql-8.4.11-winx64/bin/mysql.exe');
const config = path.join(root, '.local/mysql-admin.cnf');
const target = path.join(root, 'db/data.sql');

function rows(sql) {
  const output = execFileSync(mysql, [
    `--defaults-extra-file=${config}`,
    '--host=127.0.0.1',
    '--port=3307',
    '--database=hrms_dev',
    '--default-character-set=utf8mb4',
    '--batch',
    '--raw',
    '--skip-column-names',
    `--execute=${sql}`,
  ], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  return output.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function literal(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return `'${text.replaceAll('\\', '\\\\').replaceAll("'", "''").replaceAll('\u0000', '\\0').replaceAll('\n', '\\n').replaceAll('\r', '\\r')}'`;
}

const ref = (table, column, value) => value == null
  ? 'NULL'
  : `(SELECT id FROM ${table} WHERE ${column}=${literal(value)})`;
const lines = [
  '-- Baseline preset values copied from the current hrms_dev foundation on 2026-09-23.',
  '-- Run after Flyway V1-V11 on an inspected empty hrms_test database.',
  '-- INSERT IGNORE preserves later edits on repeated execution.',
  'SET NAMES utf8mb4;',
  'START TRANSACTION;',
];
function insert(table, columns, values) {
  lines.push(`INSERT IGNORE INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')});`);
}

const orgs = rows(`SELECT JSON_OBJECT('code',o.code,'name',o.name,'parent',p.code,'location',o.location,'status',o.status,'description',o.description,'extra',o.extra,'sortOrder',o.sort_order) FROM org_department o LEFT JOIN org_department p ON p.id=o.parent_id WHERE o.deleted_at IS NULL ORDER BY o.id`);
const placed = new Set();
while (placed.size < orgs.length) {
  const available = orgs.filter((o) => !placed.has(o.code) && (!o.parent || placed.has(o.parent)));
  if (!available.length) throw new Error('Organization hierarchy has a missing parent or cycle.');
  for (const o of available) {
    lines.push(`SET @hr_parent_id = ${o.parent ? ref('org_department','code',o.parent) : 'NULL'};`);
    insert('org_department', ['code','name','parent_id','location','status','description','extra','sort_order'], [literal(o.code),literal(o.name),'@hr_parent_id',literal(o.location),literal(o.status),literal(o.description),literal(o.extra),literal(o.sortOrder)]);
    placed.add(o.code);
  }
}

const grades = rows(`SELECT JSON_OBJECT('code',code,'name',name,'level',level_no,'sequence',sequence_no,'minYears',min_years,'requirements',requirements,'status',status,'extra',extra) FROM grade WHERE deleted_at IS NULL ORDER BY code`);
for (const g of grades) insert('grade', ['code','name','level_no','sequence_no','min_years','requirements','status','extra'], [literal(g.code),literal(g.name),literal(g.level),literal(g.sequence),literal(g.minYears),literal(g.requirements),literal(g.status),literal(g.extra)]);

const dictionaries = rows(`SELECT JSON_OBJECT('code',dict_code,'name',dict_name,'status',status) FROM base_dictionary ORDER BY dict_code`);
for (const d of dictionaries) insert('base_dictionary', ['dict_code','dict_name','status'], [literal(d.code),literal(d.name),literal(d.status)]);
const items = rows(`SELECT JSON_OBJECT('dict',d.dict_code,'code',i.item_code,'name',i.item_name,'sort',i.sort_no,'status',i.status,'aliases',i.aliases) FROM base_dictionary_item i JOIN base_dictionary d ON d.id=i.dictionary_id ORDER BY d.dict_code,i.sort_no,i.item_code`);
for (const i of items) insert('base_dictionary_item', ['dictionary_id','item_code','item_name','sort_no','status','aliases'], [ref('base_dictionary','dict_code',i.dict),literal(i.code),literal(i.name),literal(i.sort),literal(i.status),literal(i.aliases)]);

const roles = rows(`SELECT JSON_OBJECT('code',code,'name',name,'scope',data_scope) FROM sys_role ORDER BY code`);
if (roles.find((role) => role.code === 'DEPT_MANAGER')?.scope !== 'SELF_ORG_TREE')
  throw new Error('Department manager data scope must be SELF_ORG_TREE before exporting presets.');
for (const r of roles) insert('sys_role', ['code','name','data_scope'], [literal(r.code),literal(r.name),literal(r.scope)]);
const permissions = rows(`SELECT JSON_OBJECT('code',code,'name',name) FROM sys_permission ORDER BY code`);
for (const p of permissions) insert('sys_permission', ['code','name'], [literal(p.code),literal(p.name)]);
const rolePermissions = rows(`SELECT JSON_OBJECT('role',r.code,'permission',p.code) FROM sys_role_permission rp JOIN sys_role r ON r.id=rp.role_id JOIN sys_permission p ON p.id=rp.permission_id ORDER BY r.code,p.code`);
for (const rp of rolePermissions) insert('sys_role_permission', ['role_id','permission_id'], [ref('sys_role','code',rp.role),ref('sys_permission','code',rp.permission)]);

const jobs = rows(`SELECT JSON_OBJECT('code',j.code,'name',j.name,'org',o.code,'sequence',j.sequence_no,'location',j.location,'headcount',j.headcount,'duties',j.duties,'requirements',j.requirements,'status',j.status,'extra',j.extra) FROM job_position j JOIN org_department o ON o.id=j.org_id WHERE j.deleted_at IS NULL ORDER BY j.code`);
for (const j of jobs) insert('job_position', ['code','name','org_id','sequence_no','location','headcount','duties','requirements','status','extra'], [literal(j.code),literal(j.name),ref('org_department','code',j.org),literal(j.sequence),literal(j.location),literal(j.headcount),literal(j.duties),literal(j.requirements),literal(j.status),literal(j.extra)]);

const settings = rows(`SELECT JSON_OBJECT('key',setting_key,'value',value_json) FROM sys_setting WHERE setting_key IN ('rules','sequences') ORDER BY setting_key`);
for (const s of settings) insert('sys_setting', ['setting_key','value_json'], [literal(s.key),literal(s.value)]);

lines.push('COMMIT;', '');
const sql = lines.join('\n');
if (/\b(?:DROP|TRUNCATE)\b|\bDELETE\s+FROM\b/i.test(sql.replace(/^--.*$/gm, ''))) throw new Error('Disallowed destructive statement in preset SQL.');
writeFileSync(target, sql, 'utf8');
console.log(JSON.stringify({ target, orgs: orgs.length, grades: grades.length, dictionaries: dictionaries.length, dictionaryItems: items.length, roles: roles.length, permissions: permissions.length, rolePermissions: rolePermissions.length, jobs: jobs.length, settings: settings.length }));
