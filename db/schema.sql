-- Standalone schema for manual review or independent initialization (MySQL 8.4).
-- Application startup uses Flyway V1-V5; do not initialize the same empty database with both paths.
-- Existing same-name tables are left untouched by CREATE TABLE IF NOT EXISTS; verify their structure before use.

CREATE TABLE IF NOT EXISTS `base_dictionary` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '字典ID',
  `dict_code` varchar(64) NOT NULL COMMENT '字典编码',
  `dict_name` varchar(128) NOT NULL COMMENT '字典名称',
  `status` enum('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE' COMMENT '状态',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_base_dict_code` (`dict_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='基础字典';

CREATE TABLE IF NOT EXISTS `grade` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '职级内部ID',
  `code` varchar(64) NOT NULL COMMENT '职级编码，全系统唯一',
  `name` varchar(128) NOT NULL COMMENT '职级名称',
  `level_no` int NOT NULL COMMENT '职级层级数字',
  `sequence_no` int NOT NULL DEFAULT '0' COMMENT '同层级展示顺序',
  `min_years` decimal(5,2) DEFAULT NULL COMMENT '建议最低工作年限',
  `requirements` varchar(1000) DEFAULT NULL COMMENT '能力、经验及任职要求',
  `status` enum('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE' COMMENT '状态：启用、停用',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
  `extra` json DEFAULT NULL COMMENT '扩展属性',
  `version` int NOT NULL DEFAULT '0' COMMENT '数据版本号',
  `deleted_at` datetime DEFAULT NULL COMMENT '删除时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_grade_code` (`code`),
  CONSTRAINT `ck_grade_level` CHECK ((`level_no` > 0)),
  CONSTRAINT `ck_grade_years` CHECK (((`min_years` is null) or (`min_years` >= 0)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='职级：定义层级、排序和任职要求';

CREATE TABLE IF NOT EXISTS `org_department` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '组织内部ID，自增主键',
  `code` varchar(64) NOT NULL COMMENT '组织编码，全系统唯一',
  `name` varchar(128) NOT NULL COMMENT '组织名称',
  `parent_id` bigint unsigned DEFAULT NULL COMMENT '上级组织ID；为空表示根组织',
  `manager_employee_id` bigint unsigned DEFAULT NULL COMMENT '负责人对应的员工ID',
  `location` varchar(128) DEFAULT NULL COMMENT '主要办公地点',
  `status` enum('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE' COMMENT '状态：启用、停用',
  `description` varchar(500) DEFAULT NULL COMMENT '组织职责说明',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
  `deleted_at` datetime DEFAULT NULL COMMENT '软删除时间；为空表示未删除',
  `extra` json DEFAULT NULL COMMENT '扩展属性',
  `version` int NOT NULL DEFAULT '0' COMMENT '数据版本号',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '同级排序号',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_org_code` (`code`),
  KEY `idx_org_parent_status` (`parent_id`,`status`),
  KEY `fk_org_manager` (`manager_employee_id`),
  CONSTRAINT `fk_org_parent` FOREIGN KEY (`parent_id`) REFERENCES `org_department` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='组织部门：保存公司、部门和组的树形结构';

CREATE TABLE IF NOT EXISTS `sys_permission` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '权限点ID',
  `code` varchar(80) NOT NULL COMMENT '业务编码',
  `name` varchar(160) NOT NULL COMMENT '名称',
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='系统权限点';

CREATE TABLE IF NOT EXISTS `sys_role` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '角色ID',
  `code` varchar(64) NOT NULL COMMENT '角色编码',
  `name` varchar(128) NOT NULL COMMENT '角色名称',
  `data_scope` enum('ALL','SELF_ORG_TREE','SELF_ORG') NOT NULL DEFAULT 'SELF_ORG' COMMENT '数据范围：全部、本组织及下级、仅本组织',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_role_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='系统角色：定义用户身份和默认数据范围';

CREATE TABLE IF NOT EXISTS `sys_setting` (
  `setting_key` varchar(64) NOT NULL COMMENT '设置编码',
  `value_json` json NOT NULL COMMENT '设置内容',
  `version` int NOT NULL DEFAULT '0' COMMENT '设置版本号',
  PRIMARY KEY (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='系统设置';

CREATE TABLE IF NOT EXISTS `base_dictionary_item` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '字典项ID',
  `dictionary_id` bigint unsigned NOT NULL COMMENT '所属字典ID',
  `item_code` varchar(64) NOT NULL COMMENT '字典项编码',
  `item_name` varchar(128) NOT NULL COMMENT '字典项名称',
  `sort_no` int NOT NULL DEFAULT '0' COMMENT '排序号',
  `status` enum('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE' COMMENT '状态',
  `aliases` json DEFAULT NULL COMMENT '别名列表',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_dict_item_code` (`dictionary_id`,`item_code`),
  UNIQUE KEY `uk_dict_item_name` (`dictionary_id`,`item_name`),
  CONSTRAINT `fk_dict_item_dictionary` FOREIGN KEY (`dictionary_id`) REFERENCES `base_dictionary` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='基础字典项';

CREATE TABLE IF NOT EXISTS `job_position` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '岗位内部ID',
  `code` varchar(64) NOT NULL COMMENT '岗位编码，全系统唯一',
  `name` varchar(128) NOT NULL COMMENT '岗位名称',
  `org_id` bigint unsigned NOT NULL COMMENT '岗位所属组织ID',
  `sequence_no` int NOT NULL DEFAULT '0' COMMENT '岗位展示顺序',
  `location` varchar(128) DEFAULT NULL COMMENT '默认办公地点',
  `headcount` int NOT NULL DEFAULT '0' COMMENT '岗位核定编制人数',
  `duties` text COMMENT '岗位职责',
  `requirements` text COMMENT '任职要求',
  `status` enum('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE' COMMENT '状态：启用、停用',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
  `extra` json DEFAULT NULL COMMENT '扩展属性',
  `version` int NOT NULL DEFAULT '0' COMMENT '数据版本号',
  `deleted_at` datetime DEFAULT NULL COMMENT '删除时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_job_code` (`code`),
  UNIQUE KEY `uk_job_org_name` (`org_id`,`name`),
  KEY `idx_job_org_status` (`org_id`,`status`),
  CONSTRAINT `fk_job_org` FOREIGN KEY (`org_id`) REFERENCES `org_department` (`id`),
  CONSTRAINT `ck_job_headcount` CHECK ((`headcount` >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='岗位：保存归属、编制、职责和任职要求';

CREATE TABLE IF NOT EXISTS `sys_role_permission` (
  `role_id` bigint unsigned NOT NULL COMMENT '角色ID',
  `permission_id` bigint unsigned NOT NULL COMMENT '权限点ID',
  PRIMARY KEY (`role_id`,`permission_id`),
  KEY `fk_rp_permission` (`permission_id`),
  CONSTRAINT `fk_rp_permission` FOREIGN KEY (`permission_id`) REFERENCES `sys_permission` (`id`),
  CONSTRAINT `fk_rp_role` FOREIGN KEY (`role_id`) REFERENCES `sys_role` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='角色权限关联';

CREATE TABLE IF NOT EXISTS `employee` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '员工内部ID',
  `employee_no` varchar(64) NOT NULL COMMENT '工号，全系统唯一',
  `name` varchar(100) NOT NULL COMMENT '员工姓名',
  `phone` varchar(32) DEFAULT NULL COMMENT '手机号码；非空时不可重复',
  `email` varchar(160) DEFAULT NULL COMMENT '电子邮箱',
  `org_id` bigint unsigned NOT NULL COMMENT '当前直属组织ID',
  `main_org_id` bigint unsigned DEFAULT NULL COMMENT '所属一级组织或主部门ID',
  `job_id` bigint unsigned DEFAULT NULL COMMENT '当前岗位ID',
  `grade_id` bigint unsigned DEFAULT NULL COMMENT '当前职级ID',
  `supervisor_id` bigint unsigned DEFAULT NULL COMMENT '直属上级员工ID',
  `company` varchar(128) DEFAULT NULL COMMENT '劳动合同归属公司',
  `location` varchar(128) DEFAULT NULL COMMENT '工作片区或办公区域',
  `workplace` varchar(128) DEFAULT NULL COMMENT '具体工作所在地',
  `office` varchar(128) DEFAULT NULL COMMENT '办公室或办事处',
  `archive_number` varchar(128) DEFAULT NULL COMMENT '人事档案编号',
  `employee_type` enum('FULL_TIME','PART_TIME','OUTSOURCED','INTERN','LABOR_DISPATCH','OTHER') NOT NULL DEFAULT 'FULL_TIME' COMMENT '用工类型：全职、兼职、外包、实习、劳务派遣、其它',
  `status` enum('PRE_ONBOARD','PROBATION','ACTIVE','PENDING_LEAVE','LEFT') NOT NULL DEFAULT 'PRE_ONBOARD' COMMENT '人员状态：待入职、试用、在职、待离职、已离职',
  `entry_date` date DEFAULT NULL COMMENT '入职日期',
  `leave_date` date DEFAULT NULL COMMENT '离职日期；未离职时为空',
  `probation_months` decimal(4,1) DEFAULT NULL COMMENT '试用期月数；无试用期或未填写时为空',
  `regular_date` date DEFAULT NULL COMMENT '转正日期',
  `contract_start` date DEFAULT NULL COMMENT '合同开始日期',
  `contract_end` date DEFAULT NULL COMMENT '合同结束日期',
  `contract_type` varchar(64) DEFAULT NULL COMMENT '合同类型',
  `contract_term` varchar(64) DEFAULT NULL COMMENT '合同期限',
  `first_contract_start` date DEFAULT NULL COMMENT '首次合同开始日期',
  `first_contract_end` date DEFAULT NULL COMMENT '首次合同结束日期',
  `gender` varchar(16) DEFAULT NULL COMMENT '性别',
  `ethnicity` varchar(64) DEFAULT NULL COMMENT '民族',
  `marital_status` varchar(32) DEFAULT NULL COMMENT '婚姻状况',
  `political_status` varchar(64) DEFAULT NULL COMMENT '政治面貌',
  `constellation` varchar(32) DEFAULT NULL COMMENT '星座；可由出生日期计算，也允许为空',
  `education` varchar(64) DEFAULT NULL COMMENT '学历',
  `school` varchar(200) DEFAULT NULL COMMENT '毕业院校',
  `major` varchar(200) DEFAULT NULL COMMENT '所学专业',
  `graduated_date` date DEFAULT NULL COMMENT '毕业时间',
  `social_status` varchar(128) DEFAULT NULL COMMENT '社保情况',
  `fund_status` varchar(128) DEFAULT NULL COMMENT '公积金情况',
  `insurance_notes` varchar(1000) DEFAULT NULL COMMENT '五险一金明细备注',
  `bank_name` varchar(128) DEFAULT NULL COMMENT '开户行',
  `title_level` varchar(64) DEFAULT NULL COMMENT '职称级别',
  `title_specialty` varchar(128) DEFAULT NULL COMMENT '职称专业',
  `remark` varchar(1000) DEFAULT NULL COMMENT '员工备注',
  `wechat` varchar(128) DEFAULT NULL COMMENT '微信号',
  `verification` enum('UNVERIFIED','VERIFIED') NOT NULL DEFAULT 'UNVERIFIED' COMMENT '资料核验状态：未核验、已核验',
  `version` int unsigned NOT NULL DEFAULT '0' COMMENT '乐观锁版本号，防止多人编辑互相覆盖',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
  `deleted_at` datetime DEFAULT NULL COMMENT '软删除时间；为空表示未删除',
  `extra` json DEFAULT NULL COMMENT '扩展属性',
  `secondary_org_id` bigint unsigned DEFAULT NULL COMMENT '兼任组织ID',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_employee_no` (`employee_no`),
  UNIQUE KEY `uk_employee_phone` (`phone`),
  KEY `idx_employee_org_status` (`org_id`,`status`),
  KEY `idx_employee_job` (`job_id`),
  KEY `idx_employee_supervisor` (`supervisor_id`),
  KEY `fk_employee_main_org` (`main_org_id`),
  KEY `fk_employee_grade` (`grade_id`),
  KEY `idx_employee_secondary_org` (`secondary_org_id`),
  CONSTRAINT `fk_employee_grade` FOREIGN KEY (`grade_id`) REFERENCES `grade` (`id`),
  CONSTRAINT `fk_employee_job` FOREIGN KEY (`job_id`) REFERENCES `job_position` (`id`),
  CONSTRAINT `fk_employee_main_org` FOREIGN KEY (`main_org_id`) REFERENCES `org_department` (`id`),
  CONSTRAINT `fk_employee_org` FOREIGN KEY (`org_id`) REFERENCES `org_department` (`id`),
  CONSTRAINT `fk_employee_secondary_org` FOREIGN KEY (`secondary_org_id`) REFERENCES `org_department` (`id`),
  CONSTRAINT `fk_employee_supervisor` FOREIGN KEY (`supervisor_id`) REFERENCES `employee` (`id`),
  CONSTRAINT `ck_employee_contract` CHECK (((`contract_end` is null) or (`contract_start` is null) or (`contract_end` >= `contract_start`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='员工主档案：保存花名册、任职和合同基础信息';

CREATE TABLE IF NOT EXISTS `asset` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '资产内部ID',
  `asset_no` varchar(64) NOT NULL COMMENT '资产编码',
  `name` varchar(200) NOT NULL COMMENT '资产名称',
  `category` varchar(64) NOT NULL COMMENT '资产类别',
  `model` varchar(128) DEFAULT NULL COMMENT '规格型号',
  `location` varchar(128) DEFAULT NULL COMMENT '办公地点',
  `office` varchar(128) DEFAULT NULL COMMENT '具体存放位置',
  `public_asset` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否公共资产：1是，0否',
  `owner_employee_id` bigint unsigned DEFAULT NULL COMMENT '当前使用人ID',
  `status` enum('IDLE','IN_USE','REPAIRING','SCRAPPED') NOT NULL DEFAULT 'IDLE' COMMENT '状态：闲置、使用中、维修中、已报废',
  `purchased_date` date DEFAULT NULL COMMENT '购置日期',
  `value` decimal(12,2) DEFAULT NULL COMMENT '购置金额或资产价值',
  `supplier` varchar(200) DEFAULT NULL COMMENT '供应商',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
  `extra` json DEFAULT NULL COMMENT '扩展属性',
  `version` int NOT NULL DEFAULT '0' COMMENT '数据版本号',
  `deleted_at` datetime DEFAULT NULL COMMENT '删除时间',
  `org_id` bigint unsigned DEFAULT NULL COMMENT '资产所属组织ID',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_asset_no` (`asset_no`),
  KEY `idx_asset_owner_status` (`owner_employee_id`,`status`),
  KEY `fk_asset_org` (`org_id`),
  CONSTRAINT `fk_asset_org` FOREIGN KEY (`org_id`) REFERENCES `org_department` (`id`),
  CONSTRAINT `fk_asset_owner` FOREIGN KEY (`owner_employee_id`) REFERENCES `employee` (`id`),
  CONSTRAINT `ck_asset_owner` CHECK ((((`status` = _utf8mb4'IN_USE') and ((`owner_employee_id` is not null) or (`public_asset` = true))) or (`status` <> _utf8mb4'IN_USE'))),
  CONSTRAINT `ck_asset_public_owner` CHECK (((`public_asset` = false) or (`owner_employee_id` is null))),
  CONSTRAINT `ck_asset_value` CHECK (((`value` is null) or (`value` >= 0)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='资产台账：保存资产当前状态、位置和使用人';

CREATE TABLE IF NOT EXISTS `employee_change_log` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '变更记录ID',
  `employee_id` bigint unsigned NOT NULL COMMENT '发生变更的员工ID',
  `change_type` varchar(64) NOT NULL COMMENT '变更类型，如TRANSFER、PROMOTION、LEAVE',
  `before_json` json DEFAULT NULL COMMENT '变更前的数据快照',
  `after_json` json DEFAULT NULL COMMENT '变更后的数据快照',
  `operator_user_id` bigint unsigned DEFAULT NULL COMMENT '操作人用户ID；当前未设置外键',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '变更时间',
  `deleted_at` datetime DEFAULT NULL COMMENT '删除时间',
  PRIMARY KEY (`id`),
  KEY `idx_change_employee_time` (`employee_id`,`created_at`),
  CONSTRAINT `fk_change_employee` FOREIGN KEY (`employee_id`) REFERENCES `employee` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='员工变更记录：保存人事异动前后的数据';

CREATE TABLE IF NOT EXISTS `employee_file` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '文件记录ID',
  `employee_id` bigint unsigned NOT NULL COMMENT '文件所属员工ID',
  `file_type` varchar(64) NOT NULL COMMENT '材料类型，如合同、学历证明',
  `object_key` varchar(512) NOT NULL COMMENT '文件在对象存储中的唯一键或路径',
  `file_name` varchar(255) NOT NULL COMMENT '上传时的原始文件名',
  `status` enum('ACTIVE','DELETED') NOT NULL DEFAULT 'ACTIVE' COMMENT '文件状态：有效、已删除',
  `uploaded_by` bigint unsigned DEFAULT NULL COMMENT '上传人的系统用户ID；当前未设置外键',
  `uploaded_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '上传时间',
  `size_bytes` bigint NOT NULL DEFAULT '0' COMMENT '文件字节数',
  `mime_type` varchar(128) DEFAULT NULL COMMENT '文件媒体类型',
  PRIMARY KEY (`id`),
  KEY `idx_file_employee_type` (`employee_id`,`file_type`),
  CONSTRAINT `fk_file_employee` FOREIGN KEY (`employee_id`) REFERENCES `employee` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='员工材料元数据：记录附件名称、类型和存储位置';

CREATE TABLE IF NOT EXISTS `employee_sensitive` (
  `employee_id` bigint unsigned NOT NULL COMMENT '员工ID，同时作为本表主键',
  `id_name` varchar(100) DEFAULT NULL COMMENT '证件姓名',
  `id_no_cipher` varbinary(512) DEFAULT NULL COMMENT '加密后的身份证件号码',
  `id_expire` date DEFAULT NULL COMMENT '证件有效期截止日',
  `birthday` date DEFAULT NULL COMMENT '出生日期',
  `native_place_cipher` varbinary(512) DEFAULT NULL COMMENT '加密后的籍贯',
  `household_type` varchar(64) DEFAULT NULL COMMENT '户籍类型',
  `household_location_cipher` varbinary(512) DEFAULT NULL COMMENT '加密后的户口所在地',
  `bank_account_cipher` varbinary(512) DEFAULT NULL COMMENT '加密后的银行卡号',
  `social_security_no_cipher` varbinary(512) DEFAULT NULL COMMENT '加密后的社保号码',
  `housing_fund_no_cipher` varbinary(512) DEFAULT NULL COMMENT '加密后的公积金账号',
  `social_city` varchar(128) DEFAULT NULL COMMENT '社保缴纳城市',
  `social_account_cipher` varbinary(512) DEFAULT NULL COMMENT '加密后的社保账户信息',
  `address_cipher` varbinary(1024) DEFAULT NULL COMMENT '加密后的现居住地址',
  `emergency_contact_cipher` varbinary(1024) DEFAULT NULL COMMENT '加密后的紧急联系人及联系方式',
  `emergency_relation` varchar(32) DEFAULT NULL COMMENT '紧急联系人关系',
  `first_work_date` date DEFAULT NULL COMMENT '首次参加工作日期',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
  `extra_cipher` blob COMMENT '加密后的扩展敏感资料',
  PRIMARY KEY (`employee_id`),
  CONSTRAINT `fk_sensitive_employee` FOREIGN KEY (`employee_id`) REFERENCES `employee` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='员工敏感档案：保存需加密和严格授权的信息';

CREATE TABLE IF NOT EXISTS `employee_work_history` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '工作经历ID',
  `employee_id` bigint unsigned NOT NULL COMMENT '员工ID',
  `company` varchar(200) NOT NULL COMMENT '任职公司名称',
  `start_date` date DEFAULT NULL COMMENT '任职开始日期',
  `end_date` date DEFAULT NULL COMMENT '任职结束日期',
  `leave_reason` varchar(500) DEFAULT NULL COMMENT '离职原因',
  `sort_no` int NOT NULL DEFAULT '0' COMMENT '排序号',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_work_history_employee` (`employee_id`,`sort_no`),
  CONSTRAINT `fk_work_history_employee` FOREIGN KEY (`employee_id`) REFERENCES `employee` (`id`),
  CONSTRAINT `ck_work_history_date` CHECK (((`end_date` is null) or (`start_date` is null) or (`end_date` >= `start_date`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='员工工作经历';

CREATE TABLE IF NOT EXISTS `recruitment_request` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '招聘需求内部ID',
  `request_no` varchar(64) NOT NULL COMMENT '需求编号，全系统唯一',
  `name` varchar(200) NOT NULL COMMENT '招聘需求名称',
  `job_id` bigint unsigned DEFAULT NULL COMMENT '招聘岗位ID；历史岗位删除后为空',
  `org_id` bigint unsigned NOT NULL COMMENT '需求组织ID',
  `location` varchar(128) NOT NULL COMMENT '工作地点或片区',
  `company` varchar(128) DEFAULT NULL COMMENT '录用后的合同归属公司',
  `headcount` int NOT NULL COMMENT '计划招聘人数',
  `salary_min` decimal(12,2) DEFAULT NULL COMMENT '薪资下限',
  `salary_max` decimal(12,2) DEFAULT NULL COMMENT '薪资上限',
  `recruit_type` enum('NEW','REPLACEMENT') NOT NULL COMMENT '类型：新增编制、人员替补',
  `deadline` date DEFAULT NULL COMMENT '期望到岗或招聘截止日期',
  `owner_employee_id` bigint unsigned NOT NULL COMMENT 'HR负责人ID',
  `screener_employee_id` bigint unsigned DEFAULT NULL COMMENT '部门筛选负责人ID',
  `first_interviewer_id` bigint unsigned DEFAULT NULL COMMENT '默认初试面试官ID',
  `second_interviewer_id` bigint unsigned DEFAULT NULL COMMENT '默认复试面试官ID',
  `status` enum('OPEN','PAUSED','COMPLETED','CLOSED') NOT NULL DEFAULT 'OPEN' COMMENT '状态：招聘中、暂停、完成、关闭',
  `version` int unsigned NOT NULL DEFAULT '0' COMMENT '乐观锁版本号',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
  `extra` json DEFAULT NULL COMMENT '扩展属性',
  `deleted_at` datetime DEFAULT NULL COMMENT '删除时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_request_no` (`request_no`),
  KEY `idx_request_org_status` (`org_id`,`status`),
  KEY `fk_request_job` (`job_id`),
  KEY `fk_request_owner` (`owner_employee_id`),
  KEY `fk_request_screener` (`screener_employee_id`),
  KEY `fk_request_first_interviewer` (`first_interviewer_id`),
  KEY `fk_request_second_interviewer` (`second_interviewer_id`),
  CONSTRAINT `fk_request_first_interviewer` FOREIGN KEY (`first_interviewer_id`) REFERENCES `employee` (`id`),
  CONSTRAINT `fk_request_job` FOREIGN KEY (`job_id`) REFERENCES `job_position` (`id`),
  CONSTRAINT `fk_request_org` FOREIGN KEY (`org_id`) REFERENCES `org_department` (`id`),
  CONSTRAINT `fk_request_owner` FOREIGN KEY (`owner_employee_id`) REFERENCES `employee` (`id`),
  CONSTRAINT `fk_request_screener` FOREIGN KEY (`screener_employee_id`) REFERENCES `employee` (`id`),
  CONSTRAINT `fk_request_second_interviewer` FOREIGN KEY (`second_interviewer_id`) REFERENCES `employee` (`id`),
  CONSTRAINT `ck_request_headcount` CHECK ((`headcount` > 0)),
  CONSTRAINT `ck_request_salary` CHECK (((`salary_min` is null) or (`salary_max` is null) or (`salary_min` <= `salary_max`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='招聘需求：记录岗位、人数、负责人和状态';

CREATE TABLE IF NOT EXISTS `sys_user` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '系统用户ID',
  `username` varchar(64) NOT NULL COMMENT '登录用户名',
  `password_hash` varchar(255) NOT NULL COMMENT '密码哈希值，严禁保存明文密码',
  `employee_id` bigint unsigned DEFAULT NULL COMMENT '绑定的员工ID',
  `status` enum('ACTIVE','LOCKED','DISABLED') NOT NULL DEFAULT 'ACTIVE' COMMENT '账号状态：正常、锁定、停用',
  `last_login_at` datetime DEFAULT NULL COMMENT '最近成功登录时间',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `display_name` varchar(100) DEFAULT NULL COMMENT '账号显示名称',
  `org_id` bigint unsigned DEFAULT NULL COMMENT '所属组织ID',
  `password_changed_at` datetime DEFAULT NULL COMMENT '密码修改时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_name` (`username`),
  UNIQUE KEY `uk_user_employee` (`employee_id`),
  KEY `fk_user_org` (`org_id`),
  CONSTRAINT `fk_user_employee` FOREIGN KEY (`employee_id`) REFERENCES `employee` (`id`),
  CONSTRAINT `fk_user_org` FOREIGN KEY (`org_id`) REFERENCES `org_department` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='系统用户：用于登录并关联员工身份';

CREATE TABLE IF NOT EXISTS `asset_history` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '资产履历ID',
  `asset_id` bigint unsigned NOT NULL COMMENT '资产ID',
  `action` enum('ASSIGN','RETURN','TRANSFER','REPAIR_START','REPAIR_END','SCRAP','LOCATION_CHANGE') NOT NULL COMMENT '操作：领用、归还、转移、开始/结束维修、报废、位置变化',
  `from_owner_employee_id` bigint unsigned DEFAULT NULL COMMENT '变更前使用人',
  `to_owner_employee_id` bigint unsigned DEFAULT NULL COMMENT '变更后使用人',
  `from_status` varchar(32) DEFAULT NULL COMMENT '变更前状态',
  `to_status` varchar(32) DEFAULT NULL COMMENT '变更后状态',
  `reason` varchar(500) DEFAULT NULL COMMENT '原因或备注',
  `operator_user_id` bigint unsigned DEFAULT NULL COMMENT '操作人用户ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',
  PRIMARY KEY (`id`),
  KEY `idx_asset_history` (`asset_id`,`created_at`),
  KEY `fk_ah_from_owner` (`from_owner_employee_id`),
  KEY `fk_ah_to_owner` (`to_owner_employee_id`),
  KEY `fk_ah_operator` (`operator_user_id`),
  CONSTRAINT `fk_ah_asset` FOREIGN KEY (`asset_id`) REFERENCES `asset` (`id`),
  CONSTRAINT `fk_ah_from_owner` FOREIGN KEY (`from_owner_employee_id`) REFERENCES `employee` (`id`),
  CONSTRAINT `fk_ah_operator` FOREIGN KEY (`operator_user_id`) REFERENCES `sys_user` (`id`),
  CONSTRAINT `fk_ah_to_owner` FOREIGN KEY (`to_owner_employee_id`) REFERENCES `employee` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='资产履历：记录资产从领用到报废的完整变化';

CREATE TABLE IF NOT EXISTS `audit_log` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '审计日志ID',
  `actor_user_id` bigint unsigned DEFAULT NULL COMMENT '操作人用户ID',
  `actor_role` varchar(128) DEFAULT NULL COMMENT '操作时的角色快照',
  `action` varchar(64) NOT NULL COMMENT '操作类型，如CREATE、UPDATE、DELETE、EXPORT',
  `resource_type` varchar(64) NOT NULL COMMENT '资源类型，如EMPLOYEE、ASSET',
  `resource_id` bigint unsigned DEFAULT NULL COMMENT '业务记录ID',
  `before_json` json DEFAULT NULL COMMENT '操作前数据快照',
  `after_json` json DEFAULT NULL COMMENT '操作后数据快照',
  `ip` varchar(64) DEFAULT NULL COMMENT '客户端IP，兼容IPv4和IPv6',
  `request_id` varchar(64) DEFAULT NULL COMMENT '请求链路ID，用于关联接口日志',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',
  PRIMARY KEY (`id`),
  KEY `idx_audit_resource` (`resource_type`,`resource_id`,`created_at`),
  KEY `idx_audit_actor_time` (`actor_user_id`,`created_at`),
  CONSTRAINT `fk_audit_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `sys_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='全局审计日志：追踪关键数据操作';

CREATE TABLE IF NOT EXISTS `candidate` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '候选人内部ID',
  `request_id` bigint unsigned NOT NULL COMMENT '对应的招聘需求ID',
  `name` varchar(100) NOT NULL COMMENT '候选人姓名',
  `phone` varchar(32) DEFAULT NULL COMMENT '手机号',
  `email` varchar(160) DEFAULT NULL COMMENT '电子邮箱',
  `source` varchar(64) DEFAULT NULL COMMENT '简历来源，如内推、招聘网站',
  `stage` enum('HR_SCREEN','DEPT_SCREEN','FIRST_INTERVIEW','SECOND_INTERVIEW','ONBOARDING','HIRED','REJECTED','CANCELLED') NOT NULL DEFAULT 'HR_SCREEN' COMMENT '当前阶段：HR筛选、部门筛选、初试、复试、待入职、已入职、淘汰、取消',
  `education` varchar(128) DEFAULT NULL COMMENT '最高学历',
  `years` decimal(5,2) DEFAULT NULL COMMENT '工作年限',
  `resume_key` varchar(512) DEFAULT NULL COMMENT '原始简历的对象存储键或路径',
  `reject_reason` varchar(500) DEFAULT NULL COMMENT '淘汰或取消原因',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
  `code` varchar(64) DEFAULT NULL COMMENT '业务编码',
  `extra` json DEFAULT NULL COMMENT '扩展属性',
  `version` int NOT NULL DEFAULT '0' COMMENT '数据版本号',
  `deleted_at` datetime DEFAULT NULL COMMENT '删除时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_candidate_code` (`code`),
  KEY `idx_candidate_request_stage` (`request_id`,`stage`),
  KEY `idx_candidate_phone` (`phone`),
  CONSTRAINT `fk_candidate_request` FOREIGN KEY (`request_id`) REFERENCES `recruitment_request` (`id`),
  CONSTRAINT `ck_candidate_years` CHECK (((`years` is null) or (`years` >= 0)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='候选人：保存简历信息和当前招聘阶段';

CREATE TABLE IF NOT EXISTS `import_log` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '导入批次ID',
  `import_type` enum('EMPLOYEE','ASSET','REQUEST','GRADE','TIMELINE') NOT NULL COMMENT '导入业务类型',
  `file_name` varchar(255) NOT NULL COMMENT '导入文件名',
  `file_hash` char(64) NOT NULL COMMENT 'SHA-256文件哈希，用于防止重复导入',
  `total_count` int NOT NULL DEFAULT '0' COMMENT '总条数',
  `added_count` int NOT NULL DEFAULT '0' COMMENT '新增数',
  `updated_count` int NOT NULL DEFAULT '0' COMMENT '更新数',
  `skipped_count` int NOT NULL DEFAULT '0' COMMENT '跳过数',
  `error_count` int NOT NULL DEFAULT '0' COMMENT '错误数',
  `status` enum('PARSING','PENDING','RUNNING','SUCCESS','PARTIAL_SUCCESS','FAILED') NOT NULL COMMENT '状态：解析中、待执行、执行中、成功、部分成功、失败',
  `error_detail` json DEFAULT NULL COMMENT '逐行错误、警告和校验详情',
  `operator_user_id` bigint unsigned DEFAULT NULL COMMENT '发起导入的用户ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '批次创建时间',
  PRIMARY KEY (`id`),
  KEY `fk_import_operator` (`operator_user_id`),
  KEY `idx_import_hash_type` (`import_type`,`file_hash`),
  CONSTRAINT `fk_import_operator` FOREIGN KEY (`operator_user_id`) REFERENCES `sys_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='导入批次：记录批量导入进度、结果和错误';

CREATE TABLE IF NOT EXISTS `request_participant` (
  `request_id` bigint unsigned NOT NULL COMMENT '招聘需求ID',
  `employee_id` bigint unsigned NOT NULL COMMENT '员工ID',
  `participant_role` enum('OWNER','SCREENER','FIRST','SECOND') NOT NULL COMMENT '招聘参与身份',
  PRIMARY KEY (`request_id`,`employee_id`,`participant_role`),
  KEY `fk_rpart_employee` (`employee_id`),
  CONSTRAINT `fk_rpart_employee` FOREIGN KEY (`employee_id`) REFERENCES `employee` (`id`),
  CONSTRAINT `fk_rpart_req` FOREIGN KEY (`request_id`) REFERENCES `recruitment_request` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='招聘需求参与人';

CREATE TABLE IF NOT EXISTS `sys_user_role` (
  `user_id` bigint unsigned NOT NULL COMMENT '系统用户ID',
  `role_id` bigint unsigned NOT NULL COMMENT '角色ID',
  PRIMARY KEY (`user_id`,`role_id`),
  KEY `fk_ur_role` (`role_id`),
  CONSTRAINT `fk_ur_role` FOREIGN KEY (`role_id`) REFERENCES `sys_role` (`id`),
  CONSTRAINT `fk_ur_user` FOREIGN KEY (`user_id`) REFERENCES `sys_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户角色关系：记录每个用户拥有的角色';

CREATE TABLE IF NOT EXISTS `candidate_file` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '候选人文件ID',
  `candidate_id` bigint unsigned NOT NULL COMMENT '候选人ID',
  `file_name` varchar(255) NOT NULL COMMENT '原始文件名',
  `object_key` varchar(512) NOT NULL COMMENT '文件存储键',
  `size_bytes` bigint NOT NULL COMMENT '文件字节数',
  `mime_type` varchar(128) DEFAULT NULL COMMENT '文件媒体类型',
  `status` enum('ACTIVE','DELETED') NOT NULL DEFAULT 'ACTIVE' COMMENT '文件状态',
  `uploaded_by` bigint unsigned NOT NULL COMMENT '上传人用户ID',
  `uploaded_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '上传时间',
  PRIMARY KEY (`id`),
  KEY `fk_cf_candidate` (`candidate_id`),
  KEY `fk_cf_user` (`uploaded_by`),
  CONSTRAINT `fk_cf_candidate` FOREIGN KEY (`candidate_id`) REFERENCES `candidate` (`id`),
  CONSTRAINT `fk_cf_user` FOREIGN KEY (`uploaded_by`) REFERENCES `sys_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='候选人附件元数据';

CREATE TABLE IF NOT EXISTS `candidate_stage_log` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '流转记录ID',
  `candidate_id` bigint unsigned NOT NULL COMMENT '候选人ID',
  `from_stage` varchar(32) DEFAULT NULL COMMENT '变更前阶段；首次可为空',
  `to_stage` varchar(32) NOT NULL COMMENT '变更后阶段',
  `reason` varchar(500) DEFAULT NULL COMMENT '流转、淘汰或取消原因',
  `operator_user_id` bigint unsigned DEFAULT NULL COMMENT '操作人用户ID；当前未设置外键',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '流转时间',
  PRIMARY KEY (`id`),
  KEY `idx_stage_candidate_time` (`candidate_id`,`created_at`),
  CONSTRAINT `fk_stage_candidate` FOREIGN KEY (`candidate_id`) REFERENCES `candidate` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='候选人阶段流转：记录招聘流程每一步变化';

CREATE TABLE IF NOT EXISTS `interview` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '面试记录ID',
  `candidate_id` bigint unsigned NOT NULL COMMENT '候选人ID',
  `round_no` tinyint unsigned NOT NULL COMMENT '面试轮次，允许1至10轮',
  `scheduled_start` datetime NOT NULL COMMENT '计划开始时间',
  `scheduled_end` datetime NOT NULL COMMENT '计划结束时间',
  `status` enum('SCHEDULED','CANCELLED','COMPLETED','NO_SHOW','RESCHEDULED') NOT NULL DEFAULT 'SCHEDULED' COMMENT '状态：已安排、取消、完成、未到场、改期',
  `result` enum('PASS','FAIL','PENDING','CANCELLED','NO_SHOW') DEFAULT NULL COMMENT '结果：通过、不通过、待定、取消、未到场',
  `scores_json` json DEFAULT NULL COMMENT '各评价维度评分',
  `evaluation` text COMMENT '面试评价或处理原因',
  `cancelled_reason` varchar(500) DEFAULT NULL COMMENT '取消或改期原因',
  `created_by` bigint unsigned DEFAULT NULL COMMENT '创建人用户ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
  `extra` json DEFAULT NULL COMMENT '扩展属性',
  `version` int NOT NULL DEFAULT '0' COMMENT '数据版本号',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_interview_candidate_round` (`candidate_id`,`round_no`),
  KEY `idx_interview_time` (`scheduled_start`,`scheduled_end`),
  KEY `fk_interview_creator` (`created_by`),
  CONSTRAINT `fk_interview_candidate` FOREIGN KEY (`candidate_id`) REFERENCES `candidate` (`id`),
  CONSTRAINT `fk_interview_creator` FOREIGN KEY (`created_by`) REFERENCES `sys_user` (`id`),
  CONSTRAINT `ck_interview_round` CHECK ((`round_no` between 1 and 10)),
  CONSTRAINT `ck_interview_time` CHECK ((`scheduled_end` > `scheduled_start`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='面试安排与评价：记录每轮面试的时间、状态和结果';

CREATE TABLE IF NOT EXISTS `onboarding_record` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '入职记录ID',
  `candidate_id` bigint unsigned NOT NULL COMMENT '候选人ID',
  `employee_id` bigint unsigned DEFAULT NULL COMMENT '完成入职后生成的员工ID',
  `planned_onboard_date` date DEFAULT NULL COMMENT '计划入职日',
  `actual_onboard_date` date DEFAULT NULL COMMENT '实际入职日',
  `result` enum('PENDING_ONBOARD','POSTPONED','HIRED','DECLINED','NO_SHOW','CANCELLED') NOT NULL DEFAULT 'PENDING_ONBOARD' COMMENT '结果：待入职、延期、已入职、拒绝、未到场、取消',
  `remark` varchar(1000) DEFAULT NULL COMMENT '入职备注',
  `created_by` bigint unsigned DEFAULT NULL COMMENT '创建人用户ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
  `extra` json DEFAULT NULL COMMENT '扩展属性',
  `version` int NOT NULL DEFAULT '0' COMMENT '数据版本号',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_onboarding_candidate` (`candidate_id`),
  UNIQUE KEY `uk_onboarding_employee` (`employee_id`),
  KEY `fk_onboarding_creator` (`created_by`),
  CONSTRAINT `fk_onboarding_candidate` FOREIGN KEY (`candidate_id`) REFERENCES `candidate` (`id`),
  CONSTRAINT `fk_onboarding_creator` FOREIGN KEY (`created_by`) REFERENCES `sys_user` (`id`),
  CONSTRAINT `fk_onboarding_employee` FOREIGN KEY (`employee_id`) REFERENCES `employee` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='候选人入职记录：连接候选人与正式员工档案';

CREATE TABLE IF NOT EXISTS `interview_interviewer` (
  `interview_id` bigint unsigned NOT NULL COMMENT '面试记录ID',
  `employee_id` bigint unsigned NOT NULL COMMENT '参与员工ID',
  `role` enum('INTERVIEWER','HR','OBSERVER') NOT NULL DEFAULT 'INTERVIEWER' COMMENT '身份：面试官、HR、观察员',
  PRIMARY KEY (`interview_id`,`employee_id`),
  KEY `fk_ii_employee` (`employee_id`),
  CONSTRAINT `fk_ii_employee` FOREIGN KEY (`employee_id`) REFERENCES `employee` (`id`),
  CONSTRAINT `fk_ii_interview` FOREIGN KEY (`interview_id`) REFERENCES `interview` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='面试参与人：关联面试官、HR和观察员';


-- The organization manager reference is added after employee because the two tables reference each other.
SET @hr_add_manager_fk = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE org_department ADD CONSTRAINT fk_org_manager FOREIGN KEY (manager_employee_id) REFERENCES employee(id)', 'SELECT 1') FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_department' AND CONSTRAINT_NAME = 'fk_org_manager');
PREPARE hr_manager_fk_stmt FROM @hr_add_manager_fk;
EXECUTE hr_manager_fk_stmt;
DEALLOCATE PREPARE hr_manager_fk_stmt;
