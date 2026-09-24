-- V7 hid the prototype-only positions. Remove their rows after preserving the
-- labels on historical employees and recruitment requests that still refer to them.
ALTER TABLE recruitment_request
  MODIFY job_id BIGINT UNSIGNED NULL COMMENT '招聘岗位ID；历史岗位删除后为空';

CREATE TEMPORARY TABLE roster_unlisted_jobs AS
SELECT id, code, name
FROM job_position
WHERE (code, name) IN (
  ('J4', '客户经理'),
  ('J5', '人事专员'),
  ('J6', '实施顾问'),
  ('JL007', '技术总监'),
  ('JL008', '研发经理'),
  ('JL009', '架构师'),
  ('JL010', '算法工程师'),
  ('JL011', '后端开发工程师'),
  ('JL012', '前端开发工程师'),
  ('JL014', '运维工程师'),
  ('JL015', '产品总监'),
  ('JL017', '交互设计师'),
  ('JL018', '销售总监'),
  ('JL020', '大客户经理'),
  ('JL021', '销售代表'),
  ('JL022', '销售助理'),
  ('JL023', '市场总监'),
  ('JL024', '品牌经理'),
  ('JL025', '新媒体运营'),
  ('JL026', '市场专员'),
  ('JL027', '运营总监'),
  ('JL028', '用户运营'),
  ('JL029', '内容运营'),
  ('JL030', '客服专员'),
  ('JL031', 'HRD'),
  ('JL032', 'HRBP'),
  ('JL033', '招聘专员'),
  ('JL034', '薪酬绩效专员'),
  ('JL038', '税务专员'),
  ('JL039', '行政经理'),
  ('JL041', '前台'),
  ('JT037', '分摊')
);

UPDATE employee e
JOIN roster_unlisted_jobs j ON j.id = e.job_id
SET e.extra = JSON_SET(COALESCE(e.extra, JSON_OBJECT()),
      '$.historicalJobName', j.name, '$.historicalJobCode', j.code),
    e.job_id = NULL,
    e.version = e.version + 1;

UPDATE recruitment_request r
JOIN roster_unlisted_jobs j ON j.id = r.job_id
SET r.extra = JSON_SET(COALESCE(r.extra, JSON_OBJECT()),
      '$.historicalJobName', j.name, '$.historicalJobCode', j.code),
    r.job_id = NULL,
    r.status = CASE WHEN r.status IN ('OPEN', 'PAUSED') THEN 'CLOSED' ELSE r.status END,
    r.version = r.version + 1;

DELETE j FROM job_position j JOIN roster_unlisted_jobs removed ON removed.id = j.id;
DROP TEMPORARY TABLE roster_unlisted_jobs;
