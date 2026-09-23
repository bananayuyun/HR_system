# 前端交互核查与证据索引

本清单按最终原型覆盖层及 `docs/prototype-acceptance.md` 核查，不把“已有按钮/绑定事件”算成真实测试通过。账号登录、权限与数据范围按用户明确要求替代原型视角切换。新增交互验收只允许 `5175 → 8091`，不操作开发库；最终事件结果以 `.local/verification/interactions/merged-report.json` 为准，补充模块结果以 `.local/verification/module-crud/merged-report.json` 为准，原始失败与定向复测保留供追溯。

## 本轮已定位并修复的事件缺口

| 编号 | 原型依据/现象 | 修复位置 | 验证项 |
| --- | --- | --- | --- |
| F01 | 3828：导入下拉应含导入记录，原实现直接打开上传 | EntityTable、ImportRecords、App | 四模块菜单、真实记录/明细/返回 |
| F02 | 3802–3806：组织人员查询、重置、15/30/50/100分页缺失 | App | 查询空结果、重置、下一页序号 |
| F03 | 招聘需求候选入口跳转后被 route watcher 清空需求筛选 | App | 所有行属于点击的需求且数量一致 |
| F04 | 3778–3790：上传/预览/成长编辑删除等子抽屉关闭未返回原详情 | App、DetailDrawer | 子窗关闭返回同一档案原页签 |
| F05 | 脏表单 hash 跳转直接被关闭，无保留/放弃选择 | store、DialogFrame | 继续编辑保留输入、放弃后跳转 |
| F06 | 3666：表格全屏按钮标题不更新；跨页空选择也显示半选 | EntityTable | 全屏/Escape、跨页半选、全选 |
| F07 | 3832：组织搜索需保留匹配节点祖先 | OrgTree | 搜索组同时显示部门/公司 |
| F08 | 设置编辑取消绕过未保存确认 | SettingsView | 取消→继续/放弃，未保存数据不落库 |
| F09 | 3625+嵌套恢复：取消重命名应回序列管理 | SequenceDialog | 重命名取消后管理列表仍在 |
| F10 | 批筛逐条写入，失败前记录已被修改 | WorkflowDialog + 后端新原子接口 | 一次请求处理全部、陈旧选择整批回滚 |
| F11 | 未保存确认不接收焦点；抽屉初始 Shift+Tab 可能逃出 | DialogFrame | 焦点循环、确认初始焦点、Escape保留 |
| F12 | 归档员工仍出现在新负责人/主管/资产候选列表 | schema、EntityEditor、WorkflowDialog | 排除软归档；资产排除待离职人员 |
| F13 | 新增招聘需求未按最终原型默认开发部 | App | 合法范围默认部门，岗位包含下级 |
| F14 | 新组织保存后未选中新节点、删除选中组织未回上级 | App、OrgTree | 组织新增/编辑/删除真实UI回读及选中 |
| F15 | 空列偏好 `[]` 被当有效配置导致全表列消失 | EntityTable | 空配置回默认，至少保留一列 |
| F16 | 导入/简历footer、资产模式切换自建确认层未进入焦点循环 | DialogFrame、ImportDialog、ResumeBatchDialog、EntityEditor | 统一同一确认层，导入取消与资产切页签的Escape/继续/放弃 |
| F17 | 任职编辑用主管姓名作选项值、毕业日期与主部门别名不一致 | EntityEditor + 后端字段兼容 | 非空主管FK/毕业日期初值与无关编辑保留 |
| F18 | 面试待定后重开结果未回填本人已有意见；最终原型4465–4466明确回填 | WorkflowDialog | reviewer真实修前PNG/JSON、workflow-ui重开断言 |
| F19 | 资产维修/位置动作也发空owner，可能清掉持有人 | WorkflowDialog + 后端按动作字段白名单 | 只assign/transfer发owner；后端合同专项覆盖 |
| F20 | 组织树底部三点菜单未限制位置，删除按钮超出视口；原型3716会按菜单实际尺寸钳制 | OrgTree | 底部新组织正常点击编辑/删除、菜单边界坐标、修前后截图 |

