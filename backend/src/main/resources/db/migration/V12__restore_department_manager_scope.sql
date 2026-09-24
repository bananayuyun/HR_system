-- V4 broadened this legacy role to ALL. Keep it restricted even though current
-- user-center sessions use the HR administrator view.
UPDATE sys_role
SET data_scope = 'SELF_ORG_TREE'
WHERE code = 'DEPT_MANAGER' AND data_scope <> 'SELF_ORG_TREE';
