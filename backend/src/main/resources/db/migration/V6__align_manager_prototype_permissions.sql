-- Department managers work in recruitment, organization and positions only.
DELETE rp FROM sys_role_permission rp
JOIN sys_role r ON r.id = rp.role_id
JOIN sys_permission p ON p.id = rp.permission_id
WHERE r.code = 'DEPT_MANAGER'
  AND p.code IN ('roster:read', 'grades:read', 'pool:read', 'assets:read');
