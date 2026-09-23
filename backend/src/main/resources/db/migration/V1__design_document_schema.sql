-- ============================================================================
-- 人力资源管理平台数据库初始化脚本（MySQL 8.0+）
-- 覆盖组织、岗位、员工、权限、招聘、面试、入职、资产、导入与审计模块。
-- 重要：脚本会删除同名旧表，适合初始化测试环境，不应直接在生产库执行。
-- ============================================================================

-- 创建数据库。utf8mb4 可完整保存中文；该排序规则比较文本时不区分大小写。
-- 让下面的语句都在 hrms 数据库中执行。

-- 临时关闭外键检查，以免有关联关系的旧表无法删除。
-- 从业务明细表到基础表依次删除；表不存在时不会报错。
-- 删除完成后恢复外键检查，防止写入无效关联数据。

-- 一、组织架构 ================================================================
-- 组织部门表：用 parent_id 把公司、部门和组连接成一棵组织树。
CREATE TABLE org_department (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '组织内部ID，自增主键',
  code VARCHAR(64) NOT NULL COMMENT '组织编码，全系统唯一',
  name VARCHAR(128) NOT NULL COMMENT '组织名称',
  parent_id BIGINT UNSIGNED NULL COMMENT '上级组织ID；为空表示根组织',
  manager_employee_id BIGINT UNSIGNED NULL COMMENT '负责人对应的员工ID',
  location VARCHAR(128) NULL COMMENT '主要办公地点',
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE' COMMENT '状态：启用、停用',
  description VARCHAR(500) NULL COMMENT '组织职责说明',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
  deleted_at DATETIME NULL COMMENT '软删除时间；为空表示未删除',
  PRIMARY KEY (id),
  UNIQUE KEY uk_org_code (code), -- 防止组织编码重复
  KEY idx_org_parent_status (parent_id,status), -- 加快加载下级组织和组织树
  CONSTRAINT fk_org_parent FOREIGN KEY (parent_id) REFERENCES org_department(id)
) ENGINE=InnoDB COMMENT='组织部门：保存公司、部门和组的树形结构';

-- 二、职级与岗位 ==============================================================
-- 职级表：维护职级层级、展示顺序、经验要求和适用组织。
CREATE TABLE grade (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '职级内部ID',
  code VARCHAR(64) NOT NULL COMMENT '职级编码，全系统唯一',
  name VARCHAR(128) NOT NULL COMMENT '职级名称',
  level_no INT NOT NULL COMMENT '职级层级数字',
  sequence_no INT NOT NULL DEFAULT 0 COMMENT '同层级展示顺序',
  min_years DECIMAL(5,2) NULL COMMENT '建议最低工作年限',
  requirements VARCHAR(1000) NULL COMMENT '能力、经验及任职要求',
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE' COMMENT '状态：启用、停用',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_grade_code (code),
  CONSTRAINT ck_grade_level CHECK (level_no > 0), -- 层级必须为正数
  CONSTRAINT ck_grade_years CHECK (min_years IS NULL OR min_years >= 0) -- 年限可空但不能为负
) ENGINE=InnoDB COMMENT='职级：定义层级、排序和任职要求';

-- 岗位表：记录各组织下的岗位、核定编制、职责与任职要求。
CREATE TABLE job_position (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '岗位内部ID',
  code VARCHAR(64) NOT NULL COMMENT '岗位编码，全系统唯一',
  name VARCHAR(128) NOT NULL COMMENT '岗位名称',
  org_id BIGINT UNSIGNED NOT NULL COMMENT '岗位所属组织ID',
  sequence_no INT NOT NULL DEFAULT 0 COMMENT '岗位展示顺序',
  location VARCHAR(128) NULL COMMENT '默认办公地点',
  headcount INT NOT NULL DEFAULT 0 COMMENT '岗位核定编制人数',
  duties TEXT NULL COMMENT '岗位职责',
  requirements TEXT NULL COMMENT '任职要求',
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE' COMMENT '状态：启用、停用',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_job_code (code),
  UNIQUE KEY uk_job_org_name (org_id,name), -- 同一组织不能有两个同名岗位
  KEY idx_job_org_status (org_id,status),
  CONSTRAINT fk_job_org FOREIGN KEY (org_id) REFERENCES org_department(id),
  CONSTRAINT ck_job_headcount CHECK (headcount >= 0) -- 编制人数不能为负
) ENGINE=InnoDB COMMENT='岗位：保存归属、编制、职责和任职要求';

