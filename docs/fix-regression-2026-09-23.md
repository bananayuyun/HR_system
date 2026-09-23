# 修复与本地交互复测

日期：2026-09-23，收尾检查 15:04。状态：本报告列出的本地功能用例全部通过，三个原始导入问题及本轮发现的业务缺陷均已关闭；原型外观对照存在下文明确列出的内容差异，不声称所有状态逐像素完全相同。

本报告记录修复后的新执行结果，修复前失败保存在 [历史报告](local-test-2026-09-23.md)。测试写入均限定为 `5175 → 8091 → hrms_test`；开发入口为 `5180 → 8090 → hrms_dev`，开发库只做读取、登录和健康检查。

## 三个原始问题

| 问题 | 修复 | 新证据 |
| --- | --- | --- |
| 原型 14 列招聘需求模板无法导入，缺 HR 负责人 | 新增时使用当前账号关联员工；更新未填时保留原负责人；显式无效负责人仍拒绝 | 五类真实模板矩阵 29/29；负责人及导入记录契约 6/6 |
| 花名册户籍类型导入成功但丢失 | 持久化并纳入敏感字段授权读回及默认脱敏 | 实际下载 58 列模板，填写的 56 个字段逐项回读无差异；户籍类型“城镇”敏感接口读回一致 |
| 字典改名后的旧名称被二次规范化覆盖 | 统一旧字段及名称别名的转换顺序 | 当前名、旧片区名、旧合同归属名及无写入检查 4/4；测试字典清理后原配置不变 |

证据：[导入矩阵](../.local/verification/local-round-import.json)、[字段回读](../.local/verification/local-round-import-fields.json)、[别名](../.local/verification/import-alias.json)、[导入契约](../.local/verification/import-contract.json)。

## 全交互检查带出的修复

前端恢复导入菜单与记录、组织人员查询和分页、需求到候选人的筛选跳转、嵌套详情返回、未保存确认、列配置边界、焦点循环、组织树状态以及本人面试待定结果回填。完整动作清单和覆盖边界见 [交互覆盖表](interaction-coverage.md)。

后端补齐原子批量筛选、组织父子与重名约束、转正与入职日期边界、直属上级循环、结构化工作经历与成长记录校验、多面试官意见保留、改期历史、员工字段别名、资产动作字段范围。用工类型新增“劳务派遣”和“其它”的增量枚举，保存与审计显示统一映射；不是将它们静默改为全职。

本地数据库中断已定位到另一个启动脚本按名称停止所有 MySQL。用户批准后只限定该处停止范围，详见 [进程隔离诊断](mysql-process-isolation-2026-09-23.md)。没有共用数据目录，也没有改动另一个系统的数据库。

## 当前已完成的新验证

| 范围 | 结果 | 证据 |
| --- | --- | --- |
| Java 单元测试 | 12 套、73 项，0 失败、0 错误、0 跳过 | `backend/target/surefire-reports` |
| 正式 JAR 与编译结果 | 33 个类/资源逐个 SHA-256 一致 | 14:37 实际核对；包生成于 14:34:23 |
| 五类 XLSX 导入 | 29/29，页面异常 0 | [JSON](../.local/verification/local-round-import.json) |
| 花名册模板字段 | 1 场景，56 个填写字段全部一致 | [JSON](../.local/verification/local-round-import-fields.json) |
| 旧别名 | 4/4 | [JSON](../.local/verification/import-alias.json) |
| 负责人及导入日志契约 | 6/6 | [JSON](../.local/verification/import-contract.json) |
| CSV 真实界面 | 4/4，含 BOM、中文、引号、换行及前导零 | [JSON](../.local/verification/browser/csv-report.json) |
| 员工与资产字段编辑契约 | 10/10，包含两种新增用工类型审计 | [JSON](../.local/verification/editor-contract.json) |
| 业务 API | 12/12 | [JSON](../.local/verification/api.json) |
| 权限、越权、并发及边界 | 14/14 | [JSON](../.local/verification/security.json) |
| 字典 API | 5/5 | [JSON](../.local/verification/settings.json) |
| 序列与提醒配置 API | 4/4 | [JSON](../.local/verification/configuration.json) |
| 完整工作流 API 分支 | 65/65；5 项交由独立专项，1 个最终原型无入口的旧功能不适用，未计为通过 | [JSON](../.local/verification/workflow-branches.json) |
| 简历及附件事务 | 4/4 | [JSON](../.local/verification/resumes.json) |
| 真实 BIFF8 XLS 与文本 PDF | 2/2 | [JSON](../.local/verification/legacy-format.json) |
| 官方有效二进制 DOC | 1/1，原文正确提取；缺失个人信息保持空，供人工填写 | [JSON](../.local/verification/legacy-doc.json) |
| 通用交互与 10 个档案分区 | 42/42 去重项目，页面异常 0；完整执行与必要定向复测合并，不重复累加 | [合并 JSON](../.local/verification/interactions/merged-report.json) |
| 招聘、面试、入职、资产及员工工作流真实 UI | 34/34，页面异常 0，43 次 UI 触发的实际持久化请求 | [JSON](../.local/verification/workflow-ui/report.json) |
| 前端格式与生产构建 | 菜单位置修正后均通过；ExcelJS 分块体积警告仍存在 | 14:45–14:46 `format:check` / `build` |
| 基础真实浏览器 | 8/8，密码独立专项不在此重复计数 | [JSON](../.local/verification/browser/report.json) |
| 导出 | 3/3：花名册 58 列、档案四工作表、主管敏感导出隐藏 | [JSON](../.local/verification/browser/exports-report.json) |
| 筛选方案与列偏好 | 1/1 | [JSON](../.local/verification/browser/preferences-report.json) |
| 主管需求负责人显示 | 1/1，覆盖主管范围外的 HR 姓名服务端解析 | [JSON](../.local/verification/browser/manager-detail-report.json) |
| 职务序列真实 UI | 新增、刷新、使用中改名/拒删、未用删除通过 | [JSON](../.local/verification/browser/sequences-report.json) |
| 提醒配置真实 UI | 4/4，原配置已恢复；未发送真实通知 | [JSON](../.local/verification/local-round-reminders.json) |
| DOCX 附件预览 | 真实上传/下载一致、正文展示、脚本不执行、损坏/超限拒绝通过 | [JSON](../frontend/test-artifacts/docx-preview/report.json) |
| 资产二维码 | 原型协议、单个 SVG、筛选批量可打印 HTML 通过 | [JSON](../frontend/test-artifacts/asset-qr/report.json) |
| 开发入口双账号只读冒烟 | 2/2，真实 `localhost:5180`；HR 11 菜单/168 员工、主管 10 菜单/50 员工；刷新会话有效 | [JSON](../.local/verification/migration-runtime.json) |
| 可见模块 CRUD 与批量简历完整页面链路 | 6/6：岗位编辑/日志/删除、职级增改删、需求状态编辑、两份 DOCX 核对/预览/提交及原文件下载 | [合并 JSON](../.local/verification/module-crud/merged-report.json) |
| 密码及会话 API，独立最后执行 | 3/3：错误旧密码/短密码拒绝、改密使旧会话失效、原始测试密码恢复并验证 | [JSON](../.local/verification/auth-contract.json) |

