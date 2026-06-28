# 在线答题与智能测评平台数据库设计文档

版本：v1.0  
数据库建议：PostgreSQL  
ORM 建议：Prisma  
缓存与队列：Redis + BullMQ  
文件存储：MinIO

---

## 一、数据库设计原则

1. 所有核心表必须包含 `id`、`created_at`、`updated_at`。
2. 重要业务表需要包含 `created_by`、`updated_by`。
3. 删除操作优先使用软删除 `deleted_at`。
4. 题目、试卷、答题必须使用快照。
5. 已发布考试不能直接依赖实时题库内容。
6. 学生答题结果必须可追溯。
7. 答案、成绩、导出记录不能随意物理删除。
8. 编程题判题结果保存原始 JSON。
9. AI 分析输入和输出保存快照。
10. 所有关键操作记录审计日志。
11. 金额用整数，单位为分。
12. 分数建议使用 Decimal，避免小数计算误差。
13. 时长统一使用秒或分钟，字段名明确单位。
14. JSON 字段用于保存快照、规则、配置，不用于替代核心关系结构。

---

## 二、核心实体关系

核心关系如下：

```txt
users
  ↓
students / teachers
  ↓
exam_attempts
  ↓
answer_records

courses
  ↓
knowledge_points
  ↓
questions
  ↓
question_options / question_answers

questions
  ↓
paper_questions
  ↓
papers
  ↓
exams
  ↓
paper_instances
  ↓
exam_attempts
  ↓
answer_records
```

编程题关系：

```txt
questions
  ↓
programming_problem_refs
  ↓
judge_submissions
```

AI 分析关系：

```txt
exam_attempts
  ↓
ai_analysis_reports
```

导出关系：

```txt
users
  ↓
export_tasks
```

---

## 三、用户与权限表

### 3.1 users 用户表

用途：保存所有登录用户，包括管理员、教师、学生、家长。

字段：

```txt
id                  UUID / BIGINT
username            VARCHAR(64)
phone               VARCHAR(32)
email               VARCHAR(128)
password_hash       VARCHAR(255)
real_name           VARCHAR(64)
avatar_url          TEXT
user_type           VARCHAR(32)
status              VARCHAR(32)
last_login_at       TIMESTAMP
created_at          TIMESTAMP
updated_at          TIMESTAMP
deleted_at          TIMESTAMP
```

user_type：

```txt
SUPER_ADMIN
ADMIN
TEACHER
ASSISTANT
STUDENT
PARENT
```

status：

```txt
ACTIVE
DISABLED
LOCKED
DELETED
```

索引建议：

```txt
UNIQUE(username)
UNIQUE(phone)
INDEX(user_type)
INDEX(status)
```

---

### 3.2 roles 角色表

用途：保存角色。

字段：

```txt
id                  UUID / BIGINT
name                VARCHAR(64)
code                VARCHAR(64)
description         TEXT
status              VARCHAR(32)
created_at          TIMESTAMP
updated_at          TIMESTAMP
```

示例：

```txt
super_admin
question_admin
teacher
assistant
student
parent
```

索引：

```txt
UNIQUE(code)
```

---

### 3.3 permissions 权限表

用途：保存菜单、按钮、接口权限。

字段：

```txt
id                  UUID / BIGINT
name                VARCHAR(64)
code                VARCHAR(128)
type                VARCHAR(32)
parent_id           UUID / BIGINT
path                VARCHAR(255)
method              VARCHAR(16)
sort_order          INT
created_at          TIMESTAMP
updated_at          TIMESTAMP
```

type：

```txt
MENU
BUTTON
API
```

示例 code：

```txt
question:create
question:update
paper:publish
exam:result:export
```

---

### 3.4 role_permissions 角色权限表

字段：

```txt
id                  UUID / BIGINT
role_id             UUID / BIGINT
permission_id       UUID / BIGINT
created_at          TIMESTAMP
```

索引：

```txt
UNIQUE(role_id, permission_id)
INDEX(role_id)
INDEX(permission_id)
```

---

### 3.5 user_roles 用户角色表

字段：

```txt
id                  UUID / BIGINT
user_id             UUID / BIGINT
role_id             UUID / BIGINT
scope_type          VARCHAR(32)
scope_id            UUID / BIGINT
created_at          TIMESTAMP
```

scope_type：