## 共享交互逐项覆盖

| 可见交互 | 实现 | 自动化证据/待补范围 |
| --- | --- | --- |
| 手动登录、错误密码、退出、会话失效 | App/api/store | browser-acceptance、api/security；密码专用受控用例不并行 |
| 11菜单、菜单搜索、组展开/折叠、侧栏收起、刷新路由 | App | interaction：11 routes、3组逐个折叠/展开、无匹配菜单及恢复 |
| 小屏导航开合、表格横向滚动、关闭按钮可达 | App/原型CSS | interaction：1280及390视口 |
| 关键词Enter、查询/重置、展开/收起筛选 | App | browser-acceptance、visual-controls、interaction |
| 字典、部门/组织、日期、阶段筛选与计数 | App/FieldControl | 代码逐条件核查；日期和招聘阶段由workflow-ui补充 |
| 高级筛选六运算、全部/任一、增加/删除条件 | AdvancedFilter/App | interaction：3个独有岗位的精确ID集合断言，六运算含大小写、全部交集/任一并集、清空恢复；空值禁用及必填 |
| 筛选方案新增/同名校验/保存/加载/删除 | AdvancedFilter | interaction + browser preferences 持久化 |
| 点击列头升/降序 | EntityTable | interaction：名称排序与数值比较配置 |
| 单选/本页全选/半选、跨页选择 | EntityTable | interaction：当前页半选正确 |
| 15/30/50/100、上一页/下一页、页码/跳页边界 | EntityTable | interaction：四种页长实际行数、上下页、0/9999跳页边界 |
| 列显隐、全选、取消/确认、至少一列 | EntityTable | browser-acceptance、interaction |
| 列拖动/方向键、左右固定/累计偏移、窗口变化 | EntityTable | interaction：真实dragTo前后精确顺序、后端偏好及刷新表头顺序；方向键、双列固定及resize |
| 恢复默认二次确认/取消 | EntityTable | interaction、visual-controls |
| 表格/抽屉全屏、Escape、键盘焦点 | EntityTable/DialogFrame | interaction；抽屉Escape按最终原型关闭，不自改为退出全屏 |
| 嵌套编辑/上传/导入/预览关闭返回原页签 | App/DetailDrawer | interaction + browser DOCX/附件专项 |
| 未保存关闭/导航/资产切页签、继续/放弃 | DialogFrame/EntityEditor/Import/Resume | interaction；切页签仅取消/放弃，不重复业务领用闭环 |
| 表单required/格式/联动/服务端错误反馈 | EntityEditor/WorkflowDialog | interaction、workflow-ui、API边界回归；不把前端校验当权限 |
| 导入选择→映射→预检→确认→结果/记录/明细 | ImportDialog/ImportRecords | import-matrix、field-roundtrip、csv、interaction |
| 模板下载、别名匹配、重复跳过/更新、空值保留 | ImportDialog | import-matrix、import-alias、import-contract |
| 导出筛选/选中、58列及敏感授权/审计 | App/export-workbook | browser exports + API/security |

## 11模块事件清单

下面“代码已接线”只说明组件到实际API的事件链存在。真实成功/拒绝以对应报告结果为准。

