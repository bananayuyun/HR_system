# 人力资源平台

公司内部的人力资源管理系统，提供组织与岗位管理、员工花名册、职级、招聘、入职和资产管理。前端使用 Vue 3，后端使用 Java 17 / Spring Boot，数据库为 MySQL 8.4。

## 数据说明

数据库中的**合同归属、工作片区、工作所在地、部门、组别、职位、职级**均为公司真实基础数据，当前无须调整。**花名册中所有人员的具体信息是编造的测试数据**，不能当作真实员工资料使用。

## 本地运行

需要 Java 17、Maven 3.9+、Node.js 24、pnpm 11.25 和 PowerShell 7。在项目根目录执行：

```powershell
./scripts/bootstrap-dev.ps1
./scripts/start-backend.ps1
./scripts/start-frontend.ps1
```

访问 `http://localhost:5180/`，在系统登录页输入用户中心账号和密码。前端在 `frontend/`，后端和数据库迁移在 `backend/`；本机配置见 [.env.example](.env.example)，实际 `.env`、数据库及上传文件保存在本机，不提交到仓库。旧的本地 admin、manager 密码已不能登录。

## 验证与维护

运行 `./scripts/verify.ps1` 检查 Java 测试和前端构建。测试环境使用独立数据库 `hrms_test`；部署说明见 [部署文档](docs/deployment.md)，接口见 [API 文档](backend/API.md)。

代码托管在 GitLab 的 `yuyun/hr-platform`，由维护人员手动同步。测试和生产数据库连接配置只保存在本机，仓库内仅提供无密码模板。
