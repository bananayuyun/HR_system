UPDATE job_position
SET extra = JSON_SET(extra, '$.sequence',
  CASE JSON_UNQUOTE(JSON_EXTRACT(extra, '$.sequence'))
    WHEN '管理序列 M' THEN '管理 M'
    WHEN '技术序列 T' THEN '技术 T'
    WHEN '销售序列 S' THEN '营销 S'
  END)
WHERE JSON_UNQUOTE(JSON_EXTRACT(extra, '$.sequence'))
  IN ('管理序列 M', '技术序列 T', '销售序列 S');

UPDATE grade
SET extra = JSON_SET(extra, '$.sequence',
  CASE JSON_UNQUOTE(JSON_EXTRACT(extra, '$.sequence'))
    WHEN '管理序列 M' THEN '管理 M'
    WHEN '技术序列 T' THEN '技术 T'
    WHEN '销售序列 S' THEN '营销 S'
  END)
WHERE JSON_UNQUOTE(JSON_EXTRACT(extra, '$.sequence'))
  IN ('管理序列 M', '技术序列 T', '销售序列 S');
