# 人力资源平台

目录与独立端口已调整，实际迁移、数据校验和最终 5180 登录验证见 [目录迁移记录](docs/directory-migration-2026-09-23.md)。

系统根目录为 `D:\5-HR\HR_system`。Vue 3 前端位于 `frontend`，Java 17 / Spring Boot 后端位于 `backend`，数据库使用 MySQL 8.4。本文未特别注明的路径和命令均以系统根目录为基准，不再从外层 `D:\5-HR` 执行。

此前三个导入问题已经修复，并通过新的真实模板复测：招聘需求自动关联当前 HR 负责人、花名册户籍类型完整保存、已重命名字典的旧别名正常匹配。五类导入矩阵 29 项通过，58 列模板中实际填写的 56 个字段全部回读一致。其余全交互验收状态见 [修复复测报告](docs/fix-regression-2026-09-23.md)，不将导入通过等同整个系统投产通过。此前数据库中断的原因与经授权修正见 [MySQL 进程隔离记录](docs/mysql-process-isolation-2026-09-23.md)；修复前结果保留在 [历史回归报告](docs/local-test-2026-09-23.md)。

原始资料仍在上一级目录：[项目规则](../AGENTS.md)、[开发设计文档](../人力资源平台一期开发设计-V1.0.0.md)、[交互原型](../人力资源平台原型-v1.html)。详细原型范围见 [验收矩阵](docs/prototype-acceptance.md)，后端契约见 [API 文档](backend/API.md)。

业务口径（2026-09-23）：现有组织结构由钉钉抄录，按公司真实组织结构保留。当前每名员工只使用一个直属组织和一个岗位，岗位归属该组织；“兼任部门”停止录入，已有值仅供历史核对。人事花名册模板中的部门、组别、职位候选列各自独立，不按同行位置推断岗位归属；其他尚未核定的数据暂按现状保留。

## GitLab 同步

私有仓库：`yuyun/hr-platform`（当前账号无权在 `awsadevlop` 组建项目）。本机计划任务 `HR-System-GitLab-Sync` 每天 19:00 运行 [同步脚本](scripts/sync-gitlab.ps1)：有改动时先通过 Java 测试和前端构建，检查期间工作区继续变化则跳过；通过后提交并推送 `main`。无改动时只推送待同步提交。失败会保留本地代码和提交，记录在 `.local/gitlab-sync.log`，下次运行重试；`.env`、本地数据库和构建产物不会提交。也可从系统根手动运行 `pwsh -NoProfile -File ./scripts/sync-gitlab.ps1`。

## 本地开发

需要 Java 17、Maven 3.9+、Node.js 24、pnpm 11.25、PowerShell 7。当前 Windows 工作区已安装 Java、Maven 和 Node，脚本可自动定位随环境提供的 pnpm。

```powershell
Set-Location D:\5-HR\HR_system

# 首次执行：下载并验证便携 MySQL，在项目内初始化开发库和测试库
./scripts/bootstrap-dev.ps1

# 构建并在后台启动后端；日志在 .local/backend*.log
./scripts/start-backend.ps1

# 启动前端开发服务器，保留这个终端
./scripts/start-frontend.ps1
```