```txt
GLOBAL
TENANT
CAMPUS
CLASS
SELF
```

说明：

同一个用户可以拥有多个角色，并且角色可以限制数据范围。

---

## 四、课程、知识点、标签表

### 4.1 courses 课程表

字段：

```txt
id                  UUID / BIGINT
name                VARCHAR(128)
code                VARCHAR(64)
description         TEXT
cover_url           TEXT
status              VARCHAR(32)
sort_order          INT
created_by          UUID / BIGINT
created_at          TIMESTAMP
updated_at          TIMESTAMP
deleted_at          TIMESTAMP
```

status：

```txt
ACTIVE
DISABLED
ARCHIVED
```

索引：

```txt
UNIQUE(code)
INDEX(status)
```

---

### 4.2 knowledge_points 知识点表

字段：

```txt
id                  UUID / BIGINT
course_id           UUID / BIGINT
parent_id           UUID / BIGINT
name                VARCHAR(128)
code                VARCHAR(64)
level               INT
sort_order          INT
status              VARCHAR(32)
created_at          TIMESTAMP
updated_at          TIMESTAMP
deleted_at          TIMESTAMP
```

索引：

```txt
INDEX(course_id)
INDEX(parent_id)
UNIQUE(course_id, code)
```

说明：

知识点采用树结构。`parent_id` 为空表示一级知识点。

---

### 4.3 tags 标签表

字段：

```txt
id                  UUID / BIGINT
name                VARCHAR(64)
code                VARCHAR(64)
type                VARCHAR(32)
status              VARCHAR(32)
created_at          TIMESTAMP
updated_at          TIMESTAMP
deleted_at          TIMESTAMP
```

type：

```txt
QUESTION
PAPER
EXAM
CUSTOM
```

索引：

```txt
UNIQUE(code)
INDEX(type)
```

---

## 五、题库相关表

### 5.1 questions 题目表

字段：

```txt
id                  UUID / BIGINT
course_id           UUID / BIGINT
type                VARCHAR(32)
title               VARCHAR(255)
content             TEXT
difficulty          INT
default_score       DECIMAL(8,2)
analysis            TEXT
status              VARCHAR(32)
version             INT
allow_option_shuffle BOOLEAN
created_by          UUID / BIGINT
updated_by          UUID / BIGINT
reviewed_by         UUID / BIGINT
reviewed_at         TIMESTAMP
created_at          TIMESTAMP
updated_at          TIMESTAMP
deleted_at          TIMESTAMP
```

type：

```txt
single_choice
multiple_choice
true_false
fill_blank
short_answer
programming
material
file_upload
scratch_project
arduino_project
```

status：

```txt
draft
pending_review
published
disabled
archived
```

索引：

```txt
INDEX(course_id)
INDEX(type)
INDEX(difficulty)
INDEX(status)
INDEX(created_by)
```

说明：

`questions` 保存题目当前版本。历史版本保存在 `question_versions`。

---

### 5.2 question_options 题目选项表

字段：

```txt
id                  UUID / BIGINT
question_id         UUID / BIGINT
option_key          VARCHAR(16)
content             TEXT
is_correct          BOOLEAN
sort_order          INT
created_at          TIMESTAMP
updated_at          TIMESTAMP
```

索引：

```txt
INDEX(question_id)
```

重要说明：

判分必须使用 `option_id`，不能使用 A/B/C/D。A/B/C/D 只作为前端展示映射。

---

### 5.3 question_answers 题目答案表

字段：

```txt
id                  UUID / BIGINT
question_id         UUID / BIGINT
answer_json         JSONB
scoring_rule_json   JSONB
created_at          TIMESTAMP
updated_at          TIMESTAMP
```

索引：

```txt
UNIQUE(question_id)
```

示例，单选题：

```json
{
  "correctOptionIds": ["option_001"]
}
```

示例，多选题：

```json
{
  "correctOptionIds": ["option_001", "option_003"]
}
```

示例，填空题：

```json
{
  "blanks": [
    {
      "index": 1,
      "answers": ["print", "PRINT"],
      "ignoreCase": true,
      "trimSpace": true,
      "score": 5
    }
  ]
}
```

---

### 5.4 question_knowledge_points 题目知识点关联表

字段：

```txt
id                  UUID / BIGINT
question_id         UUID / BIGINT
knowledge_point_id  UUID / BIGINT
created_at          TIMESTAMP
```

