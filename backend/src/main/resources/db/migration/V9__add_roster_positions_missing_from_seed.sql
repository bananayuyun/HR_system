-- The source roster lists 67 distinct 职位 names. Eight named 挂靠/分摊 entries
-- were absent from the position seed. Their roster rows do not identify an
-- organization, so place them under 其他 without changing existing assignments.
-- Keep them inactive with zero headcount until their organization is confirmed.
INSERT INTO job_position (code, name, org_id, headcount, status, extra)
SELECT missing.code, missing.name, other_org.id, 0, 'INACTIVE',
  JSON_OBJECT('source', '原始花名册职位列', 'organizationNote', '原表未标注岗位组织，暂归其他')
FROM (
  SELECT 'JR001' AS code, '江福春挂靠' AS name
  UNION ALL SELECT 'JR002', '吕宝分摊'
  UNION ALL SELECT 'JR003', '吕总挂靠'
  UNION ALL SELECT 'JR004', '沈忠平分摊'
  UNION ALL SELECT 'JR005', '汤龙挂靠'
  UNION ALL SELECT 'JR006', '肖文强挂靠'
  UNION ALL SELECT 'JR007', '徐元吉分摊'
  UNION ALL SELECT 'JR008', '杨曦分摊'
) missing
JOIN org_department other_org ON other_org.code = 'ORG_30'
WHERE NOT EXISTS (SELECT 1 FROM job_position existing WHERE existing.name = missing.name);