最后一个后端小修仅改变用工类型的审计显示。14:55 在 14:34 最终 JAR 上重新执行全部 7 组 API，均通过；导入结果来自该审计显示小修前的同轮版本，导入业务实现未再变动。单元测试与 10 项字段契约覆盖该小修。不把此前环境中断或修复前失败报告改写成通过。

主管详情专项首次使用 `R2` 子串定位，匹配到了多条测试数据，产生严格定位失败；只改为精确需求编号按钮，重跑通过。失败保存在 `browser/manager-detail-selector-failure.json`，全组首跑 `full-regression/browser.json` 仍保留 1 个历史失败；该项的最终结论以单独定向报告为准。组织图标、工作经历日期控件和下拉选择器的测试定位修正也保留各次原始报告，未为通过测试而放松业务保存断言。

## 视觉对照

11 个默认页面：10 个在既定比较阈值下差异为 0，基础信息页 0.105% 对应移除离线演示说明。6 类通用控件差异为 0。14 个弹窗/抽屉完成尺寸和字段检查，其中 12 个有截图基准，9 个差异为 0；其余为 0.115%–0.177%。没有基准的资产领用、密码框不冒充逐像素通过。

同数据、同状态、1440×1000 对照，排除账号区域及边界焦点像素；登录账号决定视角、无快捷登录、无右上角切换按钮遵守用户明确要求。这些数字不是“所有状态每个像素字节完全相同”的证明，详见 [设计验收](../design-qa.md)。

## 数据与产物核对

15:04 收尾确认开发库仍为 31 个组织、14 个职级、92 个岗位、168 名员工、4 条需求、18 名候选人、15 项资产。开发和测试库的 Flyway V1/V2/V3 均执行成功；原型、`.env` 和私密 MySQL 连接配置哈希未改变。数据目录 UUID 保持 `54314081-b6f4-11f1-8852-6c1ff75e4d7e`。

当前 JAR SHA-256：`0825A760D76C89D2206947B2452933753B5DA5743BFA3AD3EBE3BA19133E2A2A`。

全部列入本轮的真实浏览器专项和模块 CRUD/简历批量录入补测已通过。需求最终原型没有删除入口，未擅自增加按钮；批量简历页面不支持 TXT，拒绝行为已验证，正向流程使用两份有效 DOCX。候选列表不显示业务编号，末项定位改为精确姓名并复用原有上传夹具定向验证；5 个已通过项没有重复计算。

## 最终运行状态及范围

- 开发前端 `http://127.0.0.1:5180/` 返回 200，后端 `8090` 健康为 UP，独立 MySQL `3307` 正常。
- MySQL server PID 23068 自 14:29:21 至 15:04 未改变，实际 Uptime 2102 秒，完整负载回归期间未再退出。另一系统的 MySQL 未被本任务停止。
- 临时测试前端 `5175`、后端 `8091` 已停止；原测试账号密码和提醒配置已恢复。测试数据、截图、原失败及复测报告留在隔离测试库/忽略目录，供复现；没有删除开发数据。
- 新源码已构建；最后前端构建在组织菜单修正后完成，正式 Java 包与 33 个编译产物一致。没有拿旧进程代替新包验收。
- 密码变更通过真实 API 独立验证；密码弹窗另有打开、结构检查，不把本轮 API 改密写成浏览器成功提交。每个字段的全部组合、任意文件内容和所有分辨率没有穷举。
- 仅进行本地验收；没有外部测试/生产部署，没有真实通知发送，也没有生产负载、目标环境 TLS、备份恢复或多实例演练。此结论不是投产验收证明。