索引：

```txt
UNIQUE(question_id, knowledge_point_id)
INDEX(question_id)
INDEX(knowledge_point_id)
```

---

### 5.5 question_tags 题目标签关联表

字段：

```txt
id                  UUID / BIGINT
question_id         UUID / BIGINT
tag_id              UUID / BIGINT
created_at          TIMESTAMP
```

索引：

```txt
UNIQUE(question_id, tag_id)
INDEX(question_id)
INDEX(tag_id)
```

---

### 5.6 question_versions 题目版本表

字段：

```txt
id                  UUID / BIGINT
question_id         UUID / BIGINT
version             INT
snapshot_json       JSONB
created_by          UUID / BIGINT
created_at          TIMESTAMP
```

索引：

```txt
UNIQUE(question_id, version)
INDEX(question_id)
```

说明：

每次修改题目核心内容时生成一条版本记录。快照应包含题干、选项、答案、解析、知识点、标签、分值、难度等信息。

---

## 六、试卷相关表

### 6.1 papers 试卷表

字段：

```txt
id                  UUID / BIGINT
name                VARCHAR(128)
course_id           UUID / BIGINT
total_score         DECIMAL(8,2)
duration_minutes    INT
type                VARCHAR(32)
status              VARCHAR(32)
shuffle_questions   BOOLEAN
shuffle_options     BOOLEAN
created_by          UUID / BIGINT
updated_by          UUID / BIGINT
created_at          TIMESTAMP
updated_at          TIMESTAMP
deleted_at          TIMESTAMP
```

type：

```txt
fixed
rule
random
practice
```

status：

```txt
draft
published
archived
```

索引：

```txt
INDEX(course_id)
INDEX(type)
INDEX(status)
INDEX(created_by)
```

---

### 6.2 paper_sections 试卷分区表

字段：

```txt
id                  UUID / BIGINT
paper_id            UUID / BIGINT
title               VARCHAR(128)
description         TEXT
sort_order          INT
score               DECIMAL(8,2)
shuffle_questions   BOOLEAN
created_at          TIMESTAMP
updated_at          TIMESTAMP
```

索引：

```txt
INDEX(paper_id)
```

示例：

```txt
一、单选题
二、多选题
三、填空题
四、编程题
```

---

### 6.3 paper_questions 试卷题目表

字段：

```txt
id                    UUID / BIGINT
paper_id              UUID / BIGINT
section_id            UUID / BIGINT
question_id           UUID / BIGINT
question_snapshot_json JSONB
score                 DECIMAL(8,2)
sort_order            INT
created_at            TIMESTAMP
updated_at            TIMESTAMP
```

索引：

```txt
INDEX(paper_id)
INDEX(section_id)
INDEX(question_id)
```

说明：

`question_snapshot_json` 保存试卷发布时的题目内容。已发布试卷展示题目时应优先读取快照。

---

### 6.4 paper_rules 组卷规则表

字段：

```txt
id                  UUID / BIGINT
paper_id            UUID / BIGINT
rule_json           JSONB
created_at          TIMESTAMP
updated_at          TIMESTAMP
```

索引：

```txt
INDEX(paper_id)
```

示例：

```json
{
  "rules": [
    {
      "sectionTitle": "单选题",
      "questionType": "single_choice",
      "knowledgePointIds": ["kp_001", "kp_002"],
      "tagIds": ["tag_001"],
      "difficultyRange": [1, 2],
      "count": 10,
      "scoreEach": 2
    }
  ],
  "shuffleQuestions": true,
  "shuffleOptions": true
}
```

---

## 七、考试与答题表

### 7.1 exams 考试表

字段：

```txt
id                      UUID / BIGINT
paper_id                UUID / BIGINT
name                    VARCHAR(128)
course_id               UUID / BIGINT
class_id                UUID / BIGINT
start_time              TIMESTAMP
end_time                TIMESTAMP
duration_minutes        INT
attempt_limit           INT
show_answer_mode        VARCHAR(32)
show_score_mode         VARCHAR(32)
anti_cheat_config_json  JSONB
status                  VARCHAR(32)
created_by              UUID / BIGINT
updated_by              UUID / BIGINT
created_at              TIMESTAMP
updated_at              TIMESTAMP
deleted_at              TIMESTAMP
```

status：