-- 三、员工档案 ================================================================
-- 员工主档案：保存花名册中常用、敏感程度相对较低的信息。
CREATE TABLE employee (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '员工内部ID',
  employee_no VARCHAR(64) NOT NULL COMMENT '工号，全系统唯一',
  name VARCHAR(100) NOT NULL COMMENT '员工姓名',
  phone VARCHAR(32) NULL COMMENT '手机号码；非空时不可重复',
  email VARCHAR(160) NULL COMMENT '电子邮箱',
  org_id BIGINT UNSIGNED NOT NULL COMMENT '当前直属组织ID',
  main_org_id BIGINT UNSIGNED NULL COMMENT '所属一级组织或主部门ID',
  job_id BIGINT UNSIGNED NULL COMMENT '当前岗位ID',
  grade_id BIGINT UNSIGNED NULL COMMENT '当前职级ID',
  supervisor_id BIGINT UNSIGNED NULL COMMENT '直属上级员工ID',
  company VARCHAR(128) NULL COMMENT '劳动合同归属公司',
  location VARCHAR(128) NULL COMMENT '工作片区或办公区域',
  workplace VARCHAR(128) NULL COMMENT '具体工作所在地',
  office VARCHAR(128) NULL COMMENT '办公室或办事处',
  archive_number VARCHAR(128) NULL COMMENT '人事档案编号',
  employee_type ENUM('FULL_TIME','PART_TIME','OUTSOURCED','INTERN') NOT NULL DEFAULT 'FULL_TIME' COMMENT '用工类型：正式、兼职、外包、实习',
  status ENUM('PRE_ONBOARD','PROBATION','ACTIVE','PENDING_LEAVE','LEFT') NOT NULL DEFAULT 'PRE_ONBOARD' COMMENT '人员状态：待入职、试用、在职、待离职、已离职',
  entry_date DATE NULL COMMENT '入职日期',
  leave_date DATE NULL COMMENT '离职日期；未离职时为空',
  probation_months DECIMAL(4,1) NULL COMMENT '试用期月数；无试用期或未填写时为空',
  regular_date DATE NULL COMMENT '转正日期',
  contract_start DATE NULL COMMENT '合同开始日期',
  contract_end DATE NULL COMMENT '合同结束日期',
  contract_type VARCHAR(64) NULL COMMENT '合同类型',
  contract_term VARCHAR(64) NULL COMMENT '合同期限',
  first_contract_start DATE NULL COMMENT '首次合同开始日期',
  first_contract_end DATE NULL COMMENT '首次合同结束日期',
  gender VARCHAR(16) NULL COMMENT '性别',
  ethnicity VARCHAR(64) NULL COMMENT '民族',
  marital_status VARCHAR(32) NULL COMMENT '婚姻状况',
  political_status VARCHAR(64) NULL COMMENT '政治面貌',
  constellation VARCHAR(32) NULL COMMENT '星座；可由出生日期计算，也允许为空',
  education VARCHAR(64) NULL COMMENT '学历',
  school VARCHAR(200) NULL COMMENT '毕业院校',
  major VARCHAR(200) NULL COMMENT '所学专业',
  graduated_date DATE NULL COMMENT '毕业时间',
  social_status VARCHAR(128) NULL COMMENT '社保情况',
  fund_status VARCHAR(128) NULL COMMENT '公积金情况',
  insurance_notes VARCHAR(1000) NULL COMMENT '五险一金明细备注',
  bank_name VARCHAR(128) NULL COMMENT '开户行',
  title_level VARCHAR(64) NULL COMMENT '职称级别',
  title_specialty VARCHAR(128) NULL COMMENT '职称专业',
  remark VARCHAR(1000) NULL COMMENT '员工备注',
  wechat VARCHAR(128) NULL COMMENT '微信号',
  verification ENUM('UNVERIFIED','VERIFIED') NOT NULL DEFAULT 'UNVERIFIED' COMMENT '资料核验状态：未核验、已核验',
  version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '乐观锁版本号，防止多人编辑互相覆盖',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
  deleted_at DATETIME NULL COMMENT '软删除时间；为空表示未删除',
  PRIMARY KEY (id),
  UNIQUE KEY uk_employee_no (employee_no),
  UNIQUE KEY uk_employee_phone (phone),
  KEY idx_employee_org_status (org_id,status),
  KEY idx_employee_job (job_id),
  KEY idx_employee_supervisor (supervisor_id),
  CONSTRAINT fk_employee_org FOREIGN KEY (org_id) REFERENCES org_department(id),
  CONSTRAINT fk_employee_main_org FOREIGN KEY (main_org_id) REFERENCES org_department(id),
  CONSTRAINT fk_employee_job FOREIGN KEY (job_id) REFERENCES job_position(id),
  CONSTRAINT fk_employee_grade FOREIGN KEY (grade_id) REFERENCES grade(id),
  CONSTRAINT fk_employee_supervisor FOREIGN KEY (supervisor_id) REFERENCES employee(id),
  CONSTRAINT ck_employee_contract CHECK (contract_end IS NULL OR contract_start IS NULL OR contract_end >= contract_start) -- 合同结束日不能早于开始日
) ENGINE=InnoDB COMMENT='员工主档案：保存花名册、任职和合同基础信息';

