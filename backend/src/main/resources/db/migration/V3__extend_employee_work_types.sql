-- Keep the original enum values and order; append the two options in the final prototype.
ALTER TABLE employee
  MODIFY COLUMN employee_type ENUM('FULL_TIME','PART_TIME','OUTSOURCED','INTERN','LABOR_DISPATCH','OTHER')
  NOT NULL DEFAULT 'FULL_TIME' COMMENT '用工类型：全职、兼职、外包、实习、劳务派遣、其它';