```txt
draft
scheduled
running
ended
archived
```

show_answer_mode：

```txt
never
after_submit
after_exam_end
after_manual
```

show_score_mode：

```txt
never
after_submit
after_graded
after_exam_end
after_manual
```

索引：

```txt
INDEX(paper_id)
INDEX(course_id)
INDEX(class_id)
INDEX(status)
INDEX(start_time)
INDEX(end_time)
```

---

### 7.2 paper_instances 个人试卷实例表

字段：

```txt
id                    UUID / BIGINT
exam_id               UUID / BIGINT
student_id            UUID / BIGINT
paper_snapshot_json   JSONB
question_order_json   JSONB
option_order_json     JSONB
created_at            TIMESTAMP
```

索引：

```txt
UNIQUE(exam_id, student_id)
INDEX(exam_id)
INDEX(student_id)
```

说明：

每个学生进入考试时生成个人试卷实例。学生刷新页面、重新进入考试时，必须读取同一个实例。

---

### 7.3 exam_attempts 答题记录表

字段：

```txt
id                  UUID / BIGINT
exam_id             UUID / BIGINT
student_id          UUID / BIGINT
user_id             UUID / BIGINT
paper_instance_id   UUID / BIGINT
started_at          TIMESTAMP
submitted_at        TIMESTAMP
status              VARCHAR(32)
objective_score     DECIMAL(8,2)
subjective_score    DECIMAL(8,2)
judge_score         DECIMAL(8,2)
total_score         DECIMAL(8,2)
duration_seconds    INT
created_at          TIMESTAMP
updated_at          TIMESTAMP
```

status：

```txt
not_started
in_progress
submitted
grading
graded
cancelled
timeout_submitted
```

索引：

```txt
INDEX(exam_id)
INDEX(student_id)
INDEX(user_id)
INDEX(status)
UNIQUE(exam_id, student_id, id)
```

说明：

如果允许多次作答，则同一个学生同一考试可以有多条 attempt。如果只允许一次作答，应建立业务校验或唯一索引。

---

### 7.4 answer_records 答案记录表

字段：

```txt
id                    UUID / BIGINT
attempt_id             UUID / BIGINT
question_id            UUID / BIGINT
question_snapshot_id   UUID / BIGINT
answer_json            JSONB
is_correct             BOOLEAN
score                  DECIMAL(8,2)
status                 VARCHAR(32)
auto_result_json       JSONB
manual_comment         TEXT
graded_by              UUID / BIGINT
graded_at              TIMESTAMP
created_at             TIMESTAMP
updated_at             TIMESTAMP
```

status：

```txt
saved
submitted
auto_graded
manual_needed
manual_graded
judge_pending
judge_done
```

索引：

```txt
INDEX(attempt_id)
INDEX(question_id)
INDEX(status)
UNIQUE(attempt_id, question_id)
```

answer_json 示例，单选：

```json
{
  "selectedOptionIds": ["option_001"]
}
```

answer_json 示例，多选：

```json
{
  "selectedOptionIds": ["option_001", "option_003"]
}
```

answer_json 示例，填空：

```json
{
  "blanks": [
    {
      "index": 1,
      "value": "print"
    }
  ]
}
```

---

## 八、错题与练习表

### 8.1 wrong_questions 错题表

字段：

```txt
id                    UUID / BIGINT
student_id             UUID / BIGINT
question_id            UUID / BIGINT
source_type            VARCHAR(32)
source_id              UUID / BIGINT
wrong_answer_json      JSONB
correct_answer_json    JSONB
score                  DECIMAL(8,2)
mastery_status         VARCHAR(32)
wrong_count            INT
last_wrong_at          TIMESTAMP
created_at             TIMESTAMP
updated_at             TIMESTAMP
```

source_type：

```txt
exam
practice
manual
ai_recommendation
```

mastery_status：

```txt
unmastered
reviewing
mastered
ignored
```

索引：

```txt
INDEX(student_id)
INDEX(question_id)
INDEX(source_type)
INDEX(mastery_status)
UNIQUE(student_id, question_id)
```

说明：

同一学生同一题多次答错，更新 `wrong_count` 和 `last_wrong_at`。

---

### 8.2 practice_sessions 练习记录表，后期扩展

字段：

