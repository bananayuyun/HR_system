ALTER TABLE org_department ADD COLUMN sort_order INT NOT NULL DEFAULT 0;
UPDATE org_department o JOIN (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY parent_id ORDER BY id) AS position
  FROM org_department
) ranked ON ranked.id=o.id SET o.sort_order=ranked.position;

ALTER TABLE employee ADD COLUMN secondary_org_id BIGINT UNSIGNED NULL,
  ADD KEY idx_employee_secondary_org (secondary_org_id),
  ADD CONSTRAINT fk_employee_secondary_org FOREIGN KEY (secondary_org_id) REFERENCES org_department(id);

ALTER TABLE import_log DROP INDEX uk_import_hash_type,
  ADD INDEX idx_import_hash_type (import_type,file_hash);

UPDATE sys_role SET data_scope='ALL' WHERE code='DEPT_MANAGER';
UPDATE sys_setting SET value_json=JSON_ARRAY('管理 M','技术 T','营销 S','专业 P')
  WHERE setting_key='sequences' AND JSON_LENGTH(value_json)=3
    AND JSON_CONTAINS(value_json,JSON_QUOTE('销售序列 S'));

INSERT INTO grade(code,name,level_no,extra) VALUES
('M4','组长',4,JSON_OBJECT('sequence','管理 M','scope','全部部门')),
('M5','主管',5,JSON_OBJECT('sequence','管理 M','scope','全部部门')),
('M8','部门经理（正/副职）',8,JSON_OBJECT('sequence','管理 M','scope','全部部门')),
('M9','总经理助理/分管高级总监（首席官）',9,JSON_OBJECT('sequence','管理 M','scope','全部部门')),
('M10','副总经理',10,JSON_OBJECT('sequence','管理 M','scope','全部部门')),
('M11','总经理',11,JSON_OBJECT('sequence','管理 M','scope','全部部门')),
('M12','董事长/总裁',12,JSON_OBJECT('sequence','管理 M','scope','全部部门')),
('T1','助理',1,JSON_OBJECT('sequence','技术 T','scope','全部部门')),
('T2','初级开发工程师/初级产品经理/初级设计师/初级项目经理',2,JSON_OBJECT('sequence','技术 T','scope','全部部门')),
('T4','开发工程师/产品经理/中级设计师/项目经理',4,JSON_OBJECT('sequence','技术 T','scope','全部部门')),
('T6','高级开发工程师/系统工程师/架构师/高级产品经理/高级设计师/高级项目经理',6,JSON_OBJECT('sequence','技术 T','scope','全部部门')),
('T8','高级系统工程师/高级架构师/产品总监/主案/项目总监',8,JSON_OBJECT('sequence','技术 T','scope','全部部门')),
('S1','助理',1,JSON_OBJECT('sequence','营销 S','scope','全部部门')),
('S2','初级售前/初级市场/初级销售',2,JSON_OBJECT('sequence','营销 S','scope','全部部门')),
('S4','市场/售前经理/销售经理',4,JSON_OBJECT('sequence','营销 S','scope','全部部门')),
('S6','高级市场/售前经理/高级销售经理',6,JSON_OBJECT('sequence','营销 S','scope','全部部门')),
('S8','市场总监/销售总监',8,JSON_OBJECT('sequence','营销 S','scope','全部部门')),
('P1','助理',1,JSON_OBJECT('sequence','专业 P','scope','全部部门')),
('P2','初级（专业）',2,JSON_OBJECT('sequence','专业 P','scope','全部部门')),
('P3','（专业）专员',3,JSON_OBJECT('sequence','专业 P','scope','全部部门')),
('P4','（专业）主管',4,JSON_OBJECT('sequence','专业 P','scope','全部部门')),
('P6','（专业）经理',6,JSON_OBJECT('sequence','专业 P','scope','全部部门')),
('P8','（专业）总监',8,JSON_OBJECT('sequence','专业 P','scope','全部部门'))
ON DUPLICATE KEY UPDATE name=VALUES(name),level_no=VALUES(level_no),extra=VALUES(extra),
  status='ACTIVE',deleted_at=NULL;

UPDATE employee e JOIN grade old_grade ON old_grade.id=e.grade_id
JOIN grade new_grade ON new_grade.code=CASE old_grade.code
  WHEN 'M1' THEN 'M4' WHEN 'M2' THEN 'M8' WHEN 'M3' THEN 'M8' WHEN 'M4' THEN 'M9'
  WHEN 'S1' THEN 'S2' WHEN 'S2' THEN 'S4'
  WHEN 'T1' THEN 'T2' WHEN 'T2' THEN 'T4' WHEN 'T2-6' THEN 'T2'
  WHEN 'T3' THEN 'T6' WHEN 'T4' THEN 'T8' WHEN 'T5' THEN 'T8'
  WHEN 'T6' THEN 'T8' WHEN 'T7' THEN 'T8'
  ELSE old_grade.code END
SET e.grade_id=new_grade.id
WHERE old_grade.code IN ('M1','M2','M3','M4','S1','S2','T1','T2','T2-6','T3','T4','T5','T6','T7');

UPDATE grade SET status='INACTIVE',deleted_at=UTC_TIMESTAMP()
WHERE code NOT IN ('M4','M5','M8','M9','M10','M11','M12','T1','T2','T4','T6','T8',
  'S1','S2','S4','S6','S8','P1','P2','P3','P4','P6','P8');
