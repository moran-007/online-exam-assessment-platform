# 融合平台故障定位与维护手册

## 先保留证据

不要先重建数据库或删除运行目录。记录发生时间、账号角色、页面、请求 ID、操作步骤和浏览器网络响应，再查看：

- 后端：`runtime/backend.out.log`、`runtime/backend.err.log`
- 前端：`runtime/frontend.out.log`、`runtime/frontend.err.log`
- API 健康：`GET /api/v1/health`
- 接口契约：`http://127.0.0.1:3000/api/docs`
- 切换报告：`output/cutover`
- 浏览器失败证据：`test-results`、`playwright-report`

日志、截图和工单中禁止粘贴 Access Token、Refresh Token、API Key、密钥密文或完整手机号。

## 一键启动失败

运行 `scripts\start-platform.ps1 -NoBrowser`，不要只双击后立即关闭窗口。脚本会检查 Node 版本、PostgreSQL、迁移、依赖、构建和端口。常见问题：

- 3000/5173 被占用：确认占用进程是否为本平台；启动脚本会停止已跟踪旧进程。
- PostgreSQL 不在默认目录：设置 `POSTGRES_BIN_DIR`、`POSTGRES_DATA_DIR`。
- 数据库迁移失败：先备份，检查 `_prisma_migrations`，不要手工改已发布迁移。
- 启动后白屏：检查前端错误日志、`VITE_API_BASE_URL` 和浏览器网络面板。

## AI 总结

### 没有参数或输出为空

先看总结任务的 `lastError`、供应商配置、模型能力和调用用量。输出必须包含当前 Schema 的 `schemaVersion`；供应商不支持 JSON Schema 时，网关应降级为 JSON Object/文本解析并执行本地校验与一次修复，不能把空对象保存为草稿。

### 超时

区分供应商超时和本地任务租约超时。调大配置的 `timeoutMs` 前先做使用明确 4 Token 小上限的连接测试；不要用增加输出 Token 掩盖网络问题。供应商未报告准确用量时，系统按解析后的预留上界保守记账，后续不会伪造实际 Token。

### Token 上限不一致

配置级 `maxTokens` 和“本次输出上限”都可留空。两者都为空时，供应商请求中不应出现 `max_tokens`；只要存在显式值，发送值取调用级、配置级和模型能力上限中存在值的最小值。8,192 平台校验上界和模型能力上界只用于校验显式输入，并在 usage 未报告时确定保守预算预留，不得当作隐藏请求限制。1,000 Token 仅是成本参考。界面显示“自动/不限制”时若仍出现 800、1,000 或 1,200 请求限制，应检查前端表单、DTO、数据库默认值和网关请求体是否仍有旧默认。用量以 `ai_usage_events` 为审计来源。

### 结构化输出被思考内容占用

DeepSeek 和 Qwen/阿里云混合思考模型在结构化非流式请求中都应关闭思考：DeepSeek 使用兼容的禁用思考参数，Qwen/阿里云请求应包含 `enable_thinking: false`。若阿里连接测试成功而总结超时或 JSON 正文为空，先核对供应商、Base URL、模型识别和出站请求参数，再按一次受控请求复验；不要把修正前的历史超时直接判定为当前模型不可用。

### Key 更换

已暴露 Key 必须先在供应商控制台撤销，再录入新 Key并执行最小连接。系统配置只应出现密文、IV、认证标签和版本；`rotation_required` 配置在换新前不得启用。

## 导出文件打不开

检查浏览器响应是否为真实二进制，而不是被统一响应包装成 JSON。核对 `Content-Type`、`Content-Disposition`、文件签名和扩展名；题目/试卷 ZIP、Excel、Word、PDF 都有对应集成与浏览器测试。修复后至少运行导出相关测试和实际点击下载，再用目标软件打开，不要只检查 HTTP 200。

## 权限或数据范围异常

403 先确认权限 code、角色绑定和作用域；200 但看到不应看到的数据属于更严重的数据范围问题。前端隐藏按钮不能替代后端守卫。教师按任教班级、学生按本人、家长按关联学生过滤；任何临时放宽都要有集成测试覆盖拒绝路径。

## 排课、考勤和课时

课次调整必须保留版本和审计，不能删除后重建来掩盖变更。考勤确认通过幂等键生成课时流水；课时余额以不可变流水汇总，不能直接更新余额字段。出现差异时：

1. 对比课次、考勤记录和对应流水；
2. 检查重复请求、修订原因和冲正关系；
3. 运行教务集成测试与对账查询；
4. 通过调整/冲正流水修复，禁止改历史流水金额。

## 附件与 Scratch

下载失败时同时核对数据库 `fileSize`、`sha256`、对象键和实际文件。Scratch `.sb3` 还需校验 ZIP、`project.json`、路径穿越和压缩率。历史 `legacy_invalid` 只表示保留旧字节，不允许作为新上传校验的放宽理由。

## worker 迁移与回滚

worker 已归档。`WORKER_READ_ONLY`、`WORKER_ARCHIVED` 是预期响应。任何源指纹变化、目标缺失、附件哈希差异或未签字冲突都会阻止激活。回滚只使用 `rollback-entry`，不能删除 `.maintenance-mode.json` 或恢复旧库写入。详见 `worker-cutover-runbook.md`。

## 修改后的最低验证

- 纯函数或规则：补单元测试。
- 数据库、权限或文件：补集成测试。
- 页面流程：补 Playwright 点击测试。
- API DTO：执行 `pnpm openapi:check`。
- 交付前：执行 `pnpm test:ci`。

测试数据库名必须包含 `_test`；不得让测试准备脚本连接主库。修复记录应写明根因、影响范围、数据处置、回归用例和回滚方式。
