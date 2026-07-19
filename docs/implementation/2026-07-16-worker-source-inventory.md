# 教务历史代码与本地数据源盘点

> 盘点日期：2026-07-16  
> 范围：`E:\moran_project` 下全部名称含 `worker` 的一级目录  
> 结论用途：确定迁移开发基线，不替代生产数据所有者签字

## 1. 结论

本地迁移开发以 `E:\moran_project\worker_01` 为唯一首选源，具体版本为：

- Git：`main` / `0ec143b`，工作区干净；
- 业务代码：`worker_01\app`；
- SQLite：`worker_01\app\data\attendance.db`；
- 数据库 SHA-256：`40a76103bd540217704c06e5c5b6d03e36adf9ba3ccb1a8ea0bae16f3d2648d6`。

理由：`worker_01` 的核心教务表逐行完整包含 `class_worker` 的旧数据，同时数据量更大、更新时间更新，并增加动态权限、统一附件、学生/家长入口和 Scratch 课堂闭环。`class_worker2` 是无数据重叠的 Django 演示路线；其他目录是更早原型或综合素材仓，不应参与业务事实合并。

该结论仅说明“本机最完整开发参考”。`class_worker` 文档明确会初始化 30 名模拟学员，`worker_01` 又完整继承这些数据，因此当前 SQLite 不作为生产事实源。用户已确认教务和现有测评数据均为可重建测试数据；当前实施不导入历史业务数据，也不承担旧数据兼容。

## 2. 候选目录取舍

| 目录 | 技术/状态 | 本地数据 | 处置 |
| --- | --- | --- | --- |
| `worker_01` | Flask + Vue + SQLite/MySQL 开关；Scratch P2；Git 干净 | 25 张业务表，数据库 491,520 bytes，更新至 2026-06-10 | 教务领域和功能设计的唯一首选参考；测试数据不导入 |
| `class_worker` | Flask + Vue；Git `751642d` | 11 张核心表，数据库 188,416 bytes | 历史基线；已被 `worker_01` 完整包含，不单独导入 |
| `class_worker2` | Django + Vue，无根 Git | 32 张 Django 表，数据库 417,792 bytes | 仅参考家长、订单和不可变课时流水设计；不导入演示数据 |
| `class_worker1` | Node 多包实验，含 `.env`，无业务数据库 | 0 | 仅作为历史代码参考；不读取或迁移其 Secret |
| `class_worker1_My` | 早期 Flask + JSON；工作区 31 项未提交 | JSON/备份碎片 | 早期原型；不作为事实源，保留只读 |
| `worker` | 约 5 GB 的多项目素材/历史试验集合，无根 Git | 21 个早期 SQL 文件，无统一运行库 | 作为来源档案；不做全量合并，不导入业务数据 |

## 3. 版本与数据血缘证据

### `class_worker` 到 `worker_01`

- 36/36 个旧学生姓名在新库中存在；旧 `students` 行执行全字段 `EXCEPT` 差异为 0。
- 6/6 个旧教师、6/6 个旧班级按名称匹配。
- 旧 `attendance`、`class_students`、`lesson_details`、`lesson_types` 全字段差异均为 0。
- 代码公共路径 60 个，其中 37 个完全相同、23 个在 `worker_01` 中继续演进。
- `worker_01` 额外提供学生/家长门户、备课、课堂、Scratch 编辑器及对应数据表。

因此 `class_worker` 是 `worker_01` 的可证明历史子集。再次导入会制造重复身份、重复考勤和重复课次。

### `class_worker2`

- 25 名 Django 学生与 `worker_01` 的姓名交集为 0。
- 学生和 30 个课次的创建时间都集中在 2026-05-16 的约 1 秒范围内，符合批量演示数据特征。
- 该路线具有 `Parent`、`Order`、`LessonBalance`、`LessonTransaction` 等更规范的概念，可作为模型参考，但不是当前业务数据血缘的一部分。

## 4. `worker_01` 本地数据量

| 表 | 行数 | 迁移阶段/处置 |
| --- | ---: | --- |
| students | 46 | 阶段 4；档案 + 家长原始字段拆分 |
| teachers | 16 | 阶段 4；教师档案 |
| users | 30 | 阶段 4；只匹配身份，不复制密码 |
| classes | 17 | 阶段 4；班级 |
| class_students | 51 | 阶段 4；成员生命周期 |
| lesson_types | 10 | 阶段 5；课型 |
| course_presets | 10 | 阶段 5；课程单元模板 |
| lessons | 28 | 阶段 5；具体课次 |
| attendance | 55 | 阶段 5；考勤；唯一键为课次 + 学生 |
| lesson_details | 5 | 阶段 6；教学记录 |
| uploaded_assets | 54 | 阶段 6/8；统一 FileAsset/ObjectStorage |
| lesson_assets | 10 | 阶段 6；课次附件关系 |
| scratch_templates | 14 | 阶段 8 |
| lesson_scratch_templates | 16 | 阶段 8；转课堂 Scratch Assignment |
| scratch_works | 13 | 阶段 8；需补不可覆盖版本表 |
| scratch_judge_runs | 1 | 阶段 8；外部判定记录 |
| scratch_material_categories | 0 | 阶段 8；仅迁 Schema |
| scratch_materials | 0 | 阶段 8；仅迁 Schema |
| student_points_ledger | 21 | 暂存参考；不与课时台账混用 |
| external_account_bindings | 0 | 不迁数据；Hydro 以主平台现有模型为准 |
| permission_definitions | 43 | 映射主平台 RBAC，不复制主键 |
| role_definitions | 13 | 映射主平台角色，不复制主键 |
| role_permission_assignments | 182 | 生成权限差异报告，不直接导入 |
| operation_logs | 340 | 只读归档；必要时转历史审计事件 |
| system_migrations | 2 | 技术元数据，不作为业务事实导入 |