```txt
id                  UUID / BIGINT
student_id          UUID / BIGINT
course_id           UUID / BIGINT
source_type         VARCHAR(32)
rule_json           JSONB
started_at          TIMESTAMP
finished_at         TIMESTAMP
status              VARCHAR(32)
created_at          TIMESTAMP
updated_at          TIMESTAMP
```

source_type：

```txt
wrong_question
ai_recommendation
manual
daily_practice
```

---

## 九、编程题与 Hydro 表

### 9.1 programming_problem_refs 编程题外部引用表

字段：

```txt
id                    UUID / BIGINT
question_id            UUID / BIGINT
judge_provider         VARCHAR(32)
external_problem_id    VARCHAR(128)
external_problem_url   TEXT
language_config_json   JSONB
time_limit             INT
memory_limit           INT
judge_config_json      JSONB
created_at             TIMESTAMP
updated_at             TIMESTAMP
```

judge_provider：

```txt
hydro
manual
custom
```

索引：

```txt
INDEX(question_id)
INDEX(judge_provider)
UNIQUE(judge_provider, external_problem_id)
```

---

### 9.2 hydro_accounts Hydro 账号绑定表

字段：

```txt
id                    UUID / BIGINT
student_id             UUID / BIGINT
platform_user_id       UUID / BIGINT
hydro_user_id          VARCHAR(128)
hydro_username         VARCHAR(128)
bind_status            VARCHAR(32)
created_at             TIMESTAMP
updated_at             TIMESTAMP
```

bind_status：

```txt
unbound
bound
disabled
error
```

索引：

```txt
UNIQUE(student_id)
UNIQUE(hydro_user_id)
INDEX(hydro_username)
```

---

### 9.3 judge_submissions 判题提交表

字段：

```txt
id                      UUID / BIGINT
attempt_id               UUID / BIGINT
question_id              UUID / BIGINT
student_id               UUID / BIGINT
provider                 VARCHAR(32)
external_submission_id   VARCHAR(128)
language                 VARCHAR(64)
code_snapshot            TEXT
status                   VARCHAR(32)
score                    DECIMAL(8,2)
result_json              JSONB
submitted_at             TIMESTAMP
judged_at                TIMESTAMP
created_at               TIMESTAMP
updated_at               TIMESTAMP
```

status：

```txt
pending
judging
accepted
wrong_answer
time_limit_exceeded
memory_limit_exceeded
runtime_error
compile_error
system_error
done
```

索引：

```txt
INDEX(attempt_id)
INDEX(question_id)
INDEX(student_id)
INDEX(status)
UNIQUE(provider, external_submission_id)
```

---

### 9.4 hydro_tasks Hydro 测评任务表，后期扩展

字段：

```txt
id                  UUID / BIGINT
title               VARCHAR(128)
course_id           UUID / BIGINT
class_id            UUID / BIGINT
exam_id             UUID / BIGINT
hydro_url           TEXT
hydro_problem_id    VARCHAR(128)
hydro_contest_id    VARCHAR(128)
start_time          TIMESTAMP
end_time            TIMESTAMP
status              VARCHAR(32)
created_by          UUID / BIGINT
created_at          TIMESTAMP
updated_at          TIMESTAMP
```

---

### 9.5 hydro_results Hydro 结果表，后期扩展

字段：

```txt
id                  UUID / BIGINT
task_id             UUID / BIGINT
student_id          UUID / BIGINT
hydro_user_id       VARCHAR(128)
score               DECIMAL(8,2)
status              VARCHAR(32)
submit_count        INT
last_submit_at      TIMESTAMP
raw_result          JSONB
synced_at           TIMESTAMP
created_at          TIMESTAMP
updated_at          TIMESTAMP
```

status：

```txt
not_started
submitted
passed
failed
error
```

---

## 十、AI 分析表

### 10.1 ai_analysis_reports AI 分析报告表

字段：

```txt
id                    UUID / BIGINT
student_id             UUID / BIGINT
exam_id                UUID / BIGINT
attempt_id             UUID / BIGINT
class_id               UUID / BIGINT
type                   VARCHAR(64)
input_snapshot_json    JSONB
output_json            JSONB
status                 VARCHAR(32)
model_name             VARCHAR(128)
error_message          TEXT
created_by             UUID / BIGINT
created_at             TIMESTAMP
updated_at             TIMESTAMP
```

type：

