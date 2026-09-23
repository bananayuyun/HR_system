# MySQL 进程误停定位与隔离修正

## 结论

本项目没有与另一个系统共用数据库：本项目监听 `127.0.0.1:3307`，数据目录为 `D:\5-HR\HR_system\.local\mysql-data`，开发库和测试库分别为 `hrms_dev`、`hrms_test`。另一个系统使用 3306 和自己的数据目录。

2026-09-23 连续复测中，3307 多次被非正常终止。最终发现另一个项目的启动脚本包含全局停止 `mysqld` 进程的操作，独立端口和数据目录无法防止这种按进程名误停。用户明确批准后，仅修正该处停止逻辑；没有执行另一个项目的重启脚本、停止其服务或改动其数据库。

## 直接证据

- 14:25:35 受监控启动本项目 MySQL：monitor PID 35200，server PID 4868。启动参数仍使用本项目独立路径和 3307；诊断时启用控制台输出并保留进程句柄。
- 14:26:47.734 两个进程同时退出，实际退出码均为 `-1`。日志最后为 ready for connections，没有正常关闭或崩溃堆栈。
- 14:26:46 已存在的 PowerShell PID 22536 执行 `.tools\tmp\boot-all.ps1`；父进程 PID 27044 执行 `.tools\tmp\run-redeploy.ps1`。14:26:48，该脚本启动另一个系统的 MySQL。
- 对应文件 `D:\1-hr-admin-ai-tool\pm ide 1.4\HRMS\HR_system_v1\.tools\tmp\boot-all.ps1` 原第 9 行为 `Get-Process mysqld ... | ForEach-Object { Stop-Process -Id $_.Id -Force }`，没有限定程序路径、端口或数据目录。
- 本项目 `scripts` 中没有这类全局停止；`stop-dev.ps1 -Database` 使用显式 3307 的私密连接配置执行正常 shutdown。

监督输出保存在 `.local/verification/mysql-supervised.stdout.log` 和 `.local/verification/mysql-supervised.stderr.log`。早期 Windows 资源不足事件发生在 13:11，并不能解释本次 14:26 的同步强制退出，未把它误判为根因。

## 经授权的最小修正

只替换上述一处停止逻辑：查询 `Win32_Process`，同时要求 `ExecutablePath` 等于该项目的 MySQL 可执行文件，并且命令行包含完整、准确的该项目 `--datadir` 参数，再对匹配 PID 执行停止。正则兼容 Windows MySQL monitor/server 两种参数引号形式，不采用目录子串模糊匹配。

没有修改连接密码、数据库文件、其他停止逻辑或系统服务。未通过实际停止另一个数据库来验证；使用语法解析和只读匹配检查：另一个项目自己的两个 MySQL PID 均匹配，本项目新启动的 PID 30364/23068 均不匹配。随后本项目 8090/8091 恢复健康并开始真实数据库回归。

修正后本项目 MySQL server PID 23068 自 14:29:21 至 15:04 持续运行，收尾实际 Uptime 2102 秒；完整导入、API、真实 UI 与认证验收期间未再退出。经授权修正的脚本哈希在收尾仍为 `C1BA1439D2F59F55DF27F9CA554F0953BAA2BE99CC28A26BD02B8E8A503432C1`。

本记录解释基础环境中断；最终业务和运行结论见 [修复复测报告](fix-regression-2026-09-23.md)，不把一次健康检查等同完整验收。
