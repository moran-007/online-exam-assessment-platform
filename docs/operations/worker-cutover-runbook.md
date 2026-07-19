# worker_01 切换与归档运行手册

## 适用范围

本手册用于将 `worker_01` 单向切换到主平台。主平台是唯一写入口；回滚只改变产品入口，旧库始终保持只读，禁止反向双写。

默认位置：

- 主平台：`E:\moran_project\text_project`
- worker：`E:\moran_project\worker_01`
- 源库：`worker_01\app\data\attendance.db`
- 状态：`runtime\cutover\worker-01-state.json`
- 对账报告：`output\cutover`

## 标准步骤

1. 执行 `pnpm backup:create`，随后用返回目录执行 `pnpm backup:verify --backup=<目录>`。
2. 执行 `pnpm cutover:worker rehearse --source=<attendance.db> --label=t7`；任何未签字差异都会返回非零退出码。
3. 执行四条 `migration:worker:*` 迁移；身份冲突必须先在预检运行中处置、批准，不能按姓名自动合并。
4. 第二次执行 `rehearse` 并保存 T-3 报告。
5. T-0 执行 `pnpm cutover:worker freeze --source=<attendance.db> --signoff=<业务签字>`。
6. 冻结后再次执行四条迁移，随后执行最终 `rehearse`。冻结指纹变化时必须停止切换并调查。
7. 运行 `scripts\start-platform.ps1 -NoBrowser`。脚本识别切换状态后会停止旧服务 8000 端口。
8. 执行 `pnpm cutover:worker activate --source=<attendance.db>`，只有主平台健康、四条迁移指纹、实体差异、附件哈希和外键完整性全部通过才会激活。
9. 观察期内定时执行 `pnpm cutover:worker verify --source=<attendance.db>`，并运行浏览器回归验证登录、权限、考勤、课时、附件和 AI 数据范围。
10. 观察期签字后执行 `pnpm cutover:worker close --source=<attendance.db> --signoff=<归档签字>`。

所有正式操作只保存签字内容的 SHA-256 摘要，不把签字原文或 Secret 写入运行状态。

## 只读保护

`freeze` 原子写入 worker 的 `.maintenance-mode.json`。worker 在维护状态下：

- 请求层拒绝 POST/PUT/PATCH/DELETE；
- SQLite 使用 `mode=ro` 打开；
- 启动时跳过建表、种子和权限初始化；
- `closed` 状态下 API 返回 410，页面跳转主平台。

不要通过删除维护文件恢复旧写入。该操作会破坏冻结证据链。

## 回滚与故障阈值

主平台出现无法登录、关键权限越权、考勤或课时错误、附件不可下载时，先停止主平台入口并执行 `rollback-entry`。该命令只将入口指向 worker 只读观察页，不会移除维护状态，也不会把主平台新增数据写回旧库。

修复后再次运行最终对账与 `activate`。数据库恢复只能从已验证备份恢复到新库名，备份脚本拒绝覆盖源库。

## Secret 处置

切换前后均需在各供应商控制台撤销已暴露或历史 Key，再在主平台密钥管理页录入新 Key。不要把 Key 写进文档、命令行、Git 或对账报告。完成后确认：

- 旧 Key 在供应商侧已不可调用；
- 主平台仅保存加密密文、IV、认证标签和密钥版本；
- 默认模型最小连接成功；
- worker、class_worker 和归档包中不存在有效 Secret；
- 外部备份位置已配置并验证，或明确记录本机备份风险。

## 归档

worker_01 使用迁移归档标签；`class_worker` 使用 superseded 标签。归档前保留用户未提交修改，不得借归档覆盖或丢弃。归档包和补丁应计算 SHA-256，并与最终技术记录一并保存。
