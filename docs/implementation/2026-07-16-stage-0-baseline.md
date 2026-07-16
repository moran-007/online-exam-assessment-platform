# 阶段 0 基线与恢复验收记录

> 记录时间：2026-07-16（Asia/Shanghai）  
> 实施分支：`codex/ai-edu-fusion`  
> 规划基线提交：`df532a2`

## 1. Git 与回滚点

- 原稳定基线：`codex/p1-architecture-refactor` / `1eb50e5`。
- 规划文档独立提交：`df532a2 docs: define AI and academic integration roadmap`。
- 远端执行前备份分支：`origin/codex/backup-pre-ai-edu-fusion-20260716`。
- 远端实施分支：`origin/codex/ai-edu-fusion`。

## 2. 质量门禁

| 门禁 | 结果 | 记录 |
| --- | --- | --- |
| lint | 通过 | 无错误 |
| architecture:check | 通过 | Architecture guard passed |
| security:audit | 通过阈值 | 2 low、3 moderate、0 high |
| licenses:check | 通过 | 生产依赖许可证策略通过 |
| openapi:check | 通过 | OpenAPI 与 Orval 客户端无差异 |
| frontend:typecheck | 通过 | vue-tsc 无错误 |
| build:all | 通过 | NestJS 与 Vite 构建成功 |
| bundle:check | 通过 | 首屏 JS gzip 47.5 KB |
| test:coverage | 通过 | 56/56；语句 89.44%，分支 77.71%，函数 86.11%，行 92.98% |
| test | 通过 | 单元 56/56；集成 8/8 |
| test:e2e | 修复隔离后通过 | Chromium 5/5 |

首次本地 E2E 被 3000/5173 上已有的主应用进程污染：测试数据写入测试库，但 API 请求复用了非测试服务。阶段 0 已将 Playwright 默认隔离到 3100/5183、配置动态代理，并禁止复用未知服务。修复后确认数据库为 `online_exam_test`，5 个浏览器流程全部通过，原 3000/5173 应用未停止。

## 3. 数据、Schema 与构建基线

| 项目 | 基线 |
| --- | ---: |
| Prisma migration | 16 |
| 用户 | 114 |
| 题目 | 359 |
| 试卷 | 12 |
| 考试 | 9 |
| 考试作答 | 22 |
| 答题记录 | 81 |
| FileAsset | 27 |
| uploads 文件 | 119 |
| uploads 总大小 | 19,254,410 bytes |
| OpenAPI 文档 | 461,269 bytes |
| Orval 生成文件 | 375 个 / 524,130 bytes |
| 后端 dist | 714 个文件 / 2,896,204 bytes |
| 最大业务前端 chunk | QuestionImportView，113,625 bytes |

## 4. 数据库查询基线

`pg_stat_statements` 当前未安装，因此没有可用的历史 P95/慢查询样本。已执行 `EXPLAIN (ANALYZE, BUFFERS)`：

| 查询 | 执行时间 | 命中块 | 计划摘要 |
| --- | ---: | ---: | --- |
| 已发布题目 Top 20 | 0.279 ms | 30 | 小数据量下 Seq Scan + top-N heapsort |
| 学生作答 Top 20 | 0.051 ms | 1 | 小数据量下 Seq Scan + quicksort |
| 待处理导出 Top 50 | 0.034 ms | 1 | `export_tasks_status_idx` Index Scan |

进入阶段 1 后应为 AI/教务关键查询补充可重复压测样本；生产 P95 需要启用受控观测能力后采集，不能用本地单次执行时间替代。

## 5. 备份与恢复验证

- 本地备份：`output/backups/backup-2026-07-16-120234`。
- 数据库归档：833,117 bytes；uploads 归档：18,766,097 bytes。
- manifest 包含数据库、uploads 归档及全部 119 个文件的 SHA-256。
- 已恢复到隔离的临时数据库和目录，migration、核心表行数、文件数量与逐文件 SHA-256 全部一致。
- 临时恢复数据库和目录已自动清理，源库和源 uploads 未被覆盖。
- `BACKUP_REMOTE` 尚未配置，因此数据备份当前仅保存在本机；Git 回滚分支已推送远端。

## 6. 密文信封与应用健康

- Hydro：检查 7 行；空信封 0、不完整信封 0、解密失败 0。
- AI provider：检查 1 行；空信封 0、不完整信封 0、解密失败 0。
- 2026-07-16 12:05 +08:00：后端健康接口 HTTP 200，前端登录页 HTTP 200。

## 7. 已知基线债务

- 根级 `tsc --noEmit` 会在 `prisma/reseed-curriculum.ts` 出现旧有的 `never` 推断错误；正式 Nest 构建、固定类型门禁和测试均通过。该脚本类型问题纳入工程清理，不作为阶段 0 数据恢复阻断项。
- 生产依赖仍有 2 个低风险与 3 个中风险审计项，阶段 1 按兼容性逐项评估，不做无验证的主版本升级。
- `pg_stat_statements` 未安装，当前不能给出真实流量 P95。

## 8. 阶段结论

代码回滚点、数据库与文件恢复路径、固定质量门禁和现有应用健康均已验证。阶段 0 在本地执行范围内通过；远端数据备份与真实生产恢复演练仍属于部署环境工作，后续上线 Gate 前必须补齐。
