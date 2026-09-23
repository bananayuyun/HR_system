# 开发进度

## 2026-09-23 多环境配置与数据库脚本整理

- 已核对根目录 README、后端 README、Flyway V1–V5、前端 API 配置与本地脚本。此前没有 PROJECT_STATUS、DEV_PROGRESS、db/schema.sql 或 db/data.sql。
- 后端公共 `application.yml` 已移除数据库连接；`application-dev.yml` 使用本地 `hrms_dev`，保留现有 `DB_URL`、`DB_USERNAME`、`DB_PASSWORD` 覆盖方式。
- 本机 `application-test.yml` 和 `application-prod.yml` 已写入用户指定的真实连接信息，加入 `.gitignore` 并从 Git 跟踪索引移除；仓库保留无密码的 `.example` 模板。未运行 GitLab 同步或访问 GitLab。
- 本地验收入口 `scripts/verify.ps1`、`scripts/start-test-backend.ps1` 已改用 `dev` profile，并继续通过 `TEST_DB_URL` 连接本地隔离库 `hrms_test`。
- 前端已经读取 `VITE_API_BASE`。测试、生产服务器的 API 协议、端口和路径仍待确认；确认后配置环境文件。
- `db/schema.sql`、`db/data.sql` 尚未创建。按用户要求，先提交草稿审查，再落地。未连接任何数据库，也未执行 SQL、构建或部署。

## 已发现的现状差异

- 旧公共配置默认库名为 `hrms`，而本地脚本使用 `hrms_dev`；现已按确认的命名统一。
- 旧后端 README 仍说明生产数据库密码不内置，与本次本机配置要求不一致，后续更新说明时应同时写明真实密码配置仅保存在本机。
- 项目原有 Flyway V1–V5 已定义 28 张业务表及部分预置数据；新的独立 SQL 脚本需要与 Flyway 的职责边界明确，不能修改已执行迁移的校验内容。
- `data.sql` 必须以当前真实基础数据为准；当前不允许执行 SQL，因此还需获得现有数据导出或授权只读查询，不能根据示例数据猜测。

## 待审查草稿

- `.local/review/schema.draft.sql` 是独立审查草稿，未放入 `db/schema.sql`，未执行。根据本机 2026-09-23 的现有结构快照和 Flyway 定义整理 28 张业务表，排除 Flyway 自身的历史表；包含字段/表注释、原有约束与统一的 `utf8mb4_0900_ai_ci`。静态检查确认 28 条 `CREATE TABLE IF NOT EXISTS`，无 `DROP`、`TRUNCATE`、`DELETE` 语句。
- 该草稿仅负责空库建表或已兼容同名表的跳过创建；已有同名但结构不同的表不会被自动修复。它不能与原 Flyway V1–V5 在同一个空库中作为双重建表入口同时使用，使用方式待确认。