```txt
student_exam_summary
class_exam_summary
weakness_analysis
practice_recommendation
teacher_review_draft
```

status：

```txt
pending
processing
success
failed
cancelled
```

索引：

```txt
INDEX(student_id)
INDEX(exam_id)
INDEX(attempt_id)
INDEX(class_id)
INDEX(type)
INDEX(status)
```

---

### 10.2 ai_prompt_templates AI 提示词模板表，后期扩展

字段：

```txt
id                  UUID / BIGINT
name                VARCHAR(128)
code                VARCHAR(64)
type                VARCHAR(64)
template_content    TEXT
status              VARCHAR(32)
created_by          UUID / BIGINT
created_at          TIMESTAMP
updated_at          TIMESTAMP
```

---

## 十一、导出与文件表

### 11.1 export_tasks 导出任务表

字段：

```txt
id                  UUID / BIGINT
type                VARCHAR(64)
params_json         JSONB
status              VARCHAR(32)
file_url            TEXT
error_message       TEXT
created_by          UUID / BIGINT
created_at          TIMESTAMP
finished_at         TIMESTAMP
```

type：

```txt
paper_pdf
paper_word
paper_answer_pdf
exam_result_excel
question_bank_excel
wrong_question_pdf
```

status：

```txt
pending
processing
success
failed
expired
```

索引：

```txt
INDEX(type)
INDEX(status)
INDEX(created_by)
INDEX(created_at)
```

---

### 11.2 files 文件表

字段：

```txt
id                  UUID / BIGINT
bucket              VARCHAR(64)
object_key          TEXT
file_name           VARCHAR(255)
file_ext            VARCHAR(32)
mime_type           VARCHAR(128)
file_size           BIGINT
url                 TEXT
visibility          VARCHAR(32)
created_by          UUID / BIGINT
created_at          TIMESTAMP
deleted_at          TIMESTAMP
```

visibility：

```txt
public
private
temporary
```

---

## 十二、通知与日志表

### 12.1 notifications 通知表

字段：

```txt
id                  UUID / BIGINT
user_id             UUID / BIGINT
title               VARCHAR(128)
content             TEXT
type                VARCHAR(32)
biz_type            VARCHAR(64)
biz_id              UUID / BIGINT
read_at             TIMESTAMP
created_at          TIMESTAMP
```

type：

```txt
exam
grading
ai_report
system
hydro
```

---

### 12.2 audit_logs 操作日志表

字段：

```txt
id                  UUID / BIGINT
user_id             UUID / BIGINT
action              VARCHAR(128)
module              VARCHAR(64)
target_type         VARCHAR(64)
target_id           UUID / BIGINT
before_data         JSONB
after_data          JSONB
ip                  VARCHAR(64)
user_agent          TEXT
created_at          TIMESTAMP
```

索引：

```txt
INDEX(user_id)
INDEX(module)
INDEX(target_type, target_id)
INDEX(created_at)
```

需要记录日志的操作：

1. 登录。
2. 创建题目。
3. 修改题目。
4. 删除题目。
5. 发布试卷。
6. 发布考试。
7. 学生提交试卷。
8. 老师批改试卷。
9. 导出成绩。
10. 修改权限。
11. 修改系统配置。
12. Hydro 同步结果。
13. AI 生成报告。

---

## 十三、状态机设计

### 13.1 题目状态机

```txt
draft → pending_review → published
draft → archived
published → disabled
disabled → published
published → archived
```

### 13.2 试卷状态机

```txt
draft → published → archived
```

规则：

1. draft 可以编辑。
2. published 不允许破坏性修改。
3. archived 不允许发布考试。

### 13.3 考试状态机

```txt
draft → scheduled → running → ended → archived
```

规则：

1. draft 可编辑。
2. scheduled 可取消。
3. running 可提前结束。
4. ended 可统计和导出。
5. archived 只读。

### 13.4 答题状态机

```txt
not_started → in_progress → submitted → grading → graded
in_progress → timeout_submitted → grading
```

规则：

1. submitted 后不可修改答案。
2. grading 表示存在主观题或编程题未完成。
3. graded 表示成绩已汇总完成。
4. timeout_submitted 表示系统自动交卷。

---

## 十四、关键约束

### 14.1 题目快照约束

试卷发布时必须保存题目快照。

保存内容：

