# HR API 契约

本文件位于系统根 `D:\5-HR\HR_system` 的 `backend/API.md`。启动和环境配置见 [系统 README](../README.md) 与 [部署手册](../docs/deployment.md)；源码位于本目录下的 `src/main/java/cn/hrplatform`，配置和迁移位于 `src/main/resources`。目录结构迁移不改变下列 HTTP 路由。

所有请求走同源 `/api`；登录使用 `HR_SESSION` HttpOnly、SameSite=Strict 会话 Cookie。成功响应为直接 JSON，无统一 `data` 包装。错误为 `{code,message,requestId?}`；401 未登录、403 越权、409 冲突、428 更新遗漏版本。创建/更新正文使用原型字段；`id` 是稳定业务编号，`dbId` 是内部数据库主键。外键字段接收业务编号，数据库只保存真实 FK。普通 PUT 为 patch 合并语义，必须包含 `version`；状态动作使用数据库行锁。

## 登录

- `POST /auth/login {username,password}` → `{user}`
- `GET /auth/me` → `{user}`
- `POST /auth/logout {}`
- `POST /auth/password {oldPassword,newPassword}` → 成功后所有旧会话失效
- user: `{id,username,displayName,role:'hr'|'manager',roles,menus:string[],permissions:string[],departmentId,managerDept,dataScope}`

## 数据

`GET /bootstrap` → `{user,orgs,jobs,grades,emps,reqs,candidates,assets,sequences,baseSettings,rules}`，每项已经过当前账号服务端数据范围过滤，敏感字段为掩码；员工档案归档标识 `deleted`/`deletedAt`。

`type` 为 orgs、jobs、grades、emps、reqs、candidates、assets：

- `GET /{type}?page=1&size=50&q=&archived=false` → `{items,total,page,size}`
- `GET /{type}/{id}` → 原型形状记录
- `POST /{type}` → 创建后的记录
- `PUT /{type}/{id}` → 更新后的记录（正文含 version）
- `DELETE /{type}/{id}` → 归档后的记录
- `POST /{type}/{id}/restore {}` → 恢复后的记录
- `GET /{type}/{id}/audit` → 审计记录（HR）
- 审计返回 `{action,date,actorName,detail,changes:[{field,label,before,after}]}`，详情同时带同样 `audit` 数组；字段快照排除敏感密文和明文，同义字段统一为数据库 canonical 名（例如备注 `remark`）并提供中文 `label`。
- `GET /emps/{id}/sensitive` → 解密字段（包含 `householdType`）；权限和查看审计。户籍类型写入设计文档既有 `employee_sensitive.household_type`，普通档案列表仍只返回掩码，导出需合并此授权接口。

创建员工最小字段 `{id,name,dept,job?,grade?,status:'试用',phone?,entry?,workRegion?,workplace?,contractCompany?}`；dept 为直接组织，mainDept/mainDeptId 为顶层部门。grade 使用职级 code。创建招聘需求必须含 `{id?,name,dept,job,count,salaryMin,salaryMax,type:'新增'|'替补',workRegion,workplace,contractCompany,deadline,ownerIds:[],screenerIds:[],firstIds:[],secondIds:[]}`，四类参与人均为非空业务工号数组。岗位必须属于部门或下级组，人数校验岗位编制。创建候选人 `{id?,req,name,phone,email?,source?,education?,years?,workRegion?,workplace?}`，初始阶段固定 HR 筛选。

当前每名员工只按一个直属组织和一个岗位管理，岗位必须属于该直属组织。`secondaryDept` 已停止新增、修改和导入；旧值仍随详情返回，供历史核对，不参与当前组织筛选。组织结构按现有钉钉抄录资料保留；花名册模板中并排的部门、组别、职位候选列不代表岗位归属，不据此批量建岗。

## 状态操作

组织新建与编辑共用校验：父级须启用，同一父级下名称不能重复，禁止组织循环；根组织仅公司类型、无父级且启用。归档要求无未归档子组织（包括停用子组织），无人员、岗位、需求、资产、账号和职级范围引用。组织停用与归档的规则分别检查。

员工 `actualRegular` 不得早于 `entry` 或晚于北京时间今天；`supervisorId` 不得产生直接或间接循环。工作经历每个非空行必须填写公司和开始日期，起止日期不得倒序或晚于今天，全部行校验成功后才替换原记录。成长记录新增/编辑均要求有效 `date` 和非空 `type/title/detail`。

员工写入兼容 `supervisor`/`supervisorId`（均为员工业务编号）、`graduated`/`graduation`、`mainDept`/`mainDeptId`、`dept`/`directOrgId`；`location`/`workRegion` 和 `company`/`contractCompany` 也会在 patch 合并前同步，避免旧记录的同义字段覆盖本次修改。成对字段同时传入时以前述 canonical 字段 `supervisorId/graduation/mainDeptId/dept/location/company` 为准。员工读取同时返回这些别名，另有 `supervisorName` 仅用于显示；仅修改直属组织而未传主部门时，服务端推导新主部门。