-- 组织与员工互相引用，所以等员工表建好后再补上“组织负责人”外键。
ALTER TABLE org_department ADD CONSTRAINT fk_org_manager FOREIGN KEY (manager_employee_id) REFERENCES employee(id);

-- 员工敏感档案：与员工一对一。cipher 字段应存加密密文，读取时还需权限控制和脱敏。
CREATE TABLE employee_sensitive (
  employee_id BIGINT UNSIGNED NOT NULL COMMENT '员工ID，同时作为本表主键',
  id_name VARCHAR(100) NULL COMMENT '证件姓名',
  id_no_cipher VARBINARY(512) NULL COMMENT '加密后的身份证件号码',
  id_expire DATE NULL COMMENT '证件有效期截止日',
  birthday DATE NULL COMMENT '出生日期',
  native_place_cipher VARBINARY(512) NULL COMMENT '加密后的籍贯',
  household_type VARCHAR(64) NULL COMMENT '户籍类型',
  household_location_cipher VARBINARY(512) NULL COMMENT '加密后的户口所在地',
  bank_account_cipher VARBINARY(512) NULL COMMENT '加密后的银行卡号',
  social_security_no_cipher VARBINARY(512) NULL COMMENT '加密后的社保号码',
  housing_fund_no_cipher VARBINARY(512) NULL COMMENT '加密后的公积金账号',
  social_city VARCHAR(128) NULL COMMENT '社保缴纳城市',
  social_account_cipher VARBINARY(512) NULL COMMENT '加密后的社保账户信息',
  address_cipher VARBINARY(1024) NULL COMMENT '加密后的现居住地址',
  emergency_contact_cipher VARBINARY(1024) NULL COMMENT '加密后的紧急联系人及联系方式',
  emergency_relation VARCHAR(32) NULL COMMENT '紧急联系人关系',
  first_work_date DATE NULL COMMENT '首次参加工作日期',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
  PRIMARY KEY (employee_id),
  CONSTRAINT fk_sensitive_employee FOREIGN KEY (employee_id) REFERENCES employee(id)
) ENGINE=InnoDB COMMENT='员工敏感档案：保存需加密和严格授权的信息';

-- 员工材料表：只存文件元数据；真实文件一般存放在对象存储或文件服务器。
CREATE TABLE employee_file (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '文件记录ID',
  employee_id BIGINT UNSIGNED NOT NULL COMMENT '文件所属员工ID',
  file_type VARCHAR(64) NOT NULL COMMENT '材料类型，如合同、学历证明',
  object_key VARCHAR(512) NOT NULL COMMENT '文件在对象存储中的唯一键或路径',
  file_name VARCHAR(255) NOT NULL COMMENT '上传时的原始文件名',
  status ENUM('ACTIVE','DELETED') NOT NULL DEFAULT 'ACTIVE' COMMENT '文件状态：有效、已删除',
  uploaded_by BIGINT UNSIGNED NULL COMMENT '上传人的系统用户ID；当前未设置外键',
  uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '上传时间',
  PRIMARY KEY (id),
  KEY idx_file_employee_type (employee_id,file_type),
  CONSTRAINT fk_file_employee FOREIGN KEY (employee_id) REFERENCES employee(id)
) ENGINE=InnoDB COMMENT='员工材料元数据：记录附件名称、类型和存储位置';

-- 员工异动记录：保存调岗、调级、转正、离职等操作前后的数据快照。
CREATE TABLE employee_change_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '变更记录ID',
  employee_id BIGINT UNSIGNED NOT NULL COMMENT '发生变更的员工ID',
  change_type VARCHAR(64) NOT NULL COMMENT '变更类型，如TRANSFER、PROMOTION、LEAVE',
  before_json JSON NULL COMMENT '变更前的数据快照',
  after_json JSON NULL COMMENT '变更后的数据快照',
  operator_user_id BIGINT UNSIGNED NULL COMMENT '操作人用户ID；当前未设置外键',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '变更时间',
  PRIMARY KEY (id),
  KEY idx_change_employee_time (employee_id,created_at),
  CONSTRAINT fk_change_employee FOREIGN KEY (employee_id) REFERENCES employee(id)
) ENGINE=InnoDB COMMENT='员工变更记录：保存人事异动前后的数据';

