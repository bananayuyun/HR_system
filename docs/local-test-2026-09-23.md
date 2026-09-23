# 本轮本地全量回归

历史报告：下列为 12:13–12:31 的修复前事实。三个导入缺陷已在后续修复，当前状态见 [系统说明](../README.md)，不要将本页旧失败当作最新结果。为防止新执行报告覆盖旧证据，原失败 JSON 已保留至 `.local/verification/pre-fix-20260923`。

执行日期：2026-09-23，12:13–12:31（北京时间）。本次是重新执行测试，不沿用上一轮的通过结论。

目录迁移说明：本文测试事实和时间保持不变，证据链接与下方复测命令已更新为系统根 `D:\5-HR\HR_system`。`frontend`、`backend`、`scripts`、`.local` 均位于该系统根；历史 JSON 内的绝对路径未改写。目录迁移没有修复下列三个导入问题，也不表示已按新结构重跑本报告全部测试。

端口调整说明：当前开发入口已改为 [http://localhost:5180/](http://localhost:5180/)（`127.0.0.1:5180` 也可），开发后端8090、MySQL3307及测试5175/8091不变。本文、历史截图和 JSON 中的5173保留为本次验收当时的事实，不应作为当前访问地址。

## 结论

本地开发服务已部署并可访问：前端 `http://127.0.0.1:5173/`，Java 后端 `127.0.0.1:8090`，MySQL `127.0.0.1:3307`。但是导入验收发现 3 个已复现缺陷（4 个失败场景），不能交付为“所有导入正常”。

全部写入验收使用独立前端 `5175`、后端 `8091`、数据库 `hrms_test`。开发库只执行健康、登录和数据读取检查：31 个组织、14 个职级、92 个岗位、168 名员工、4 条需求、18 名候选人、15 项资产；未混入本轮测试员工。

## 已确认的问题

### 1. 招聘需求模板不能完成新增导入

真实浏览器下载的模板有 14 列，缺少“HR 负责人”。按现有全部必填列填写并上传，预检返回 `added=0, errorCount=1`，错误为 `请选择负责人：owner`。后端要求 `ownerIds`，但模板和列映射没有这个字段。

证据：[五类导入报告](../.local/verification/pre-fix-20260923/local-round-import.json)，其中 `reqs: template XLSX upload...` 为失败；本次原始模板与失败文件已随目录迁移至 [QAIMPORTMUDLI8OS](../.local/verification/QAIMPORTMUDLI8OS)。JSON 的 `files` 字段仍保留执行时的旧绝对路径。API 人工补充 `ownerIds` 后的混合行测试可以通过，但这不能代替用户实际模板流程。

### 2. 花名册“户籍类型”显示导入成功，但保存后丢失

真实界面下载 58 列模板并填写其中 56 列，上传后预检和提交都返回成功（`added=1, errorCount=0`）。输入和导入结果中的 `householdType` 都是“城镇”，但保存后普通详情和敏感信息接口均没有该字段。其余 55 个已填写字段逐项回读一致。

原因是前端模板有该字段，后端字段白名单和敏感信息映射未包含它，保存时被静默丢弃。证据：[字段往返核对报告](../.local/verification/pre-fix-20260923/local-round-import-fields.json)；员工 `QAIMPORTMUDLPS6WFIELDS`，导入批次 25，[原始 Excel](../.local/verification/QAIMPORTMUDLPS6W-58-fields.xlsx) 保留在系统根的 `.local/verification`。

因此，花名册“可以新增并刷新看到员工”并不等于“全部列已完整保存”。这个字段缺陷必须修复后才能通过完整花名册导入验收。

### 3. 花名册使用已重命名字典的旧名称时被错误拒绝

使用同一条合成员工，仅替换工作片区或合同归属的值：当前名称预检通过，已登记的旧别名分别报“基础信息不存在或已停用”。`ImportService` 已转换 `location/company`，随后 `HrService.normalize` 又用原来的 `workRegion/contractCompany` 覆盖转换结果。

此测试只使用新增的 `QAALIAS` 字典项和 `validateOnly`。两条测试字典项已删除并确认原有字典内容完全一致，员工未入库。证据：[别名导入报告](../.local/verification/pre-fix-20260923/import-alias.json)，2 项通过、2 个失败场景，对应同一个缺陷。

## 本轮通过项

| 范围                                    | 本轮结果                                                                       | 证据                                                                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Java 单元测试                           | 23/23，6 个测试类，无跳过；正式 JAR 的 32 个类/资源与当前编译结果一致          | [后端报告](../.local/verification/local-round-backend.json)                                                                                                                                    |
| 主业务 API                              | 12/12                                                                          | [API 报告](../.local/verification/api.json)                                                                                                                                                    |
| 权限、部门范围、并发与导入边界          | 14/14                                                                          | [权限报告](../.local/verification/security.json)                                                                                                                                               |
| 字典维护与引用审计                      | 5/5                                                                            | [字典报告](../.local/verification/settings.json)                                                                                                                                               |
| 序列与提醒配置 API                      | 4/4                                                                            | [配置报告](../.local/verification/configuration.json)                                                                                                                                          |
| 真实浏览器基础业务                      | 8/8，无页面脚本异常                                                            | [浏览器报告](../.local/verification/browser/report.json)                                                                                                                                       |
| Excel 导出                              | 3/3：固定 58 列、选中导出、员工档案四工作表及主管权限                          | [导出报告](../.local/verification/browser/exports-report.json)                                                                                                                                 |
| 列配置/筛选方案、主管需求详情、密码修改 | 各 1/1，旧密码及会话被拒绝，主管密码已恢复                                     | [偏好](../.local/verification/browser/preferences-report.json)、[详情](../.local/verification/browser/manager-detail-report.json)、[密码](../.local/verification/browser/password-report.json) |
| CSV 导入                                | 4/4：BOM、中文、逗号/引号、多行备注、前导零工号；空文件/错误类型/缺表头拒绝    | [CSV 报告](../.local/verification/browser/csv-report.json)                                                                                                                                     |
| 简历解析与附件事务                      | 4/4：TXT/DOCX 解析、损坏文件人工核对、原文件下载一致、非法附件使候选人创建回滚 | [简历报告](../.local/verification/resumes.json)                                                                                                                                                |
| 序列真实界面                            | 新增、改名、刷新、引用保护、未用删除通过                                       | [序列报告](../.local/verification/browser/sequences-report.json)                                                                                                                               |
| 提醒真实界面                            | 4/4：尺寸、可见候选人分组、预览无发送、保存刷新、恢复原配置                    | [提醒报告](../.local/verification/local-round-reminders.json)                                                                                                                                  |
| DOCX 附件预览                           | 上传/下载字节一致、正文预览及损坏/超限输入验证通过                             | [附件报告](../frontend/test-artifacts/docx-preview/report.json)                                                                                                                                |
| 资产二维码                              | 编码协议、单个 SVG、筛选/选中批量可打印 HTML 通过                              | [二维码报告](../frontend/test-artifacts/asset-qr/report.json)                                                                                                                                  |
| 前端格式与生产构建                      | 通过；ExcelJS 分块大小警告不阻断构建                                           | [前端报告](../.local/verification/local-round-frontend.json)                                                                                                                                   |

五类 XLSX 模板均实际下载并核对列数：花名册 58、职级 7、资产 11、招聘需求 14、成长记录 4。花名册、职级、资产、成长记录的真实 UI 上传、预检不落库、确认写入、文件幂等和刷新可见通过；招聘需求模板流程失败，如上所述。矩阵还覆盖五类型缺必填列、混合有效/无效行、空值保留、超过 20MB/2000 行/150 列、损坏表格和主管越权。这些是明确列出的测试场景，不代表所有字段和文件格式均已穷举。

扩展后的导入矩阵最终为 28 项通过、2 项失败（含花名册字段回读）；字典别名专项为 2 项通过、2 项失败。所有失败均保留，没有修改断言使业务缺陷“通过”。

## 外观回归与测试脚本修正

11 个默认页面、6 个共享控件、14 个抽屉已重新检查，页面脚本异常为 0。默认页 10 个在现有像素比较阈值下差异为 0；基础信息页为 0.105%，来自移除原型离线演示说明。抽屉中的面试官实际值、空附件说明仍存在已记录的小差异；不宣称所有状态逐像素一致。详情见前端报告。

真实浏览器首跑的岗位创建超时是测试脚本仍查找旧“开发部”标签；原型和当前组件实际使用“直属部门（无组别）”。只修正了验收脚本，重跑 8 项均通过，没有改业务组件。

提醒专项的首次预期统计包含了归档候选人，而真实界面已过滤归档记录；修正测试预期以使用浏览器同次数据和可见记录后，4 项通过，证据明确记录排除的归档候选人数。没有修改提醒业务逻辑。

## 范围及留存

本轮没有修改业务实现、数据库结构、生产配置或部署到外部环境。新测试脚本保留在 `scripts`，报告、失败 Excel 和截图保留在 `.local/verification`，方便定位和修复后复测。合成业务数据仅保留在隔离测试库；测试用字典临时项已删除，提醒配置恢复，主管初始密码恢复。

12:30:54 最终检查：开发前端 5173、后端 8090 均为 HTTP 200，开发库上述七类数据数量未变，测试前缀员工为 0。临时测试前端 5175、后端 8091 已停止；MySQL 和开发服务继续运行，其他项目进程未操作。

测试日志中的已核查 5 条 ERROR 均是 GET JSON 响应写出时连接被中断，没有对应业务 SQL 异常；日志未记录具体客户端动作，不能把它们全部断言为取消下载。

未执行外部测试/生产部署、生产负载验证或真实通知发送。当前结论是“本地可运行，导入存在已复现缺陷”，不是投产验收通过。

## 修复后定向复测入口

从新的系统根启动本地隔离测试服务，再执行以下脚本；当前业务缺陷未修复时，导入相关脚本返回非零退出码是预期的失败证据。这里更新的是复测入口，不改变本报告记录的原测试时间和结果。

```powershell
Set-Location D:\5-HR\HR_system
./scripts/start-test-backend.ps1 -SkipBuild
# 另一个终端同样切到 D:\5-HR\HR_system 后执行并保持运行：
./scripts/start-frontend.ps1 -Test

# 使用本机已安装的浏览器，或通过 HR_BROWSER_PATH 指定可用 Chromium：
node scripts/import-matrix-acceptance.mjs
node scripts/import-field-roundtrip.mjs
node scripts/import-alias-acceptance.mjs
node scripts/csv-acceptance.mjs
node scripts/reminder-acceptance.mjs
node scripts/resume-acceptance.mjs
```

如果后端实现有改动，必须先生成 `backend/target/hr-backend-1.0.0.jar`；不要用 `-SkipBuild` 对旧运行包宣称修复生效。可先停止占用正式 JAR 的本项目服务再构建，或使用独立构建目录完成打包后安全切换。依赖安装和浏览器配置见 [系统 README](../README.md)。
