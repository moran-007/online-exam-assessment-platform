# 阶段 1：AI 公共底座验收记录

> 日期：2026-07-16  
> 范围：AI 数据契约、审计模型、结构化输出、Provider 能力、Token 预算与指标  
> 状态：代码底座完成；真实模型最小验收留到考试总结闭环完成后执行

## 已交付

- 统计查询已拆为独立用例，页面和后续 Dataset Builder 共享同一确定性口径。
- 定义 `ExamSummaryDataset`、`StudentSummaryDataset`、`EvidenceRef` 和数据覆盖声明。
- 所有进入提示词的数值必须携带 evidenceRef；本地校验同时核对引用存在性和数值一致性。
- 定义考试/学生总结 JSON Schema；模型输出必须是结构化声明，每条声明至少引用一个证据。
- 新增摘要任务、摘要结果、独立版本提示模板和 Provider 能力注册表。
- 旧 `ai_prompt_templates` 保持不变；新的版本化模板使用 `ai_summary_prompt_templates`，避免破坏历史数据。
- 任务保存 inputHash、Dataset/Prompt/Schema/模型版本、correlationId、Token、成本和脱敏错误。
- 未登记模型使用保守能力：不假定 JSON、Schema、流式或思考模式受支持。
- 新增 AI 调用次数、耗时、输入/输出 Token、估算成本、缓存、错误结果和预算准入指标。
- Provider 配置分为系统共享和个人私有两类；个人密钥仅所有者可见、可改，系统密钥仅管理员可维护。
- 默认模型按“个人默认、系统默认、其他个人、其他系统”顺序自动选择；调用方也可显式传入有权使用的配置完成手动选择。
- 每个用户可保存多个个人 Provider 配置，每个作用域只允许一个默认配置，密钥仍使用服务端加密存储并只返回掩码。

## Token 与额度口径

- AI 模块完成后的真实验收，单次 `max_tokens` 默认约为 1,000，上限仍由配置和模型能力共同收紧。
- 模型返回的 prompt/completion/total Token 写入追加式 `ai_usage_events` 流水，业务代码不提供修改入口。
- 若兼容接口未返回 usage，则记录为“未报告调用”，余额同时标记不完整；配置了本地预算时暂停后续调用，不会把未知用量伪装成 0 消耗。
- 配置可以设置本地月度 Token 预算；接口和管理员页面显示本月已用与剩余。
- 预算不足时，在发送请求前拒绝调用并记录预算拒绝指标。
- “剩余”是主平台本地预算余额，不冒充供应商账户余额；供应商未提供标准余额接口时显示“余额未配置”。
- 本阶段没有发起真实模型生成，因此本轮真实 Token 消耗为 0，供应商剩余额度未知。

## 数据库迁移

| Migration | 内容 |
| --- | --- |
| `20260716123000_add_ai_summary_foundation` | 摘要枚举、能力、版本化模板、任务、结果和精细权限 |
| `20260716130000_add_ai_usage_budget` | 本地月度预算和 AI Token 用量流水 |
| `20260716133000_mark_ai_usage_reporting` | 区分供应商已报告和未报告的 Token 用量 |
| `20260716140000_add_personal_ai_provider_configs` | 系统/个人配置作用域、所有权、默认项唯一约束和个人管理权限 |

四个迁移均在 `online_exam_test` 从既有 16 个迁移顺序部署成功。测试库与 Prisma datamodel 的只读 diff 结果为 `No difference detected`。

## 验证结果

| 门禁 | 结果 |
| --- | --- |
| Prisma format / validate / generate | 通过 |
| ESLint / Nest build | 通过 |
| 单元测试 | 76/76 通过 |
| 关键模块覆盖率 | statements 90.47%，branches 78.46%，lines 93.93% |
| Metrics 分支覆盖率 | 94.44% |
| 集成测试 | 9/9 通过 |
| 前端 typecheck / production build | 通过 |
| 架构 / bundle 门禁 | 通过；初始 JS gzip 47.5 KB |
| OpenAPI / Orval | 已重新生成 |

测试覆盖了能力匹配优先级、未知模型保守回退、证据完整性、结构化输出拒绝、稳定 inputHash、Provider 用量归一化、月度余额计算、预算不足拒绝、个人默认优先、系统配置保护和跨用户密钥隔离。

## 尚未解除的 Gate

- worker 生产数据库与附件的真实只读快照尚未取得。
- 身份冲突、家长拆分和课时开账边界仍需业务签字。
- 考试总结 Dataset Builder 与只读预览已经进入阶段 2；任务执行、人工审核/发布和黄金样本仍待完成。
- 在阶段 2 闭环完成前不做真实模型调用；完成后按约 1,000 输出 Token 做最小受控验收，并记录实际使用与剩余本地预算。