用工类型 `workType` 支持全职、兼职、外包、实习、劳务派遣、其它，读写/导出使用原型名称，审计使用 `FULL_TIME/PART_TIME/OUTSOURCED/INTERN/LABOR_DISPATCH/OTHER`；未知非空值返回 400，不静默降级为全职。

统一 `POST /{type}/{id}/actions/{action}`，响应更新后的实体。

| type       | action                                     | 正文                                                                                                                |
| ---------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ---------- | -------------- | ------------ | ------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------- |
| candidates | screening                                  | `{result:'通过'                                                                                                     | '未通过'   | '退回'         | '暂缓'       | '候选人取消',reason}`                |
| candidates | schedule                                   | `{date:'YYYY-MM-DD',start:'HH:mm',end:'HH:mm',interviewerIds:[],method,place}`                                      |
| candidates | interview-check                            | 与 schedule 相同时间和面试官字段；只读返回 `{available,conflicts:[{interviewerName,candidateName,date,start,end}]}` |
| candidates | interview-result                           | `{interviewId?,result:'通过'                                                                                        | '未通过'   | '待定'         | '候选人取消' | '未到场 / 改期',evaluation,scores?}` |
| candidates | interview-cancel                           | `{interviewId?,reason}`                                                                                             |
| candidates | onboarding                                 | `{action:'确认入职'                                                                                                 | '延期入职' | '调整入职日期' | '未到岗'     | '放弃入职'                           | '取消入职' | '重新安排入职',onboard,employeeId?,grade?,workRegion?,workplace?,contractCompany?,entryNotes?}` |
| assets     | assign / transfer                          | `{owner,reason,version?}`                                                                                           |
| assets     | return / repair-start / repair-end / scrap | `{reason,version?}`                                                                                                 |
| assets     | location                                   | `{workRegion,office,reason,version?}`                                                                               |
| emps       | leave                                      | `{leaveDate,reason,version?}`                                                                                       |
| emps       | timeline                                   | `{date,type,title,detail}`                                                                                          |
| emps       | timeline-update                            | `{timelineId,date,type,title,detail}`                                                                               |
| emps       | timeline-delete                            | `{timelineId}`                                                                                                      |

另有兼容路由 `/candidates/{id}/screening`、`/candidates/{id}/interviews`、`/candidates/{id}/onboarding`、`/interviews/{interviewDbId}/result`、`/emps/{id}/timeline` 和 `/assets/{id}/actions`（正文 action 大小写兼容 ASSIGN/RETURN/TRANSFER/REPAIR_START/REPAIR_END/SCRAP/LOCATION）。

- `POST /candidates/actions/batch-screening {ids:业务编号数组,result,reason?}` → `{items:更新后候选人数组,count}`。选择 1–200 个不重复编号；排序加锁并预检全部记录的数据范围、阶段、需求状态与指定负责人，再同事务处理，任一失败全批不提交。
- 面试反馈 `interviews[].votes` 按 `operatorId` 更新当前账号的意见（兼容历史 `operator`），保留其他面试官意见；通过/未通过等最终结论仍按原型推进本轮状态。
- 调整面试时间/人员会追加 `interviews[].changes:[{date,operatorId,operator,before:{date,start,end,interviewerIds,interviewer,method,place,status,result,evaluation}}]`；历史快照不递归嵌套 `changes`。
- 资产动作正文只接收版本、位置与办理原因；`owner` 仅领用/转移使用，归还由状态机清空。维修、报废和位置调整不会因通用表单附带空 `owner` 而改变现有领用人，也不接受夹带的名称、状态或公共资产属性修改。
- 所有入职处理动作只要传入 `onboard`，均校验其为有效日期且不早于候选人录入日；确认、延期和重新安排必须传入日期，延期/重新安排不能早于今天。独立取消确认框不传日期仍允许，保留原计划日期。

## 导入与简历

招聘需求模板保持原型 14 列，不额外添加 HR 负责人列。导入新增行未指定负责人时，使用当前登录账号关联的有效在岗员工；更新行缺省负责人则保留原关联。显式指定但无效的负责人报行错误，不使用默认值替代。账号未绑定员工时返回明确行错误；不按账号显示名猜测员工。