## 5. 字段与口径字典

### 身份与档案

- `students`：姓名、性别、年龄、电话、家长姓名/电话、学校、购买课时、赠送课时、状态、备注、创建时间。
- `teachers`：姓名、电话、学科、状态、备注、创建时间。
- `users`：用户名、密码哈希、显示名、角色、状态、教师关联、学生关联、最后登录时间。
- 本地角色实际值：admin 6、teacher 10、student 8、parent 6；所有本地账号状态均为 active。

规则：姓名相同不能自动合并；旧密码哈希不得复制；家长信息目前内嵌在学生行，拆分时必须先规范化电话并生成候选冲突清单。

### 班级、排课、考勤和课时

- `classes`：班级名、课程名/类型、教师、默认星期和时段、容量、起止日期、状态。
- `class_students`：班级、学生、加入/离开日期、状态；当前 51 行均为 active。
- `lesson_types`：课型名、默认课时、是否计入统计。
- `course_presets`：大类、阶段、课序、课程名、课型、默认课时。
- `lessons`：班级、日期、时段、教师、课型/预设、主题、课时、教室、状态；当前 completed 11、planned 17。
- `attendance`：课次、学生、状态、签到时间、扣减课时、操作人、备注；当前已到 54、请假 1。

规则：旧库只有学生累计购买/赠送课时和每次考勤的 `deduct_hours`，没有可靠的不可变课时流水。迁移时累计余额只能生成 `OPENING_BALANCE`，已到记录是否再次生成扣减流水必须由业务口径确认，不能两者同时计入造成双扣。

### 教学记录、附件和 Scratch

- `lesson_details`：教学内容、学习目标、课堂表现、作业、下次计划、资料备注。
- `uploaded_assets`：所有者、类型、用途、原文件名、存储路径、MIME、文件大小、状态和元数据。
- `scratch_works`：课次、模板、学生、作品/缩略图、提交与批阅、外部判定、可见性和社区状态。
- `scratch_judge_runs`：作品、课次、模板、学生、状态、分数、通过标记和判定明细。

当前附件 54/54 存在，总大小 302,869 bytes，数据库声明大小与磁盘实际大小差异为 0。按 `asset id | storage path | size | sha256` 排序形成的清单根 SHA-256 为 `b195b209503efe42b336ac9464b80ce34252b1716560904b1c69aae6d76d0b1c`。为避免把学生文件名和路径提交到 Git，逐文件明细只应保存在受控迁移输出目录。

## 6. 已发现的数据质量问题

- `classes.class_type` 有 2 个空值、1 个乱码值、10 个 `QA` 和 4 个“小班课”，必须建立映射表并人工确认，不能直接转枚举。
- 本地数据包含系统自动初始化的模拟学员，不能据此推断生产身份冲突数量。
- 家长是学生行中的非规范化文本，没有稳定旧主键。
- 课时是可变余额而非流水，无法单靠旧库证明每次历史调整原因。
- 作品唯一约束是课次 + 模板 + 学生，现模型没有作品版本；迁移到主平台后必须保留原作品为首个版本。
- `operation_logs.detail` 是自由文本，只能归档，不能作为重建业务事实的来源。

## 7. 固定迁移规则

1. 本地 dry-run 只读取 `worker_01`，其他候选库不得与其并集导入。
2. 每张旧表通过 `LegacyIdMapping(sourceSystem, entityType, legacyId)` 幂等映射。
3. 身份匹配顺序采用显式映射、已确认用户名/联系方式、人工确认；禁止仅按姓名自动合并。
4. 旧密码全部废弃，账号走首次激活或重置流程。
5. 余额迁移为开账项；考勤扣减与开账项的时间边界必须书面确认。
6. 附件先校验存在性、大小、MIME 和 SHA-256，再建立业务关联。
7. 权限表只用于生成角色/权限映射差异，主平台 RBAC 是切换后的唯一事实源。
8. `worker_01` 切换后只读归档；`class_worker` 标记为已被替代，不建立双写。

## 8. 阶段 Gate 状态

本地代码版本、Schema、枚举、行数、血缘和附件完整性已盘点。用户随后确认教务系统与现有测评系统数据均为测试数据且可重建，因此原“生产数据只读副本/附件快照/兼容导入”Gate 在当前范围内取消：

- 不迁移 worker 的业务行、密码、余额或附件，只参考领域结构和业务流程；
- 主平台数据库可从迁移和 seed 干净重建，不为旧测试数据增加兼容分支；
- 身份、家长和课时规则仍需在对应功能上线前固化，但不阻塞 AI 考试总结 MVP；
- 发现的历史 Secret 不复用，实际部署继续执行轮换和环境变量注入。

## 9. 2026-07-19 最终迁移决策补充

本文件第 8 节是 2026-07-16 当时的阶段性决策，已被后续用户授权和阶段 4–9 的实施结果取代，不能再作为“禁止迁移业务行”的当前规则。

最终执行以 `worker_01` 为唯一源，已单向迁移身份、班级、课次、考勤、课时期初、教学记录、附件和 Scratch 数据；旧密码仍未读取或迁移。所有对象使用 `LegacyIdMapping` 幂等映射，身份冲突保留签字，附件执行大小与 SHA-256 对账。最终数量、源指纹、归档状态和回滚边界以 `docs/implementation/2026-07-19-stage-9-cutover-archive.md` 为准。