-- 四、用户和权限 ==============================================================
-- 系统用户：一个员工最多绑定一个账号；employee_id 为空时可作为服务账号。
CREATE TABLE sys_user (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '系统用户ID',
  username VARCHAR(64) NOT NULL COMMENT '登录用户名',
  password_hash VARCHAR(255) NOT NULL COMMENT '密码哈希值，严禁保存明文密码',
  employee_id BIGINT UNSIGNED NULL COMMENT '绑定的员工ID',
  status ENUM('ACTIVE','LOCKED','DISABLED') NOT NULL DEFAULT 'ACTIVE' COMMENT '账号状态：正常、锁定、停用',
  last_login_at DATETIME NULL COMMENT '最近成功登录时间',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_name (username),
  UNIQUE KEY uk_user_employee (employee_id),
  CONSTRAINT fk_user_employee FOREIGN KEY (employee_id) REFERENCES employee(id)
) ENGINE=InnoDB COMMENT='系统用户：用于登录并关联员工身份';

-- 角色表：data_scope 决定该角色默认可以查看多大范围的数据。
CREATE TABLE sys_role (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '角色ID',
  code VARCHAR(64) NOT NULL COMMENT '角色编码',
  name VARCHAR(128) NOT NULL COMMENT '角色名称',
  data_scope ENUM('ALL','SELF_ORG_TREE','SELF_ORG') NOT NULL DEFAULT 'SELF_ORG' COMMENT '数据范围：全部、本组织及下级、仅本组织',
  PRIMARY KEY (id), UNIQUE KEY uk_role_code (code)
) ENGINE=InnoDB COMMENT='系统角色：定义用户身份和默认数据范围';

-- 用户角色关联表：多对多关系，一个用户可拥有多个角色。
CREATE TABLE sys_user_role (
  user_id BIGINT UNSIGNED NOT NULL COMMENT '系统用户ID',
  role_id BIGINT UNSIGNED NOT NULL COMMENT '角色ID',
  PRIMARY KEY (user_id,role_id), -- 联合主键同时防止重复授权
  CONSTRAINT fk_ur_user FOREIGN KEY (user_id) REFERENCES sys_user(id),
  CONSTRAINT fk_ur_role FOREIGN KEY (role_id) REFERENCES sys_role(id)
) ENGINE=InnoDB COMMENT='用户角色关系：记录每个用户拥有的角色';

-- 五、招聘流程 ================================================================
-- 招聘需求：记录某组织针对某岗位发起的招聘计划和各环节负责人。
CREATE TABLE recruitment_request (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '招聘需求内部ID',
  request_no VARCHAR(64) NOT NULL COMMENT '需求编号，全系统唯一',
  name VARCHAR(200) NOT NULL COMMENT '招聘需求名称',
  job_id BIGINT UNSIGNED NOT NULL COMMENT '招聘岗位ID',
  org_id BIGINT UNSIGNED NOT NULL COMMENT '需求组织ID',
  location VARCHAR(128) NOT NULL COMMENT '工作地点或片区',
  company VARCHAR(128) NULL COMMENT '录用后的合同归属公司',
  headcount INT NOT NULL COMMENT '计划招聘人数',
  salary_min DECIMAL(12,2) NULL COMMENT '薪资下限',
  salary_max DECIMAL(12,2) NULL COMMENT '薪资上限',
  recruit_type ENUM('NEW','REPLACEMENT') NOT NULL COMMENT '类型：新增编制、人员替补',
  deadline DATE NULL COMMENT '期望到岗或招聘截止日期',
  owner_employee_id BIGINT UNSIGNED NOT NULL COMMENT 'HR负责人ID',
  screener_employee_id BIGINT UNSIGNED NULL COMMENT '部门筛选负责人ID',
  first_interviewer_id BIGINT UNSIGNED NULL COMMENT '默认初试面试官ID',
  second_interviewer_id BIGINT UNSIGNED NULL COMMENT '默认复试面试官ID',
  status ENUM('OPEN','PAUSED','COMPLETED','CLOSED') NOT NULL DEFAULT 'OPEN' COMMENT '状态：招聘中、暂停、完成、关闭',
  version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '乐观锁版本号',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
  PRIMARY KEY (id), UNIQUE KEY uk_request_no (request_no),
  KEY idx_request_org_status (org_id,status),
  CONSTRAINT fk_request_job FOREIGN KEY (job_id) REFERENCES job_position(id),
  CONSTRAINT fk_request_org FOREIGN KEY (org_id) REFERENCES org_department(id),
  CONSTRAINT fk_request_owner FOREIGN KEY (owner_employee_id) REFERENCES employee(id),
  CONSTRAINT fk_request_screener FOREIGN KEY (screener_employee_id) REFERENCES employee(id),
  CONSTRAINT fk_request_first_interviewer FOREIGN KEY (first_interviewer_id) REFERENCES employee(id),
  CONSTRAINT fk_request_second_interviewer FOREIGN KEY (second_interviewer_id) REFERENCES employee(id),
  CONSTRAINT ck_request_headcount CHECK (headcount > 0), -- 至少招聘1人
  CONSTRAINT ck_request_salary CHECK (salary_min IS NULL OR salary_max IS NULL OR salary_min <= salary_max)
) ENGINE=InnoDB COMMENT='招聘需求：记录岗位、人数、负责人和状态';