- `POST /imports/{emps|assets|reqs|grades|timeline}`：`{fileName,fileHash:SHA256,rows:原型字段对象数组,employeeId?,mode:'update'|'skip',validateOnly:boolean}`。
- 返回 `{duplicate,importId?,added,updated,skipped,errorCount,rows:[{index,action:'新增'|'更新'|'跳过'|'错误',errors:[],warnings:[],data}]}`。
- 预校验不提交任何业务记录或导入日志；正式导入逐行事务，合法行可提交，错误行保留报告。相同类型和文件哈希不重复入库，日志仅保存行号、业务编号/姓名标签及错误信息，不保存原始敏感单元格。
- 员工导入 `householdType` 支持持久化、授权档案读取和导出；工作片区/合同归属同时规范化核心字段与原型同义字段，旧别名解析为当前启用名称。空单元格不覆盖已有值，哈希幂等行为不变。
- `GET /imports/{type}/logs?page=1&size=20` → `{items,total,page,size}`；仅 HR 且具备 `imports:write`，单页最多 100。
- `GET /imports/{type}/logs/{numericId}` → 日志详情，ID 与类型同时匹配，不匹配返回 404。列表/详情字段 `{id,fileName,fileHash,status,createdAt,operatorName,total,added,updated,skipped,errorCount}`，详情增加 `rows:[{index,action,label,errors,warnings}]`；历史日志无 `label` 时返回空字符串。
- `POST /imports/{type}/parse`：multipart `file` → `{headers,rows:二维数组,headerRow,sheetName}`，支持 XLSX/XLS。
- `POST /resumes/parse`：multipart `file` → `{name,phone,email,raw,issue,parsed}`，支持 PDF/DOC/DOCX/TXT，扫描文件返回人工核对提示，不虚构解析结果。
- `POST /resumes`：multipart `file` 和 `data`（JSON 字符串，候选人字段），候选人和材料元数据同事务创建。

## 附件与设置

- `POST /{emps|candidates}/{id}/files`：multipart `file,category`；返回 `{id,name,size,category,url}`。
- `GET /{emps|candidates}/files/{fileDbId}` 下载，`DELETE` 同路径软归档。
- PDF 和图片预览使用同一文件路径加 `?inline=true`，对应 `previewUrl`；其他类型保持下载，鉴权与下载审计相同。
- `GET/PUT /settings/{workRegion|workplace|contractCompany}`：`{items:[{id?,name,status:'启用'|'停用'}]}`；字典改名保留 aliases 并同步引用，缺省项目停用。
- `DELETE /settings/{workRegion|workplace|contractCompany}/{itemId}`：有业务或历史引用返回 409，未使用项目删除并记录审计。
- `GET/PUT /settings/sequences`：`{items:string[]}` 维护列表；新增未使用序列也持久保留，已引用项不能删除。显式改名提交独立正文 `{rename:{from,to}}`，事务同步职级和岗位（含历史记录）的序列引用与版本并记审计，返回 `{items}`。空名/重复名称返回 400，改名目标已存在返回 409；`bootstrap.sequences` 与此接口读取同一配置。
- `GET/PUT /settings/reminders`：`{enabled,workdays,times:['10:00'],channel}`；时间必须为 1–3 个不重复的严格 `HH:mm` 值，当前站内待办规则，无外部通知发送。
- `GET/PUT /preferences/{route}`：当前用户列显示、筛选方案 JSON，PUT 按传入键进行事务合并，保留其它设置。
- `POST /audit/export {type,ids:业务编号数组,columns}`：验证全部数据范围后写导出审计。

## 配置和初始化

读取 `DB_URL`、`DB_USERNAME`、`DB_PASSWORD`、`HR_ENCRYPTION_KEY`（Base64 的 32 字节 AES 密钥）、`HR_UPLOAD_DIRECTORY`、`HR_ALLOWED_ORIGINS`、`SERVER_PORT`。dev/test/prod 分开配置。MySQL 迁移 V1 是设计文档全部 SQL，移除 DROP/CREATE DATABASE/USE/关闭外键的初始化包装；V2 只补业务所需的 RBAC、版本、扩展、多负责人和附件结构；V3 仅追加两项用工类型枚举，保留 V1 的四个值及顺序，不修改旧迁移文件。

真实组织和三个字典在所有环境初始化。`HR_SEED_DEMO=true` 仅非 prod 导入原型虚构人员、岗位、招聘和资产；已经完成原型种子初始化时，仅为尚未绑定员工的 admin 关联原型既有 HR 负责人 `E0005`，不改员工姓名、不新建员工、不覆盖已有绑定。`许 HR` 是账号显示名，不是员工主键。初始账号由 BCrypt 哈希存储，可用 `HR_INITIAL_ADMIN_PASSWORD`/`HR_INITIAL_MANAGER_PASSWORD` 设置；prod 拒绝默认弱密码。生产不会导入示例人员，也不会自动绑定模拟员工。应用使用 UTC 存储操作时间，业务日期和面试时间以 Asia/Shanghai 解释。