| 模块 | 逐项可见入口/动作 | 实现与证据 |
| --- | --- | --- |
| 花名册 | 组织树搜索/折叠/选中/整树收起；新增；导入菜单与记录；归档视图切换；导出/全屏/列设置；查看/归档/恢复 | OrgTree/App/EntityTable；interaction归档恢复、browser基础、imports矩阵 |
| 花名册档案 | 个人信息/档案材料/成长记录/领用资产；更多→导出档案/维护日志；全屏分区跳转 | DetailDrawer；interaction页签/全屏、browser导出/权限 |
| 10档案分区 | 基本、任职、个人、学历、合同、社保公积金、银行、紧急联系人、材料登记、工作经历；分别编辑/取消/保存 | EntityEditor；interaction逐分区真实保存及无关字段保持；敏感字段授权回读 |
| 工作经历 | 添加一段、删除一段、日期/公司必填、保存多段数组 | EntityEditor；interaction结构化写入/删除/缺失日期反馈 |
| 档案材料 | 类别上传、原文件预览/下载/删除确认；DOCX文本、PDF/图片 | DetailDrawer/WorkflowDialog；browser docx/附件专项 |
| 成长记录 | 新增/编辑/删除/导入 | WorkflowDialog/ImportDialog；interaction CRUD+导入入口、import-matrix timeline |
| 员工资产 | 查看所领资产、归还、转移 | DetailDrawer/WorkflowDialog；workflow-ui+API事务 |
| 组织 | 树新增菜单/部门；三点编辑/删除；信息/人员页签；查询/重置/翻页/查看；创建编码/父组织只读 | App/OrgTree/EntityEditor；interaction人员区与代码状态修复 |
| 岗位 | 新增/查看/编辑/日志；详情删除；部门→直属组织联动；编制/在编/在途；字段必填 | EntityEditor/DetailDrawer/WorkflowDialog；browser岗位创建、module-crud真实编辑/详情/日志/无引用删除、API约束、interaction联动 |
| 职级 | 序列/搜索/高级筛选；新增/导入/记录/导出；图谱↔列表、点图谱编辑；详情删除 | App/EntityEditor；module-crud真实新增/编辑/刷新/无引用删除、interaction图谱入口、import-matrix grades、API引用限制 |
| 职務序列 | 新增/重命名/删除；取消重命名返回管理；使用中拒绝删除 | SequenceDialog；sequence-acceptance、interaction嵌套返回 |
| 基础设置 | 片区/所在地/合同归属三页签；查询/重置；新增/改名/启停/删除与确认；引用限制 | SettingsView；interaction三字典真实UI CRUD，settings/API别名同步与引用拒删 |
| 招聘需求 | 四指标；新增/编辑/查看；招聘中/暂停/关闭；4类多负责人；编制校验；导入/记录；候选人数入口 | App/EntityEditor；module-crud真实无候选需求新增及三状态编辑；interaction候选入口/默认部门；workflow-ui、import-contract；最终原型无删除入口，不新增按钮 |
| 简历库 | 批量录入、需求/来源/地点必填、选择文件/逐份核对/预览/提交；查看/删除；4详情页签；编辑候选信息 | ResumeBatch/DetailDrawer；module-crud两份真实DOCX选择/解析/人工核对/预览/提交、刷新详情预览及原文件下载字节核对、TXT拒绝；resume-acceptance+workflow-ui；录用页签不删、不假造Offer审批 |
| 简历筛选 | 阶段页签；查看/编辑；详情暂缓/不通过/取消/通过；批量；HR→主管→初试 | WorkflowDialog；interaction原子批量；workflow-ui全部单人分支及权限 |
| 提醒规则 | 规则入口两处；启停/工作日/每天/最多3时间；收件人汇总；消息预览；保存 | ReminderDialog；reminder-acceptance 真实UI；只配置与预览、不宣称已发送 |
| 面试 | 阶段/专用筛选；查看；安排/改期；检查冲突；结果5类；2页签；候选详情现有取消安排 | WorkflowDialog/DetailDrawer；workflow-ui全部状态分支、API并发/权限 |
| 入职 | 5状态页签；查看3页签；确认/办理/取消；延期/调整/未到岗/放弃/重排；主管只读 | WorkflowDialog/DetailDrawer；workflow-ui全部分支、API事务/重复入职 |
| 资产 | 新增/导入/记录；查看/编辑/二维码；编辑基本/领用/转移/归还；维修/报废状态；导出标签/表格 | EntityEditor/WorkflowDialog；workflow-ui资产UI、browser QR、API离职资产约束 |