-- 候选人：保存简历基本信息及当前招聘阶段。
CREATE TABLE candidate (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '候选人内部ID',
  request_id BIGINT UNSIGNED NOT NULL COMMENT '对应的招聘需求ID',
  name VARCHAR(100) NOT NULL COMMENT '候选人姓名', phone VARCHAR(32) NULL COMMENT '手机号',
  email VARCHAR(160) NULL COMMENT '电子邮箱', source VARCHAR(64) NULL COMMENT '简历来源，如内推、招聘网站',
  stage ENUM('HR_SCREEN','DEPT_SCREEN','FIRST_INTERVIEW','SECOND_INTERVIEW','ONBOARDING','HIRED','REJECTED','CANCELLED') NOT NULL DEFAULT 'HR_SCREEN' COMMENT '当前阶段：HR筛选、部门筛选、初试、复试、待入职、已入职、淘汰、取消',
  education VARCHAR(128) NULL COMMENT '最高学历', years DECIMAL(5,2) NULL COMMENT '工作年限',
  resume_key VARCHAR(512) NULL COMMENT '原始简历的对象存储键或路径', reject_reason VARCHAR(500) NULL COMMENT '淘汰或取消原因',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
  PRIMARY KEY (id), KEY idx_candidate_request_stage (request_id,stage), KEY idx_candidate_phone (phone),
  CONSTRAINT fk_candidate_request FOREIGN KEY (request_id) REFERENCES recruitment_request(id),
  CONSTRAINT ck_candidate_years CHECK (years IS NULL OR years >= 0)
) ENGINE=InnoDB COMMENT='候选人：保存简历信息和当前招聘阶段';

-- 阶段流转日志：候选人每次改变阶段都追加一条，形成完整招聘轨迹。
CREATE TABLE candidate_stage_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '流转记录ID', candidate_id BIGINT UNSIGNED NOT NULL COMMENT '候选人ID',
  from_stage VARCHAR(32) NULL COMMENT '变更前阶段；首次可为空', to_stage VARCHAR(32) NOT NULL COMMENT '变更后阶段',
  reason VARCHAR(500) NULL COMMENT '流转、淘汰或取消原因', operator_user_id BIGINT UNSIGNED NULL COMMENT '操作人用户ID；当前未设置外键',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '流转时间', PRIMARY KEY (id),
  KEY idx_stage_candidate_time (candidate_id,created_at),
  CONSTRAINT fk_stage_candidate FOREIGN KEY (candidate_id) REFERENCES candidate(id)
) ENGINE=InnoDB COMMENT='候选人阶段流转：记录招聘流程每一步变化';

-- 面试表：记录每轮面试的时间、状态、维度评分和最终结论。
CREATE TABLE interview (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '面试记录ID', candidate_id BIGINT UNSIGNED NOT NULL COMMENT '候选人ID',
  round_no TINYINT UNSIGNED NOT NULL COMMENT '面试轮次，允许1至10轮',
  scheduled_start DATETIME NOT NULL COMMENT '计划开始时间', scheduled_end DATETIME NOT NULL COMMENT '计划结束时间',
  status ENUM('SCHEDULED','CANCELLED','COMPLETED','NO_SHOW','RESCHEDULED') NOT NULL DEFAULT 'SCHEDULED' COMMENT '状态：已安排、取消、完成、未到场、改期',
  result ENUM('PASS','FAIL','PENDING','CANCELLED','NO_SHOW') NULL COMMENT '结果：通过、不通过、待定、取消、未到场',
  scores_json JSON NULL COMMENT '各评价维度评分', evaluation TEXT NULL COMMENT '面试评价或处理原因',
  cancelled_reason VARCHAR(500) NULL COMMENT '取消或改期原因', created_by BIGINT UNSIGNED NULL COMMENT '创建人用户ID',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
  PRIMARY KEY (id), UNIQUE KEY uk_interview_candidate_round (candidate_id,round_no),
  KEY idx_interview_time (scheduled_start,scheduled_end),
  CONSTRAINT fk_interview_candidate FOREIGN KEY (candidate_id) REFERENCES candidate(id),
  CONSTRAINT fk_interview_creator FOREIGN KEY (created_by) REFERENCES sys_user(id),
  CONSTRAINT ck_interview_time CHECK (scheduled_end > scheduled_start),
  CONSTRAINT ck_interview_round CHECK (round_no BETWEEN 1 AND 10)
) ENGINE=InnoDB COMMENT='面试安排与评价：记录每轮面试的时间、状态和结果';

