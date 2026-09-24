# 环境与部署

本文的系统根目录为 `D:\5-HR\HR_system`，所有相对路径和启动命令均以此为基准。前端为 `frontend`，后端为 `backend`；原始规则、设计文档和 HTML 原型保留在上一级 `D:\5-HR`。入口见 [系统 README](../README.md)。此前三个导入缺陷已在后续修复，当前验证范围见 [修复复测报告](fix-regression-2026-09-23.md)；本地通过不代表外部生产部署已经完成。

## 配置契约

| 配置                                                    | 含义                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| SPRING_PROFILES_ACTIVE                                  | `dev`、`test` 或 `prod`                                       |
| DB_URL / DB_USERNAME / DB_PASSWORD                      | MySQL JDBC 连接、用户、密码                                   |
| HR_ENCRYPTION_KEY                                       | Base64 编码的 32 字节随机 AES 密钥；所有实例保持一致          |
| HR_UPLOAD_DIRECTORY                                     | 持久附件目录                                                  |
| HR_ALLOWED_ORIGINS                                      | 允许提交请求的完整来源，逗号分隔，如 `https://hr.example.com` |
| HR_SEED_DEMO                                            | 开发种子开关；生产配置强制关闭                                |
| HR_USER_CENTER_BASE_URL                                 | 必填的用户中心服务根地址；开发环境默认指向 `https://test.medianos.com/smart-site-cloud/user` |
| SERVER_ADDRESS / SERVER_PORT                            | 监听地址和端口，容器为 `0.0.0.0:8080`                         |

敏感信息加密后保存，数据库备份必须同时保留对应 AES 密钥。已有数据不能通过重新生成密钥“修复”启动错误。日志、SQL备份、密钥和上传文件应分别保存，恢复时必须匹配同一数据版本。

## Windows 本地环境

[scripts/bootstrap-dev.ps1](../scripts/bootstrap-dev.ps1) 将 MySQL 安装到系统根的 `.tools`，数据写入 `.local/mysql-data`，只监听 `127.0.0.1:3307`。`hr_app` 仅拥有 `hrms_dev`、`hrms_test` 两个库的权限。开发密钥随机生成后写入系统根 `.env`，实例管理凭据写入 `.local/mysql-admin.cnf`。脚本再次运行不会换密钥或重建数据库。目录迁移后继续使用移动后的既有数据和密钥，不重新初始化一个空实例。

```powershell
Set-Location D:\5-HR\HR_system
./scripts/bootstrap-dev.ps1
./scripts/start-backend.ps1
# 另一个终端切到同一系统根后运行：
./scripts/start-frontend.ps1
```

`scripts/start-backend.ps1` 使用系统根 `.env`，构建 `backend/pom.xml` 并启动 `backend/target/hr-backend-1.0.0.jar`（默认8090），检查 `/actuator/health`。`scripts/start-frontend.ps1` 从 `frontend` 启动 Vite，开发入口为 [http://localhost:5180/](http://localhost:5180/)（[127.0.0.1:5180](http://127.0.0.1:5180/) 也可），将 `/api` 转发到本地后端，因此浏览器 Cookie 与接口同源。当前不再使用开发前端端口5173；后端8090与MySQL3307不变。`scripts/start-test-backend.ps1` 和 `scripts/start-frontend.ps1 -Test` 仍分别使用8091与5175，严格连接独立测试库。不要把 Vite 开发服务器作为生产服务器。

## 生产容器模板

提供 [deploy/compose.yaml](../deploy/compose.yaml)，包含 MySQL、后端与 Nginx；此前本地验收环境没有 Docker，容器模板仍需在目标环境执行下述部署检查。若使用用户提供的独立 MySQL，可只运行 Web 和后端，将 `DB_URL` 指向目标实例，并去掉 Compose 中的数据库依赖。

1. 在系统根复制 [deploy/production.env.example](../deploy/production.env.example) 为 `.env.prod`，填写真实连接密码、独立数据库管理员密码、AES 密钥、初始账号密码及 HTTPS 域名。
2. 在 HTTPS 反向代理后使用 Nginx。模板只把 Web 发布到目标主机 `127.0.0.1:8088`，由现有 TLS 代理转发。应用 Cookie 在 `prod` 环境为 Secure；直接用 HTTP 访问不会建立可用生产登录会话。
3. 运行构建与启动：

```sh
# 在系统根执行；本机 Windows 对应 D:\5-HR\HR_system
docker compose --env-file .env.prod -f deploy/compose.yaml config --quiet
docker compose --env-file .env.prod -f deploy/compose.yaml build
docker compose --env-file .env.prod -f deploy/compose.yaml up -d
docker compose --env-file .env.prod -f deploy/compose.yaml logs --tail=100 backend
```

`database` 不发布端口；后端只在容器网络内可达；`/actuator` 不经过公网 Nginx。数据库与上传目录使用独立持久卷。生产初始化只有真实组织、字典与账号；人员和岗位通过系统维护或导入。

Compose 构建上下文是系统根，前后端源码分别为 `backend` 和 `frontend`。不要把外层原型资料目录或旧的前端单独目录当作 Compose 工作目录。

## 发布与回退

发布前，在测试环境执行数据库迁移和自动化验收。备份数据库与上传卷，记录当前镜像版本和 Flyway 版本，再部署新镜像。Flyway 会按版本校验迁移脚本，已执行的迁移文件不能直接改写；结构变化应增加下一版本 SQL。

应用回退使用上一版本镜像。数据库迁移回退需依据迁移兼容性选择前向修复或从备份恢复，不能通过删除 `flyway_schema_history` 或强制重跑初始化绕过校验。

## 备份和恢复演练

使用 `mysqldump --single-transaction --routines --triggers --no-tablespaces` 备份应用库，密码通过受保护的客户端配置或密钥系统传入，避免放入命令参数。上传目录单独做一致性备份；同时保留 AES 密钥及应用版本。

恢复到新的空库和新的上传目录，配置相同密钥，先运行健康检查，再核对员工数量、附件下载、敏感字段读取、权限和最近审计记录。恢复验证通过后才切换入口；原库保持可回退。不要对已有生产库运行设计文档里的 `DROP TABLE` 包装语句。

## 当前环境边界

本地已使用独立 MySQL、Java 和浏览器完成 29 组综合验收。测试服位于 `http://192.168.8.40:8088/`，当前发布目录为 `/opt/apps/hr-platform/releases/20260924-145012`，数据库 Flyway 至 V15；用户中心登录和 12 个 HR 菜单已在真实测试账号下验证。公司花名册导入映射和模板为 58 列，“导入”下拉菜单与触发按钮对齐，侧栏菜单搜索显示路径结果卡片。简历可以在没有招聘需求时先进入简历库，后续再关联需求；候选人详情可上传并预览原始附件。生产部署与钉钉通知发送尚未进行。测试服业务表当前没有员工、招聘需求和活动候选人数据；导入招聘需求前须先有有效花名册员工作为 HR 负责人。

当前后端以单实例运行，会话存于应用内存；重启会要求重新登录。若目标环境需要多实例，须在部署前接入共享会话存储。当前未进行大规模人员数据的负载测试或目标环境的备份恢复演练。
