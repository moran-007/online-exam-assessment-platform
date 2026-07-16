# 跨阶段工程治理记录

> 日期：2026-07-16
> 范围：不依赖考试总结 Gate A 的安全与可维护性任务

## 已完成

- 升级 `ajv` 与 `@nestjs/swagger`，并为 ExcelJS 的已知脆弱传递依赖固定安全版本。
- 生产依赖审计由 2 个低危、3 个中危降为 0 个已知漏洞。
- Excel 导入、CSV/JSON/XLSX/PDF/ZIP 导出集成流程通过，确认依赖覆盖未破坏运行时兼容性。
- 新增 OpenRouter / 腾讯混元 Hy3 预设，与腾讯云官方混元端点明确分离。
- `ClassView.vue` 从 601 行改为 5 行路由壳；功能页与组合函数迁入 `features/classes`，并合并重复的单个/批量师生创建流程。
- 浏览器管理员场景新增班级路由加载断言，并继续保持 5/5 通过。

## 边界

- 本轮没有新增或改变教务数据模型，也没有进入依赖 Gate A 的学生总结阶段。
- 真实模型密钥仍只允许由用户在本地配置页录入；连接失败只记录脱敏错误，不自动重试。

## 后续

- 按同一模式继续拆分 `UserManagementView`、`WrongQuestionView`、`PaperAnswerView`、`PublicQuestionView` 和 `KnowledgeView`。
- 教师完成真实考试总结验收并通过 Gate A 后，再启动学生考试阶段总结。