-- 面试参与人：解决“一场面试有多人、一名员工参加多场面试”的多对多关系。
CREATE TABLE interview_interviewer (
  interview_id BIGINT UNSIGNED NOT NULL COMMENT '面试记录ID', employee_id BIGINT UNSIGNED NOT NULL COMMENT '参与员工ID',
  role ENUM('INTERVIEWER','HR','OBSERVER') NOT NULL DEFAULT 'INTERVIEWER' COMMENT '身份：面试官、HR、观察员',
  PRIMARY KEY (interview_id,employee_id),
  CONSTRAINT fk_ii_interview FOREIGN KEY (interview_id) REFERENCES interview(id),
  CONSTRAINT fk_ii_employee FOREIGN KEY (employee_id) REFERENCES employee(id)
) ENGINE=InnoDB COMMENT='面试参与人：关联面试官、HR和观察员';

-- 入职记录：把招聘候选人衔接到正式员工花名册。
CREATE TABLE onboarding_record (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '入职记录ID', candidate_id BIGINT UNSIGNED NOT NULL COMMENT '候选人ID',
  employee_id BIGINT UNSIGNED NULL COMMENT '完成入职后生成的员工ID',
  planned_onboard_date DATE NULL COMMENT '计划入职日', actual_onboard_date DATE NULL COMMENT '实际入职日',
  result ENUM('PENDING_ONBOARD','POSTPONED','HIRED','DECLINED','NO_SHOW','CANCELLED') NOT NULL DEFAULT 'PENDING_ONBOARD' COMMENT '结果：待入职、延期、已入职、拒绝、未到场、取消',
  remark VARCHAR(1000) NULL COMMENT '入职备注', created_by BIGINT UNSIGNED NULL COMMENT '创建人用户ID',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
  PRIMARY KEY (id), UNIQUE KEY uk_onboarding_candidate (candidate_id), UNIQUE KEY uk_onboarding_employee (employee_id),
  CONSTRAINT fk_onboarding_candidate FOREIGN KEY (candidate_id) REFERENCES candidate(id),
  CONSTRAINT fk_onboarding_employee FOREIGN KEY (employee_id) REFERENCES employee(id),
  CONSTRAINT fk_onboarding_creator FOREIGN KEY (created_by) REFERENCES sys_user(id)
) ENGINE=InnoDB COMMENT='候选人入职记录：连接候选人与正式员工档案';

-- 六、资产管理 ================================================================
-- 资产台账：保存电脑、显示器等办公资产当前的状态、地点和使用人。
CREATE TABLE asset (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '资产内部ID', asset_no VARCHAR(64) NOT NULL COMMENT '资产编码',
  name VARCHAR(200) NOT NULL COMMENT '资产名称', category VARCHAR(64) NOT NULL COMMENT '资产类别', model VARCHAR(128) NULL COMMENT '规格型号',
  location VARCHAR(128) NULL COMMENT '办公地点', office VARCHAR(128) NULL COMMENT '具体存放位置',
  public_asset BOOLEAN NOT NULL DEFAULT FALSE COMMENT '是否公共资产：1是，0否', owner_employee_id BIGINT UNSIGNED NULL COMMENT '当前使用人ID',
  status ENUM('IDLE','IN_USE','REPAIRING','SCRAPPED') NOT NULL DEFAULT 'IDLE' COMMENT '状态：闲置、使用中、维修中、已报废',
  purchased_date DATE NULL COMMENT '购置日期', value DECIMAL(12,2) NULL COMMENT '购置金额或资产价值', supplier VARCHAR(200) NULL COMMENT '供应商',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间', updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
  PRIMARY KEY (id), UNIQUE KEY uk_asset_no (asset_no), KEY idx_asset_owner_status (owner_employee_id,status),
  CONSTRAINT fk_asset_owner FOREIGN KEY (owner_employee_id) REFERENCES employee(id),
  CONSTRAINT ck_asset_owner CHECK ((status = 'IN_USE' AND owner_employee_id IS NOT NULL AND public_asset = FALSE) OR status <> 'IN_USE'),
  CONSTRAINT ck_asset_value CHECK (value IS NULL OR value >= 0)
) ENGINE=InnoDB COMMENT='资产台账：保存资产当前状态、位置和使用人';

