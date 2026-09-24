UPDATE sys_setting
SET value_json = JSON_ARRAY('管理 M', '技术 T', '营销 S', '专业 P')
WHERE setting_key = 'sequences'
  AND JSON_LENGTH(value_json) = 3
  AND JSON_CONTAINS(value_json, JSON_QUOTE('管理序列 M'))
  AND JSON_CONTAINS(value_json, JSON_QUOTE('技术序列 T'))
  AND JSON_CONTAINS(value_json, JSON_QUOTE('销售序列 S'));
