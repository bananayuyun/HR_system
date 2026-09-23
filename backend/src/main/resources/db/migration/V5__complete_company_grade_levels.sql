-- 2026-03-06《职业发展规划及岗位职级评定附表》“职系发展”中的中间职级。
-- 同一岗位名称可覆盖相邻级别；职级编码仍分别保留，以免把层级误作薪档。
INSERT INTO grade(code,name,level_no,extra) VALUES
('M6','部门经理（正/副职）',6,JSON_OBJECT('sequence','管理 M','scope','全部部门')),
('M7','部门经理（正/副职）',7,JSON_OBJECT('sequence','管理 M','scope','全部部门')),
('T3','开发工程师/产品经理/中级设计师/项目经理',3,JSON_OBJECT('sequence','技术 T','scope','全部部门')),
('T5','高级开发工程师/系统工程师/架构师/高级产品经理/高级设计师/高级项目经理',5,JSON_OBJECT('sequence','技术 T','scope','全部部门')),
('T7','高级系统工程师/高级架构师/产品总监/主案/项目总监',7,JSON_OBJECT('sequence','技术 T','scope','全部部门')),
('S3','市场/售前经理/销售经理',3,JSON_OBJECT('sequence','营销 S','scope','全部部门')),
('S5','高级市场/售前经理/高级销售经理',5,JSON_OBJECT('sequence','营销 S','scope','全部部门')),
('S7','市场总监/销售总监',7,JSON_OBJECT('sequence','营销 S','scope','全部部门')),
('P5','（专业）经理',5,JSON_OBJECT('sequence','专业 P','scope','全部部门')),
('P7','（专业）总监',7,JSON_OBJECT('sequence','专业 P','scope','全部部门'))
ON DUPLICATE KEY UPDATE name=VALUES(name),level_no=VALUES(level_no),extra=VALUES(extra),
  status='ACTIVE',deleted_at=NULL;