-- 资产履历：记录领用、归还、转移、维修、位置变化和报废全过程。
CREATE TABLE asset_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '资产履历ID', asset_id BIGINT UNSIGNED NOT NULL COMMENT '资产ID',
  action ENUM('ASSIGN','RETURN','TRANSFER','REPAIR_START','REPAIR_END','SCRAP','LOCATION_CHANGE') NOT NULL COMMENT '操作：领用、归还、转移、开始/结束维修、报废、位置变化',
  from_owner_employee_id BIGINT UNSIGNED NULL COMMENT '变更前使用人', to_owner_employee_id BIGINT UNSIGNED NULL COMMENT '变更后使用人',
  from_status VARCHAR(32) NULL COMMENT '变更前状态', to_status VARCHAR(32) NULL COMMENT '变更后状态', reason VARCHAR(500) NULL COMMENT '原因或备注',
  operator_user_id BIGINT UNSIGNED NULL COMMENT '操作人用户ID', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',
  PRIMARY KEY (id), KEY idx_asset_history (asset_id,created_at),
  CONSTRAINT fk_ah_asset FOREIGN KEY (asset_id) REFERENCES asset(id),
  CONSTRAINT fk_ah_from_owner FOREIGN KEY (from_owner_employee_id) REFERENCES employee(id),
  CONSTRAINT fk_ah_to_owner FOREIGN KEY (to_owner_employee_id) REFERENCES employee(id),
  CONSTRAINT fk_ah_operator FOREIGN KEY (operator_user_id) REFERENCES sys_user(id)
) ENGINE=InnoDB COMMENT='资产履历：记录资产从领用到报废的完整变化';

-- 七、导入与审计 ==============================================================
-- 导入批次：记录人员、资产或招聘需求文件的校验、写入结果和逐行错误。
CREATE TABLE import_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '导入批次ID',
  import_type ENUM('EMPLOYEE','ASSET','REQUEST') NOT NULL COMMENT '类型：员工、资产、招聘需求',
  file_name VARCHAR(255) NOT NULL COMMENT '导入文件名', file_hash CHAR(64) NOT NULL COMMENT 'SHA-256文件哈希，用于防止重复导入',
  total_count INT NOT NULL DEFAULT 0 COMMENT '总条数', added_count INT NOT NULL DEFAULT 0 COMMENT '新增数',
  updated_count INT NOT NULL DEFAULT 0 COMMENT '更新数', skipped_count INT NOT NULL DEFAULT 0 COMMENT '跳过数', error_count INT NOT NULL DEFAULT 0 COMMENT '错误数',
  status ENUM('PARSING','PENDING','RUNNING','SUCCESS','PARTIAL_SUCCESS','FAILED') NOT NULL COMMENT '状态：解析中、待执行、执行中、成功、部分成功、失败',
  error_detail JSON NULL COMMENT '逐行错误、警告和校验详情', operator_user_id BIGINT UNSIGNED NULL COMMENT '发起导入的用户ID',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '批次创建时间', PRIMARY KEY (id),
  UNIQUE KEY uk_import_hash_type (import_type,file_hash),
  CONSTRAINT fk_import_operator FOREIGN KEY (operator_user_id) REFERENCES sys_user(id)
) ENGINE=InnoDB COMMENT='导入批次：记录批量导入进度、结果和错误';

-- 全局审计日志：回答“谁在何时对哪条数据做了什么”，用于安全审计和问题追查。
CREATE TABLE audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '审计日志ID', actor_user_id BIGINT UNSIGNED NULL COMMENT '操作人用户ID',
  actor_role VARCHAR(128) NULL COMMENT '操作时的角色快照', action VARCHAR(64) NOT NULL COMMENT '操作类型，如CREATE、UPDATE、DELETE、EXPORT',
  resource_type VARCHAR(64) NOT NULL COMMENT '资源类型，如EMPLOYEE、ASSET', resource_id BIGINT UNSIGNED NULL COMMENT '业务记录ID',
  before_json JSON NULL COMMENT '操作前数据快照', after_json JSON NULL COMMENT '操作后数据快照',
  ip VARCHAR(64) NULL COMMENT '客户端IP，兼容IPv4和IPv6', request_id VARCHAR(64) NULL COMMENT '请求链路ID，用于关联接口日志',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间', PRIMARY KEY (id),
  KEY idx_audit_resource (resource_type,resource_id,created_at), KEY idx_audit_actor_time (actor_user_id,created_at),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES sys_user(id)
) ENGINE=InnoDB COMMENT='全局审计日志：追踪关键数据操作';

