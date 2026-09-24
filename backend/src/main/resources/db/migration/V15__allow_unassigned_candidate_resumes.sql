ALTER TABLE candidate
  MODIFY COLUMN request_id BIGINT UNSIGNED NULL COMMENT '对应的招聘需求ID；未关联时为空';
