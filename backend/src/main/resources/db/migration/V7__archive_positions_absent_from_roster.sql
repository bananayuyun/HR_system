-- The original company roster's 职位 column is the position-name reference.
-- Archive only the existing demo position codes with names absent from that roster.
-- Keep their organization and historical employee/recruitment foreign keys intact.
UPDATE job_position
SET deleted_at = UTC_TIMESTAMP(), version = version + 1
WHERE deleted_at IS NULL
  AND (code, name) IN (
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