-- 八、初始化角色 ==============================================================
-- HR管理员看全部数据；部门主管看本组织及下级；服务账号供后台任务或系统集成使用。
INSERT INTO sys_role(code,name,data_scope) VALUES
  ('HR_ADMIN','HR管理员','ALL'),
  ('DEPT_MANAGER','部门主管','SELF_ORG_TREE'),
  ('SERVICE','系统服务账号','ALL');

-- 脚本结束：共建立20张表，并写入3个内置角色。

CREATE TABLE employee_work_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id BIGINT UNSIGNED NOT NULL,
  company VARCHAR(200) NOT NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  leave_reason VARCHAR(500) NULL,
  sort_no INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id), KEY idx_work_history_employee (employee_id,sort_no),
  CONSTRAINT fk_work_history_employee FOREIGN KEY (employee_id) REFERENCES employee(id),
  CONSTRAINT ck_work_history_date CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
) ENGINE=InnoDB COMMENT='员工工作经历';

CREATE TABLE base_dictionary (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dict_code VARCHAR(64) NOT NULL,
  dict_name VARCHAR(128) NOT NULL,
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  PRIMARY KEY (id), UNIQUE KEY uk_base_dict_code (dict_code)
) ENGINE=InnoDB COMMENT='基础字典';

CREATE TABLE base_dictionary_item (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dictionary_id BIGINT UNSIGNED NOT NULL,
  item_code VARCHAR(64) NOT NULL,
  item_name VARCHAR(128) NOT NULL,
  sort_no INT NOT NULL DEFAULT 0,
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  aliases JSON NULL,
  PRIMARY KEY (id), UNIQUE KEY uk_dict_item_code (dictionary_id,item_code), UNIQUE KEY uk_dict_item_name (dictionary_id,item_name),
  CONSTRAINT fk_dict_item_dictionary FOREIGN KEY (dictionary_id) REFERENCES base_dictionary(id)
) ENGINE=InnoDB COMMENT='基础字典项';

INSERT INTO base_dictionary(dict_code,dict_name) VALUES
 ('WORK_REGION','工作片区'),('WORKPLACE','工作所在地'),('CONTRACT_COMPANY','合同归属');

-- 在 base_dictionary_item 中初始化原型提供的正式字典值
INSERT INTO base_dictionary_item(dictionary_id,item_code,item_name,sort_no)
SELECT d.id, CONCAT('REGION_',ROW_NUMBER() OVER ()), v.item_name, v.sort_no
FROM base_dictionary d JOIN (
  SELECT '上海' item_name,1 sort_no UNION ALL SELECT '南京',2
) v WHERE d.dict_code='WORK_REGION';

INSERT INTO base_dictionary_item(dictionary_id,item_code,item_name,sort_no)
SELECT d.id, CONCAT('PLACE_',ROW_NUMBER() OVER ()), v.item_name, v.sort_no
FROM base_dictionary d JOIN (
  SELECT '上海' item_name,1 sort_no UNION ALL SELECT '南京',2 UNION ALL SELECT '宁波',3
  UNION ALL SELECT '西安',4 UNION ALL SELECT '长沙',5 UNION ALL SELECT '郑州',6 UNION ALL SELECT '诸暨',7
) v WHERE d.dict_code='WORKPLACE';

INSERT INTO base_dictionary_item(dictionary_id,item_code,item_name,sort_no)
SELECT d.id, CONCAT('COMPANY_',ROW_NUMBER() OVER ()), v.item_name, v.sort_no
FROM base_dictionary d JOIN (
  SELECT '微间' item_name,1 sort_no UNION ALL SELECT '旦尺',2 UNION ALL SELECT '方之达',3
  UNION ALL SELECT '佛豪斯',4 UNION ALL SELECT '宁波舜变',5 UNION ALL SELECT '青衿智创',6
  UNION ALL SELECT '上海数寰',7 UNION ALL SELECT '上海有间',8 UNION ALL SELECT '致臻',9
  UNION ALL SELECT '中数求索',10 UNION ALL SELECT '中数求索（外包）',11 UNION ALL SELECT '中数信息',12
) v WHERE d.dict_code='CONTRACT_COMPANY';