1. 题干。
2. 题型。
3. 选项。
4. 正确答案。
5. 解析。
6. 分值。
7. 难度。
8. 知识点。
9. 标签。
10. 判分规则。

### 14.2 选项随机约束

1. 选项必须有稳定 ID。
2. 展示顺序可以随机。
3. 学生提交必须提交 option_id。
4. 后端判分必须按 option_id 判断。
5. A/B/C/D 不能作为判分依据。

### 14.3 个人试卷实例约束

1. 每个学生进入考试生成一次。
2. 重复进入读取同一实例。
3. 题目顺序保存。
4. 选项顺序保存。
5. 题目内容保存快照。
6. 不受题库后续修改影响。

### 14.4 成绩汇总约束

成绩来源：

```txt
total_score = objective_score + subjective_score + judge_score
```

要求：

1. 客观题自动判分。
2. 主观题人工判分。
3. 编程题由 Hydro 返回分数。
4. 汇总过程必须幂等。
5. 重复触发汇总不能重复加分。
6. 成绩变更必须记录日志。

---

## 十五、Prisma 模型示例

以下为示例，不是完整 schema。

```prisma
model User {
  id           String   @id @default(uuid())
  username     String   @unique
  phone        String?  @unique
  email        String?  @unique
  passwordHash String
  realName     String?
  avatarUrl    String?
  userType     String
  status       String   @default("ACTIVE")
  lastLoginAt  DateTime?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  deletedAt    DateTime?

  roles        UserRole[]
}

model Course {
  id          String   @id @default(uuid())
  name        String
  code        String   @unique
  description String?
  coverUrl    String?
  status      String   @default("ACTIVE")
  sortOrder   Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  deletedAt   DateTime?

  questions   Question[]
}

model Question {
  id                 String   @id @default(uuid())
  courseId           String
  type               String
  title              String
  content            String
  difficulty         Int
  defaultScore       Decimal  @db.Decimal(8, 2)
  analysis           String?
  status             String   @default("draft")
  version            Int      @default(1)
  allowOptionShuffle Boolean  @default(true)
  createdBy          String?
  reviewedBy         String?
  reviewedAt         DateTime?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  deletedAt          DateTime?

  course             Course   @relation(fields: [courseId], references: [id])
  options            QuestionOption[]
  answer             QuestionAnswer?
}

model QuestionOption {
  id         String   @id @default(uuid())
  questionId String
  optionKey  String
  content    String
  isCorrect  Boolean  @default(false)
  sortOrder  Int      @default(0)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  question   Question @relation(fields: [questionId], references: [id])
}

model QuestionAnswer {
  id              String   @id @default(uuid())
  questionId       String   @unique
  answerJson       Json
  scoringRuleJson  Json?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  question         Question @relation(fields: [questionId], references: [id])
}
```

---

## 十六、第一阶段必须建表清单

MVP 必建表：

```txt
users
roles
permissions
role_permissions
user_roles

courses
knowledge_points
tags

questions
question_options
question_answers
question_knowledge_points
question_tags
question_versions

papers
paper_sections
paper_questions
paper_rules

exams
paper_instances
exam_attempts
answer_records

wrong_questions
export_tasks
files
audit_logs
notifications
classes
class_students
class_teachers
```

第二阶段新增：

```txt
programming_problem_refs
judge_submissions
hydro_accounts
hydro_tasks
hydro_results
ai_analysis_reports
ai_prompt_templates
practice_sessions
```

也可以第一阶段先建空表，接口后期再开放。

---

## 十七、2026-06-27 新增班级范围表

### 17.1 classes

```txt
id          UUID PK
name        班级名称
code        系统编码，唯一
course_id   可选，关联课程
description 说明
status      active / disabled / archived
sort_order  排序
created_by
updated_by
created_at
updated_at
deleted_at
```

### 17.2 class_students

```txt
id         UUID PK
class_id   班级 ID
student_id 学生用户 ID
joined_at
unique(class_id, student_id)
```

### 17.3 class_teachers

```txt
id         UUID PK
class_id   班级 ID
teacher_id 教师/管理员用户 ID
joined_at
unique(class_id, teacher_id)
```

### 17.4 范围说明

- `exams.class_id` 表示考试限定班级；为空表示公开给所有学生。
- 学生端考试查询和进入考试均校验 `class_students`。
- 教师数据范围后续可继续基于 `class_teachers` 做细粒度收敛。