访问 [本地系统](http://localhost:5180/)，也可使用 [127.0.0.1:5180](http://127.0.0.1:5180/)。开发前端已改为 `5180`，不再使用 `5173`；开发后端仍监听 `127.0.0.1:8090`，本地数据库仍绑定 `127.0.0.1:3307`，不安装 Windows 系统服务，不修改现有 MySQL。数据库数据、上传文件与日志位于系统根的 `.local`；随机生成的连接密码和 AES 密钥存于系统根的 `.env`，该文件不提交版本控制。再次运行初始化脚本只启动已有实例，不清空数据。前端端口被占用时会明确报错，不会自动切到其它项目的端口。

初始账号仅在本说明中提供，登录界面没有账号提示或快捷登录：

| 用户名  | 初始密码   | 权限                         |
| ------- | ---------- | ---------------------------- |
| admin   | admin123   | 许 HR，全部模块及公司数据    |
| manager | manager123 | 林主管，开发部及下级组织范围 |

菜单和按钮来自服务端权限，数据范围由服务端计算。账号菜单支持修改当前密码和退出；修改密码会使旧会话失效。初始密码仅在首次创建账号时写入哈希，不会覆盖后来修改的密码。

```powershell
./scripts/verify.ps1            # Java 单元测试、打包、锁定依赖安装及 Vue 生产构建
./scripts/stop-dev.ps1          # 停止本项目后端
./scripts/stop-dev.ps1 -Database # 同时正常关闭项目 MySQL，保留数据
```

## 真实 MySQL 验收

写入验收只使用独立 `hrms_test`，不会往开发库或生产库写测试人员。测试记录带唯一前缀，保留在测试库便于追踪。

```powershell
Set-Location D:\5-HR\HR_system
./scripts/start-test-backend.ps1 # 测试后端 8091；迁移、演示种子初始化完成后才健康
./scripts/start-frontend.ps1 -Test # 另一个终端，测试前端 5175 → 8091

# 首次浏览器验收前，从系统根安装浏览器：
pnpm --dir ./frontend exec playwright install chromium
# 在第三个终端从系统根目录运行
node ./scripts/api-acceptance.mjs
node ./scripts/security-acceptance.mjs
node ./scripts/settings-acceptance.mjs
node ./scripts/configuration-acceptance.mjs
node ./scripts/browser-acceptance.mjs
$env:HR_BROWSER_ONLY='exports'
node ./scripts/browser-acceptance.mjs
$env:HR_BROWSER_ONLY='preferences'
node ./scripts/browser-acceptance.mjs
Remove-Item Env:HR_BROWSER_ONLY
node ./scripts/auth-contract-acceptance.mjs # 单独运行；finally 恢复测试主管原密码

# 导入专项；断言失败会报告具体场景并返回非零退出码
node ./scripts/import-matrix-acceptance.mjs
node ./scripts/import-field-roundtrip.mjs
node ./scripts/import-alias-acceptance.mjs
node ./scripts/csv-acceptance.mjs
node ./scripts/reminder-acceptance.mjs
node ./scripts/resume-acceptance.mjs
# 新增的交互/工作流/字段与格式专项
node ./scripts/interaction-acceptance.mjs
node ./scripts/workflow-ui-acceptance.mjs
node ./scripts/module-crud-acceptance.mjs
node ./scripts/workflow-branches-acceptance.mjs
node ./scripts/editor-contract-acceptance.mjs
node ./scripts/import-contract-acceptance.mjs
node ./scripts/legacy-format-acceptance.mjs
node ./scripts/legacy-doc-acceptance.mjs
# 也可串行执行分组：imports / api / browser / visual / formats / auth；不传组名执行 all
node ./scripts/full-regression.mjs imports
./scripts/stop-dev.ps1 -Test
```

浏览器测试依赖已锁定在 [frontend/package.json](frontend/package.json)，默认从 `frontend/node_modules` 加载，不依赖 Codex 专用运行时。可用 `HR_NODE_MODULES` 覆盖依赖目录，或用 `HR_BROWSER_PATH` 指定现有 Chromium 可执行文件。真实浏览器验收默认访问 `5175`，并核实会话属于 `8091`。密码和全局配置验收应串行执行，避免测试之间互相覆盖；密码脚本单独运行并在结束后恢复测试账号原密码。

截图及 JSON 结果在 `.local/verification`。像素核对另用 `scripts/prototype-capture.mjs`、`scripts/prototype-forms.mjs`、`scripts/visual-acceptance.mjs` 和 `scripts/visual-controls.mjs`；它们读取上一级的原型，以固定数据比较外观，不代替真实数据库验收。前端源码格式检查从系统根执行 `pnpm --dir ./frontend format` / `pnpm --dir ./frontend format:check`；原型 CSS 和提取元数据不参与格式化。

## 配置和部署

[.env.example](.env.example) 列出开发配置。Spring 在 `backend/src/main/resources` 中使用 `dev`、`test`、`prod` 三个环境文件；数据库连接及密钥均从外部环境传入。生产环境禁用演示数据。生产启动与备份说明见 [部署手册](docs/deployment.md)，实际验收结果见 [验证记录](docs/verification.md)。

原型人员、岗位与候选数据仅用于明确启用 `HR_SEED_DEMO=true` 的开发/测试库。生产迁移初始化正式组织、工作片区、工作所在地、合同归属和权限表，不将推断岗位归属或虚构人员当作公司真实资料。

## 项目结构

```text
D:\5-HR/
├── AGENTS.md、原始设计文档、原型 HTML  # 保留的原始资料，不属于前端源码
└── HR_system/                       # 系统根目录，所有启动命令从此执行
    ├── README.md
    ├── frontend/                    # Vue、静态资产、package.json、依赖锁、test-artifacts
    ├── backend/                     # Java API、pom.xml、Flyway 迁移、API.md
    ├── scripts/                     # 初始化、启动、停止与跨端验收工具
    ├── deploy/                      # 容器构建、Nginx 与生产 Compose 配置
    ├── docs/                        # 部署、原型范围与验证说明
    ├── .env                         # 本机连接信息及密钥（不提交）
    ├── .local/                      # 本机数据库、上传、日志和截图（不提交）
    └── .tools/                      # 本机便携 MySQL（不提交）
```

旧结构中的 `D:\5-HR\HR_system` 仅代表前端，现在该路径代表整个系统，原前端内容已在 `frontend` 中；原 `D:\5-HR\HR_backend` 对应现在的 `backend`。原外层 `scripts`、`deploy`、`docs`、`.local`、`.tools` 与环境文件均收拢至系统根，不应再使用旧的绝对路径启动服务。

历史 JSON 报告中的绝对路径与 `5173` 开发端口保留执行当时的值，查找文件时请按上述对应关系定位；文档中的证据链接已指向迁移后的实际位置。当前开发入口为 `http://localhost:5180/`，测试前后端仍为 `5175` / `8091`。目录迁移本身不代表重新验收；后续修复及新执行结果与历史报告分开记录。

用户提供的 SQL 建表定义见 `backend/src/main/resources/db/migration` 的首个 Flyway 迁移；危险的删除旧库表包装语句没有进入应用启动流程。后续补充字段与权限结构通过增量迁移管理。应用启动不执行 schema 重建，不使用 H2 冒充 MySQL 验证。
