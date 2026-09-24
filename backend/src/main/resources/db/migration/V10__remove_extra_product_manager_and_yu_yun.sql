-- Remove the specifically requested employee and the duplicate department-level
-- product manager position. Preserve historical labels before breaking links.
DELETE l FROM audit_log l
JOIN employee e ON l.resource_type = 'emps' AND l.resource_id = e.id
WHERE e.employee_no = '00158' AND e.name = '余韵';

DELETE l FROM employee_change_log l
JOIN employee e ON e.id = l.employee_id
WHERE e.employee_no = '00158' AND e.name = '余韵';

DELETE s FROM employee_sensitive s
JOIN employee e ON e.id = s.employee_id
WHERE e.employee_no = '00158' AND e.name = '余韵';

DELETE FROM employee WHERE employee_no = '00158' AND name = '余韵';

UPDATE employee e
JOIN job_position j ON j.id = e.job_id
SET e.extra = JSON_SET(COALESCE(e.extra, JSON_OBJECT()),
      '$.historicalJobName', j.name, '$.historicalJobCode', j.code),
    e.job_id = NULL,
    e.version = e.version + 1
WHERE j.code = 'J1' AND j.name = '产品经理';

UPDATE recruitment_request r
JOIN job_position j ON j.id = r.job_id
SET r.extra = JSON_SET(COALESCE(r.extra, JSON_OBJECT()),
      '$.historicalJobName', j.name, '$.historicalJobCode', j.code),
    r.job_id = NULL,
    r.status = CASE WHEN r.status IN ('OPEN', 'PAUSED') THEN 'CLOSED' ELSE r.status END,
    r.version = r.version + 1
WHERE j.code = 'J1' AND j.name = '产品经理';

DELETE FROM job_position WHERE code = 'J1' AND name = '产品经理';
