# HR Java 后端

Java 17、Spring Boot 3.5.16、MySQL 8 和 Spring JDBC。本目录是系统根 `D:\5-HR\HR_system` 下的 `backend`，不再使用旧的外层 `HR_backend`。接口契约见 [API.md](API.md)，完整启动入口见 [系统 README](../README.md)，部署说明见 [部署手册](../docs/deployment.md)。下列命令均从系统根执行。

## 构建和运行

```powershell
Set-Location D:\5-HR\HR_system
mvn.cmd -f .\backend\pom.xml verify
.\scripts\start-backend.ps1 -SkipBuild
```

启动脚本读取系统根 `.env`，并以 `backend` 为后端进程工作目录，确保示例中的相对上传路径 `../.local/uploads` 指向系统根 `.local/uploads`。不要在系统根直接执行 `java -jar` 并沿用该相对路径。

必须配置 `DB_URL`、`DB_USERNAME`、`DB_PASSWORD` 和 `HR_ENCRYPTION_KEY`。AES 密钥为 Base64 编码的 32 个随机字节；已保存敏感资料之后必须保留原密钥，备份数据库时同时安全备份密钥。使用 `SPRING_PROFILES_ACTIVE=dev|test|prod` 区分环境，生产配置不内置数据库密码，且拒绝默认初始账号密码。

Flyway 自动运行 [src/main/resources/db/migration](src/main/resources/db/migration) 中的版本迁移。V1 保留外层设计文档的建表定义并移除破坏性初始化包装，V2 增加 RBAC 权限点、多负责人、扩展字段、附件与版本。不要修改已经执行的迁移，应新增版本。[src/main/resources/dev/prototype-seed.json](src/main/resources/dev/prototype-seed.json) 是经真实浏览器执行原型最终脚本后导出的虚构人员数据，仅在非生产且 `HR_SEED_DEMO=true` 时初始化；生产只初始化账号、角色、真实组织和共享字典。

## 实现分工

- `Auth`、`WebConfig`、`Scope`：BCrypt 登录、会话撤销、请求来源检查和组织树数据范围。
- `HrService`、`WorkflowService`：实体读写、字段转换、招聘入职和资产状态流程；跨表操作使用事务，更新使用版本或行锁。
- `Crypto`、`Audit`：AES-GCM 敏感字段加密，脱敏前后快照与权限拒绝的独立事务审计。
- `ImportService`、`ResumeService`：XLS/XLSX 预检、逐行事务和批次幂等，以及 Word/PDF 文本提取与原子简历录入。
- `FilesService`、`SettingsService`：鉴权附件、软归档、字典引用维护和个人视图设置。

附件保存在 `HR_UPLOAD_DIRECTORY` 的随机文件名下，必须通过鉴权接口读取；PDF 和图片预览使用 `?inline=true`。当前会话保存在单个应用实例内，重启后重新登录；多实例部署需要另行配置共享会话存储。

## 检查和格式

```powershell
Set-Location D:\5-HR\HR_system
mvn.cmd -f .\backend\pom.xml test
.\backend\format.ps1 -Check
```

`backend/format.ps1` 使用固定的 Google Java Format 1.28.0，去掉 `-Check` 可执行格式化。单元测试覆盖 AES 加解密及篡改检测、版本冲突、缺省组织范围、安全审计快照和未知接口 404。系统根 [scripts/api-acceptance.mjs](../scripts/api-acceptance.mjs)、[scripts/security-acceptance.mjs](../scripts/security-acceptance.mjs) 和 [scripts/settings-acceptance.mjs](../scripts/settings-acceptance.mjs) 在隔离的本地测试数据库验证真实 API、权限拒绝、并发面试/入职和设置引用；不得对生产库运行这些写入验收脚本。

最近一轮测试确认的三个导入问题仍未修复，详见 [2026-09-23 本地回归报告](../docs/local-test-2026-09-23.md)。移动目录只调整文件位置和运行入口，不改变业务实现与历史验收结论。
