# 阶段 5：排课、考勤与课时台账实施记录

## 完成结论

阶段 5 已完成，Gate D 通过。主平台现已具备课型、课程单元模板、排课规则、课次、考勤、不可变课时台账、余额重算、逐学生对账和 worker_01 历史迁移能力。

核心结论：

- 重复生成课次由唯一 `generation_key` 阻止，不会新增重复课次。
- 考勤确认与课时扣减位于同一 Serializable 事务。
- 已确认考勤不能被普通确认接口覆盖，只能通过更正流程修改。
- 更正不会修改或删除课时流水，而是追加 `REVERSAL` 和新的扣减流水。
- 数据库触发器禁止更新或删除 `lesson_hour_ledger`。
- 不保存独立可漂移余额，当前余额始终由台账 `SUM(amount)` 重建。
- worker_01 的切换时当前余额迁移为 `OPENING_BALANCE`，历史考勤只迁移事实，不重复扣减。
- worker_01 的 46 名学生余额逐一核对，差异全部为 0。

## 领域模型

本阶段新增：

- `LessonType`：课型、默认课时、是否计入统计。
- `CourseUnitTemplate`：可复用的课程单元和教学内容模板。
- `ClassScheduleRule`：班级、星期、本地时间、时区和有效期规则。
- `LessonSession`：实际课次，支持常规、临时、补课、取消和调课派生关系。
- `AttendanceRecord`：学生在课次中的当前确认状态。
- `AttendanceRevision`：考勤更正的不可变版本记录。
- `LessonHourLedger`：带符号的不可变课时流水。

课时符号约定：

- `OPENING_BALANCE`、`PURCHASE`、`GIFT`、`TRANSFER_IN` 为正数。
- `CONSUME`、`REFUND`、`TRANSFER_OUT` 为负数。
- `REVERSAL` 必须引用原流水，金额与被冲正流水相反。
- `MANUAL_ADJUSTMENT` 可正可负，但必须有审计责任人和幂等键。

## 事务与并发约束

1. 规则生成键采用 `rule:{ruleId}:{localDate}`，数据库唯一索引作为最终并发防线。
2. 考勤初次扣减键采用 `attendance:{attendanceId}:v{version}:consume`。
3. 更正冲正键采用 `attendance:{attendanceId}:v{nextVersion}:reversal`。
4. 考勤记录使用版本号进行并发更新校验。
5. 事务发生 PostgreSQL 序列化冲突时最多自动重试三次。
6. 数据库检查约束校验星期、时间范围、有效期、非负扣减和非零台账金额。
7. `lesson_hour_ledger` 的 UPDATE/DELETE 均由数据库触发器拒绝。

## 权限与数据范围

新增权限：

- `lesson-type:read`、`lesson-type:manage`
- `course-unit:read`、`course-unit:manage`
- `schedule:read`、`schedule:manage`
- `attendance:read`、`attendance:confirm`、`attendance:correct`
- `lesson-hour:read`、`lesson-hour:adjust`、`lesson-hour:reconcile`

数据范围：

- 超级管理员和管理员可访问全局数据。
- 教师和助教仅访问当前有效任教班级及其中学生。
- 学生仅访问自己的课表、考勤和课时。
- 家长仅访问明确且有效关联子女的数据。
- 控制器权限和服务层数据范围同时生效，不能仅依赖前端隐藏按钮。

## 页面与接口

前端新增“教学运营”页面，包含：

- 排课日历与日期、班级筛选。
- 排课规则和幂等批量生成。
- 临时课次创建。
- 批量考勤确认与课时扣减。
- 考勤更正和冲正提示。
- 学生余额、课时流水和全量重算报告。
- 课型与课程单元模板管理。

学生和家长使用相同页面的只读视图；教师和管理员根据权限看到管理操作。

## worker_01 迁移

迁移命令：

`pnpm migration:worker:operations --source=<attendance.db>`

默认仅预检；正式写入必须同时提供 `--apply` 和不少于 8 个字符的 `--signoff`。

本次正式迁移：

- 迁移运行 ID：`56bf1c07-8ba1-4040-acd9-688ed461b671`
- 课型：10
- 课程单元：10
- 课次：28
- 考勤：55
- 期初余额：46
- 新增稳定映射：149
- 原始重复时段：1 组，按旧课次 ID 分别保留
- 缺失时间：3 个课次，按班级默认开始时间与课时长度确定性补全
- 缺失课型：10 个课次，按已签字策略补为旧库“常规课”
- 旧密码字段读取：0

余额策略：旧库当前余额按 `purchased_hours + gift_hours - SUM(attendance.deduct_hours)` 计算并写入 `OPENING_BALANCE`。历史考勤标记为 `legacy_baseline`，不再次生成历史消费流水；今后更正历史考勤时，只追加相对切换余额的差额调整。

对账结果：

- 学生数：46
- 差异学生数：0
- 最大绝对差异：0
- Gate D：通过

正式迁移已复跑验证，目标库仍保持 28 个旧课次、55 条旧考勤、46 条期初余额和 149 条本阶段映射，没有重复写入。

## 验证证据

- 单元测试：127/127 通过，其中覆盖日期、时区和跨日结束时间。
- 数据库集成测试：15/15 通过，其中覆盖生成幂等、确认幂等、事务扣减、冲正、台账防篡改、学生/家长范围和差异为零。
- Chromium：8/8 通过。
- Gate D 浏览器点击链路：生成课次 → 点名确认 → 余额减少 → 重复点击不重复扣减 → 更正请假 → 追加冲正 → 余额恢复 → 全量重算通过。
- Nest 构建、ESLint、前端类型检查和生产构建通过。
- 架构守卫、bundle 预算、安全审计和依赖许可证检查通过。
- 初始 JS gzip：47.9 KB，符合预算。

完整 Chromium 首次执行曾因 Windows 前端预览进程意外退出而全部报连接拒绝；清理测试环境后按同一代码完整复跑 8/8 通过。该次失败没有业务断言失败，也未产生主库写入。

## Gate D 后续约束

Gate D 已通过，阶段 6 可以开始。后续如果迁移源、余额计算规则或台账结构发生变化，必须重新执行逐学生对账；对账未通过时继续阻止生产切换，并禁止 AI 对课时余额或消耗原因作确定性解释。