## 验证边界

像素比较由主代理统一执行，本清单不把事件通过等同像素一致。现有截图基准覆盖默认11页、共享控件和代表性抽屉；本轮恢复的导入菜单/记录、组织人员分页、未保存确认等须在根回归统一重拍。上表标记 interaction 的新增用例已写入脚本，是否执行通过必须读取本轮 report.json，不因本清单已列出而视为通过。每种字段组合、每个窗口尺寸、每列全部排列没有穷举，不将“所有可见动作已枚举”表述成“所有组合已经自动化验证”。无可见入口的旧五维评分、旧Offer审批、日历下载不增加回界面。

## 2026-09-23 最终事件回归结果

`scripts/interaction-acceptance.mjs` 的 42 个不同用例最终全部通过，浏览器 JavaScript 错误为 0。证据汇总为 `.local/verification/interactions/merged-report.json`，逐项标出使用全量还是定向结果。全量报告保留为 `report.json`（40 通过、2 未通过）；修正组织菜单真实缺陷及测试驱动后，`targeted/report.json` 的 4 项全部通过，用来替换同名结果，不叠加算作 46 项。

首次驱动失败、第二轮业务定位及截图均保留：`first-all-driver-observations.json`、`second-all-before-menu-fix.json`、`organization-menu-before-fix.png`。修后底部菜单截图为 `targeted/organization-bottom-menu.png`，全程正常点击，没有 `force` 绕过可达性。工作经历已实际验证缺日期拒绝、日期选择、数组保存回读、删除保存。组织删除按真实软归档契约断言 `deleted=true`、`deletedAt` 存在、界面节点消失和选中上级。

本轮只向隔离测试 `5175 → 8091` 写入 `QAINTERACTION…` 独有数据，不修改开发库和账号密码。测试夹具及审计保留用于追溯，岗位列配置和筛选方案在脚本结束时恢复。招聘与资产完整业务分支、导出/附件/认证由其它专项报告记录，不计入本脚本 42 项。

## 2026-09-23 模块有效提交补充回归

`scripts/module-crud-acceptance.mjs` 补齐 6 个不同组合用例，最终 6 通过、0 失败、浏览器 JavaScript 错误 0，汇总在 `.local/verification/module-crud/merged-report.json`。覆盖岗位编辑/详情/维护日志/无引用删除，职级有效新增/编辑/刷新/无引用删除，无候选招聘需求有效新增及暂停/已关闭/招聘中切换，以及两份 DOCX 批量选择、解析、人工核对、预览、确认提交、刷新详情预览和原文件下载。每次保存后均以实际 API 回读，不使用 mock。

原始 `first-run.json` 为 5 通过、1 测试驱动失败：候选列表不展示业务编号，驱动使用编号定位行超时。只修测试定位为编号关键词筛选后的准确可见姓名，未改业务源码。`HR_MODULE_ATTACHMENT_ONLY=1` 复用 `QAMODULEMUDR482T` 已提交候选，定向只读重测 `attachment-retest/report.json` 为 1 通过；合并时替换同名第 6 项，不叠加算作 7 项。完整提交用例已核对后端附件与原上传 buffer 完全一致，定向用例再核对真实 UI 下载与持久化附件字节相同、DOCX 正文准确。

正向文件为两个实际 DOCX，TXT 按最终原型可见入口拒绝，未放开格式。招聘需求最终原型没有删除按钮，本套件不新增或假称 UI 删除覆盖。岗位创建复用 API 夹具，因为基础 browser 套件已经覆盖有效 UI 创建。只写隔离测试库独有前缀，保留需求、候选、附件供审计追溯；无开发库写入、密码修改或新的生产源码变更。
