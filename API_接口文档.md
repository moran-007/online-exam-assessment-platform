# 在线答题与智能测评平台 API 接口文档

版本：v1.0  
接口风格：REST API  
统一前缀：`/api/v1`  
认证方式：JWT Access Token + Refresh Token

---

## 一、接口通用规范

### 1.1 请求 Header

需要登录的接口必须携带：

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

文件上传接口使用：

```http
Content-Type: multipart/form-data
```

---

### 1.2 统一成功返回

```json
{
  "code": 0,
  "message": "ok",
  "data": {}
}
```

---

### 1.3 统一分页返回

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "items": [],
    "page": 1,
    "pageSize": 20,
    "total": 100
  }
}
```

---

### 1.4 统一失败返回

```json
{
  "code": 40001,
  "message": "无权限访问",
  "data": null
}
```

---

### 1.5 常用错误码

```txt
0       成功
40000   请求参数错误
40001   无权限
40002   未登录
40003   Token 过期
40004   数据不存在
40005   状态不允许操作
40006   重复提交
40007   考试未开始
40008   考试已结束
40009   超出作答次数
40010   题库数量不足
40011   答案已提交，不能修改
40012   导出任务不存在
40013   Hydro 同步失败
40014   AI 分析失败
50000   系统错误
```

---

## 二、认证 Auth 接口

### 2.1 登录

```http
POST /api/v1/auth/login
```

请求：

```json
{
  "username": "teacher001",
  "password": "123456",
  "rememberMe": true
}
```

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "accessToken": "xxx",
    "refreshToken": "xxx",
    "session": {
      "rememberMe": true,
      "idleTimeoutMs": 1800000,
      "expiresAt": "2026-07-10T08:00:00.000Z"
    },
    "user": {
      "id": "user_001",
      "username": "teacher001",
      "realName": "张老师",
      "userType": "TEACHER"
    }
  }
}
```

材料题请求：

```json
{
  "courseId": "course_001",
  "type": "material",
  "title": "阅读材料：循环结构",
  "content": "阅读下面材料并回答子题。",
  "difficulty": 2,
  "defaultScore": 10,
  "children": [
    {
      "questionId": "question_child_choice",
      "score": 3,
      "sortOrder": 1
    },
    {
      "questionId": "question_child_short",
      "score": 7,
      "sortOrder": 2
    }
  ]
}
```

说明：当前材料题只支持单层组合，子题必须是已存在的非材料题。父题不直接判分，默认总分由子题分值汇总。题目详情、试卷和学生作答响应会保留原字段，并额外返回嵌套 `children`。

---

### 2.2 刷新 Token

```http
POST /api/v1/auth/refresh
```

请求：

```json
{
  "refreshToken": "xxx"
}
```

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "accessToken": "new_access_token",
    "refreshToken": "new_refresh_token",
    "session": {
      "rememberMe": true,
      "idleTimeoutMs": 1800000,
      "expiresAt": "2026-07-10T08:15:00.000Z"
    }
  }
}
```

---

### 2.3 上报有效操作

```http
POST /api/v1/auth/activity
Authorization: Bearer <accessToken>
X-Session-Activity: 1
```

前端仅在点击、键盘、触摸、滚动等真实操作后节流上报。成功返回 `true`；超过闲置时长后返回 `401`，且该会话不能再刷新。

---

### 2.4 获取当前用户

```http
GET /api/v1/auth/me
```

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": "user_001",
    "username": "teacher001",
    "realName": "张老师",
    "userType": "TEACHER",
    "roles": ["teacher"],
    "permissions": ["question:create", "paper:create"]
  }
}
```

---

### 2.5 退出登录

```http
POST /api/v1/auth/logout
```

请求：

```json
{
  "refreshToken": "xxx"
}
```

退出时会吊销该 Refresh Token 所属的整个登录会话，已签发的 Access Token 也不能继续访问受保护接口。

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": true
}
```

---

## 三、课程 Course 接口

### 3.1 获取课程列表

```http
GET /api/v1/courses?page=1&pageSize=20&keyword=Python&status=ACTIVE
```

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "items": [
      {
        "id": "course_001",
        "name": "Python 基础",
        "code": "python_basic",
        "status": "ACTIVE",
        "sortOrder": 1
      }
    ],
    "page": 1,
    "pageSize": 20,
    "total": 1
  }
}
```

---

### 3.2 创建课程

```http
POST /api/v1/courses
```

请求：

```json
{
  "name": "Python 基础",
  "code": "python_basic",
  "description": "Python 入门课程",
  "coverUrl": "",
  "sortOrder": 1
}
```

---

### 3.3 获取课程详情

```http
GET /api/v1/courses/:id
```

---

### 3.4 更新课程

```http
PATCH /api/v1/courses/:id
```

请求：

```json
{
  "name": "Python 编程基础",
  "description": "更新后的描述",
  "sortOrder": 2
}
```

---

### 3.5 禁用课程

```http
POST /api/v1/courses/:id/disable
```

---

## 四、知识点 KnowledgePoint 接口

### 4.1 获取知识点树

```http
GET /api/v1/knowledge-points/tree?courseId=course_001
```

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": [
    {
      "id": "kp_001",
      "name": "Python 基础",
      "children": [
        {
          "id": "kp_002",
          "name": "变量",
          "children": []
        }
      ]
    }
  ]
}
```

---

### 4.2 创建知识点

```http
POST /api/v1/knowledge-points
```

请求：

```json
{
  "courseId": "course_001",
  "parentId": null,
  "name": "变量",
  "code": "variable",
  "sortOrder": 1
}
```

---

### 4.3 更新知识点

```http
PATCH /api/v1/knowledge-points/:id
```

---

### 4.4 删除知识点

```http
DELETE /api/v1/knowledge-points/:id
```

规则：

1. 已绑定题目的知识点不能直接删除。
2. 有子级知识点时不能直接删除。
3. 可改为禁用。

---

## 五、标签 Tag 接口

### 5.1 获取标签列表

```http
GET /api/v1/tags?type=QUESTION&keyword=易错
```

---

### 5.2 创建标签

```http
POST /api/v1/tags
```

请求：

```json
{
  "name": "易错题",
  "code": "error_prone",
  "type": "QUESTION"
}
```

---

### 5.3 更新标签

```http
PATCH /api/v1/tags/:id
```

---

### 5.4 删除标签

```http
DELETE /api/v1/tags/:id
```

---

## 六、题库 Question 接口

### 6.0 获取题型元数据

```http
GET /api/v1/question-types
```

返回安全的题型注册表元数据：题型 code、中文名、版本、是否支持自动判分/人工批改/外部 Judge，以及题目、答案、评分规则 JSON Schema。接口不返回正确答案内容，也不返回可执行组件代码。

```json
{
  "code": 0,
  "message": "ok",
  "data": [
    {
      "code": "single_choice",
      "name": "单选题",
      "version": "1.0.0",
      "capabilities": {
        "autoGrade": true,
        "manualGrade": false
      }
    }
  ]
}
```

### 6.1 获取题目列表

```http
GET /api/v1/questions?page=1&pageSize=20&type=single_choice&courseId=course_001&difficulty=2&status=published&sortBy=createdAt&sortOrder=desc
```

查询参数：

| 参数 | 说明 |
| --- | --- |
| page/pageSize | 分页，pageSize 最大 100 |
| keyword | 按题目标题、题干搜索 |
| type | 题型 |
| status | 状态 |
| courseId/tagId/knowledgePointId | 按课程、标签、知识点过滤 |
| difficulty | 难度 1-5 |
| sortBy | 单字段排序：createdAt、updatedAt、difficulty、type、status、defaultScore、title |
| sortOrder | asc 或 desc |

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "items": [
      {
        "id": "question_001",
        "type": "single_choice",
        "title": "以下哪个是 Python 输出函数？",
        "difficulty": 1,
        "defaultScore": 2,
        "status": "published",
        "courseName": "Python 基础",
        "createdAt": "2026-06-26T10:00:00Z"
      }
    ],
    "page": 1,
    "pageSize": 20,
    "total": 1
  }
}
```

---

### 6.2 创建题目

```http
POST /api/v1/questions
```

单选题请求：

```json
{
  "courseId": "course_001",
  "type": "single_choice",
  "title": "Python 输出函数",
  "content": "以下哪个函数可以输出内容？",
  "difficulty": 1,
  "defaultScore": 2,
  "analysis": "print 用于输出内容。",
  "allowOptionShuffle": true,
  "knowledgePointIds": ["kp_001"],
  "tagIds": ["tag_001"],
  "options": [
    {
      "optionKey": "A",
      "content": "input",
      "isCorrect": false,
      "sortOrder": 1
    },
    {
      "optionKey": "B",
      "content": "print",
      "isCorrect": true,
      "sortOrder": 2
    },
    {
      "optionKey": "C",
      "content": "len",
      "isCorrect": false,
      "sortOrder": 3
    }
  ],
  "answer": {
    "correctOptionKeys": ["B"]
  },
  "scoringRule": {
    "mode": "strict"
  }
}
```

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": "question_001"
  }
}
```

---

### 6.3 获取题目详情

```http
GET /api/v1/questions/:id
```

教师端返回可包含答案。学生考试中不得直接调用该接口获取答案。

---

### 6.4 更新题目

```http
PATCH /api/v1/questions/:id
```

规则：

1. 修改题干、选项、答案、解析时生成新版本。
2. 已发布考试不受影响。
3. 修改后题目状态可回到待审核。

---

### 6.5 删除题目

```http
DELETE /api/v1/questions/:id
```

规则：

1. 使用软删除。
2. 已被试卷使用的题目不建议物理删除。
3. 可改为 archived。

---

### 6.6 题目重复检测

```http
POST /api/v1/questions/duplicate-check
```

---

### 6.7 批量删除题目

```http
POST /api/v1/questions/batch/delete
```

请求：

```json
{
  "ids": ["question_001", "question_002"]
}
```

---

### 6.8 批量更新题目状态

```http
PATCH /api/v1/questions/batch/status
```

请求：

```json
{
  "ids": ["question_001"],
  "status": "published"
}
```

---

### 6.9 发布题目

```http
POST /api/v1/questions/:id/publish
```

---

### 6.10 导入题库

```http
POST /api/v1/questions/import
```

请求：

```http
Content-Type: multipart/form-data
file=<excel_file>
publish=false
skipDuplicates=true
```

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "importedCount": 80,
    "skippedCount": 2,
    "failedCount": 1,
    "total": 83,
    "items": [
      {
        "rowNumber": 2,
        "title": "Python 输出",
        "status": "imported",
        "questionId": "question_001",
        "message": "已导入为草稿"
      }
    ]
  }
}
```

说明：当前后端支持 `.xlsx` 模板导入，导入时会校验题型、课程、知识点、标签、答案和重复题。课程、知识点、题目标签可按名称自动复用或创建。

---

### 6.11 下载题库导入模板

```http
GET /api/v1/questions/import-template
```

---

### 6.12 导出题库

```http
POST /api/v1/questions/export
```

请求：

```json
{
  "courseId": "course_001",
  "type": "single_choice",
  "knowledgePointIds": ["kp_001"],
  "tagIds": ["tag_001"],
  "difficultyRange": [1, 3]
}
```

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "taskId": "export_001"
  }
}
```

---

## 七、试卷 Paper 接口

### 7.1 获取试卷列表

```http
GET /api/v1/papers?page=1&pageSize=20&courseId=course_001&status=draft&sortBy=createdAt&sortOrder=desc
```

查询参数：

| 参数 | 说明 |
| --- | --- |
| page/pageSize | 分页，pageSize 最大 100 |
| keyword | 按试卷名称搜索 |
| courseId | 按课程过滤 |
| status | draft、published、archived |
| sortBy | 单字段排序：createdAt、updatedAt、name、type、totalScore、durationMinutes、status |
| sortOrder | asc 或 desc |

---

### 7.2 创建试卷

```http
POST /api/v1/papers
```

请求：

```json
{
  "name": "Python 第一阶段测试",
  "courseId": "course_001",
  "durationMinutes": 60,
  "type": "fixed",
  "shuffleQuestions": true,
  "shuffleOptions": true
}
```

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": "paper_001"
  }
}
```

---

### 7.3 获取试卷详情

```http
GET /api/v1/papers/:id
```

---

### 7.4 更新试卷

```http
PATCH /api/v1/papers/:id
```

---

### 7.5 添加题目到试卷

```http
POST /api/v1/papers/:id/questions
```

请求：

```json
{
  "sectionId": "section_001",
  "questionId": "question_001",
  "score": 2,
  "sortOrder": 1
}
```

---

### 7.6 从试卷移除题目

```http
DELETE /api/v1/papers/:id/questions/:paperQuestionId
```

---

### 7.7 创建试卷分区

```http
POST /api/v1/papers/:id/sections
```

请求：

```json
{
  "title": "一、单选题",
  "description": "每题 2 分",
  "sortOrder": 1,
  "shuffleQuestions": true
}
```

---

### 7.8 规则组卷

```http
POST /api/v1/papers/:id/generate-by-rule
```

请求：

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
    },
    {
      "sectionTitle": "多选题",
      "questionType": "multiple_choice",
      "knowledgePointIds": ["kp_003"],
      "tagIds": [],
      "difficultyRange": [2, 3],
      "count": 5,
      "scoreEach": 4
    }
  ],
  "shuffleQuestions": true,
  "shuffleOptions": true
}
```

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "paperId": "paper_001",
    "totalScore": 40,
    "questionCount": 15
  }
}
```

---

### 7.9 校验组卷规则

```http
POST /api/v1/papers/validate-rules
```

请求同规则组卷。

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "valid": true,
    "items": [
      {
        "sectionTitle": "单选题",
        "requiredCount": 10,
        "availableCount": 35,
        "valid": true
      }
    ]
  }
}
```

---

### 7.10 预览试卷

```http
GET /api/v1/papers/:id/preview
```

---

### 7.11 发布试卷

```http
POST /api/v1/papers/:id/publish
```

规则：

1. 必须至少有一道题。
2. 必须计算总分。
3. 必须生成题目快照。
4. 试卷状态变为 published。

---

### 7.12 导出试卷

```http
POST /api/v1/papers/:id/export
```

请求：

```json
{
  "format": "pdf",
  "mode": "blank"
}
```

format：

```txt
pdf
word
```

mode：

```txt
blank
with_answer
with_analysis
```

---

## 八、考试 Exam 接口

### 8.1 获取考试列表

```http
GET /api/v1/exams?page=1&pageSize=20&courseId=course_001&classId=class_001&status=scheduled&sortBy=startTime&sortOrder=desc
```

查询参数：

| 参数 | 说明 |
| --- | --- |
| page/pageSize | 分页，pageSize 最大 100 |
| keyword | 按考试名称搜索 |
| courseId/classId | 按课程、班级过滤 |
| status | draft、scheduled、running、ended |
| sortBy | 单字段排序：createdAt、updatedAt、startTime、endTime、name、status、durationMinutes |
| sortOrder | asc 或 desc |

---

### 8.2 创建考试

```http
POST /api/v1/exams
```

请求：

```json
{
  "paperId": "paper_001",
  "name": "Python 第一阶段考试",
  "courseId": "course_001",
  "classId": "class_001",
  "startTime": "2026-07-01T09:00:00+08:00",
  "endTime": "2026-07-01T18:00:00+08:00",
  "durationMinutes": 60,
  "attemptLimit": 1,
  "showAnswerMode": "after_exam_end",
  "showScoreMode": "after_submit",
  "antiCheatConfig": {
    "recordSwitchScreen": true,
    "limitSwitchScreenCount": 5
  }
}
```

---

### 8.3 获取考试详情

```http
GET /api/v1/exams/:id
```

---

### 8.4 更新考试

```http
PATCH /api/v1/exams/:id
```

规则：

1. running / ended 状态下，普通教师和助教不允许修改核心考试配置，只能单独更新状态。
2. `SUPER_ADMIN` / `ADMIN` 可兜底修改核心配置。
3. 修改时间必须校验合法性。

---

### 8.5 发布考试

```http
POST /api/v1/exams/:id/publish
```

---

### 8.6 开始考试，管理操作

```http
POST /api/v1/exams/:id/start
```

---

### 8.7 结束考试，管理操作

```http
POST /api/v1/exams/:id/end
```

说明：手动结束会将考试 `endTime` 更新为当前时间，并自动提交所有进行中的答卷；客观题立即判分，主观题进入待批改，编程题等待 Judge 结果或人工回写。

---

### 8.8 获取考试成绩

```http
GET /api/v1/exams/:id/results?page=1&pageSize=20
```

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "items": [
      {
        "studentId": "student_001",
        "studentName": "小明",
        "totalScore": 88,
        "objectiveScore": 68,
        "subjectiveScore": 10,
        "judgeScore": 10,
        "rank": 1,
        "status": "graded",
        "submittedAt": "2026-07-01T10:00:00+08:00"
      }
    ],
    "page": 1,
    "pageSize": 20,
    "total": 1
  }
}
```

---

### 8.9 获取考试统计

```http
GET /api/v1/exams/:id/statistics
```

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "averageScore": 76.5,
    "maxScore": 98,
    "minScore": 32,
    "submitCount": 30,
    "studentCount": 35,
    "passRate": 0.82,
    "excellentRate": 0.3,
    "questionStats": [],
    "knowledgePointStats": []
  }
}
```

---

### 8.10 获取考试公告阅读统计

```http
GET /api/v1/exams/:id/announcement-reads
```

权限：

```txt
exam:result:read
```

说明：

1. 用于教师/管理员查看学生是否已阅读当前有效公告。
2. 班级考试按 `class_students` 统计应读学生。
3. 公开考试按已阅读公告或已进入考试的学生汇总，不默认统计全站学生。
4. 当考试没有有效公告时返回空统计。

返回：

```json
{
  "examId": "exam_001",
  "examName": "Python 第一阶段考试",
  "courseName": "Python Basic",
  "className": "一班",
  "announcement": {
    "id": "announcement_001",
    "version": 2,
    "content": "请先阅读考试规则。",
    "createdAt": "2026-06-30T10:00:00.000Z",
    "updatedAt": "2026-06-30T10:00:00.000Z"
  },
  "expectedCount": 30,
  "readCount": 28,
  "unreadCount": 2,
  "enteredCount": 25,
  "submittedCount": 20,
  "items": [
    {
      "userId": "user_001",
      "username": "student001",
      "realName": "学生一",
      "read": true,
      "readAt": "2026-06-30T10:05:00.000Z",
      "entered": true,
      "enteredAt": "2026-06-30T10:06:00.000Z",
      "submitted": false,
      "submittedAt": null
    }
  ]
}
```

---

### 8.11 发送考试公告未读提醒

```http
POST /api/v1/exams/:id/announcement-reads/remind
```

权限：

```txt
exam:result:read
```

请求：

```json
{
  "content": "请尽快阅读考试公告，确认考试规则后再进入考试。"
}
```

说明：

1. 基于 `GET /exams/:id/announcement-reads` 的未读名单生成站内通知。
2. 已存在未读提醒且学生未读通知时不会重复创建。
3. 前端可筛选未读学生，并支持导出 CSV 名单。

返回：

```json
{
  "examId": "exam_001",
  "announcementId": "announcement_001",
  "targetCount": 2,
  "createdCount": 1,
  "skippedCount": 1,
  "items": []
}
```

---

### 8.12 导出考试成绩

```http
POST /api/v1/exams/:id/export-results
```

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "taskId": "export_001"
  }
}
```

---

## 九、学生答题 Student Exam 接口

### 9.1 获取我的考试

```http
GET /api/v1/student/exams?status=running&sortBy=startTime&sortOrder=desc
```

查询参数：

| 参数 | 说明 |
| --- | --- |
| status | scheduled、running、ended |
| sortBy | 单字段排序：startTime、endTime、createdAt、name、status、durationMinutes |
| sortOrder | asc 或 desc |

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": [
    {
      "examId": "exam_001",
      "name": "Python 第一阶段考试",
      "startTime": "2026-07-01T09:00:00+08:00",
      "endTime": "2026-07-01T18:00:00+08:00",
      "durationMinutes": 60,
      "status": "running",
      "attemptStatus": "not_started"
    }
  ]
}
```

---

### 9.2 获取单场考试排名

```http
GET /api/v1/student/exams/:examId/ranking
```

返回当前学生可见的考试排名列表，并标记当前学生记录。

---

### 9.3 进入考试

```http
POST /api/v1/student/exams/:examId/enter
```

功能：

1. 校验考试是否可进入。
2. 校验学生是否有权限。
3. 校验考试时间。
4. 校验作答次数。
5. 生成或读取 paper_instance。
6. 生成或读取 attempt。

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "attemptId": "attempt_001",
    "exam": {
      "id": "exam_001",
      "name": "Python 第一阶段考试",
      "durationMinutes": 60,
      "serverTime": "2026-07-01T09:05:00+08:00"
    },
    "paper": {
      "paperInstanceId": "instance_001",
      "sections": [
        {
          "title": "一、单选题",
          "questions": [
            {
              "questionId": "question_001",
              "type": "single_choice",
              "content": "以下哪个函数可以输出内容？",
              "score": 2,
              "options": [
                {
                  "optionId": "option_101",
                  "label": "A",
                  "content": "input"
                },
                {
                  "optionId": "option_102",
                  "label": "B",
                  "content": "print"
                }
              ]
            }
          ]
        }
      ]
    }
  }
}
```

注意：学生进入考试接口不能返回正确答案和解析。

---

### 9.4 获取答题记录

```http
GET /api/v1/student/attempts/:attemptId
```

用于刷新页面恢复答题状态。

---

### 9.5 保存答案

```http
POST /api/v1/student/attempts/:attemptId/save-answer
```

请求：

```json
{
  "questionId": "question_001",
  "answer": {
    "selectedOptionIds": ["option_102"]
  }
}
```

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "saved": true,
    "savedAt": "2026-07-01T09:10:00+08:00"
  }
}
```

规则：

1. 已提交 attempt 不能保存。
2. 考试结束后不能保存。
3. 保存接口必须轻量化。
4. 重复保存同题答案时覆盖旧答案。
5. 需要记录更新时间。

---

### 9.6 批量保存答案

```http
POST /api/v1/student/attempts/:attemptId/save-answers
```

请求：

```json
{
  "answers": [
    {
      "questionId": "question_001",
      "answer": {
        "selectedOptionIds": ["option_102"]
      }
    },
    {
      "questionId": "question_002",
      "answer": {
        "blanks": [
          {
            "index": 1,
            "value": "print"
          }
        ]
      }
    }
  ]
}
```

---

### 9.7 提交试卷

```http
POST /api/v1/student/attempts/:attemptId/submit
```

请求：

```json
{
  "confirm": true
}
```

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "attemptId": "attempt_001",
    "status": "graded",
    "totalScore": 88,
    "objectiveScore": 68,
    "subjectiveScore": 10,
    "judgeScore": 10
  }
}
```

规则：

1. 提交接口必须幂等。
2. 重复提交返回已有结果。
3. 提交后不能修改答案。
4. 客观题立即判分。
5. 有主观题时进入 grading。
6. 有编程题时等待 Hydro 结果。

---

### 9.8 查看考试结果

```http
GET /api/v1/student/attempts/:attemptId/result
```

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "totalScore": 88,
    "objectiveScore": 68,
    "subjectiveScore": 10,
    "judgeScore": 10,
    "durationSeconds": 3200,
    "questionResults": [
      {
        "questionId": "question_001",
        "type": "single_choice",
        "score": 2,
        "studentScore": 2,
        "isCorrect": true,
        "studentAnswer": {
          "selectedOptionIds": ["option_102"]
        },
        "correctAnswer": {
          "correctOptionIds": ["option_102"]
        },
        "analysis": "print 用于输出内容。"
      }
    ],
    "knowledgePointStats": []
  }
}
```

规则：

1. 是否返回正确答案取决于考试配置。
2. 是否返回解析取决于考试配置。
3. 未批改完成时应显示“待批改”。

---

## 十、批改 Grading 接口

### 10.1 获取待批改列表

```http
GET /api/v1/grading/answers?examId=exam_001&studentId=student_001&status=pending&keyword=循环&page=1&pageSize=20
```

说明：列表会根据字段权限裁剪成绩、学生答案、参考答案、解析和学生身份字段；无权限字段保留响应键但返回空值或脱敏值，并在 `_fieldAccess` 中说明当前可见范围。

---

### 10.2 获取某次答题详情

```http
GET /api/v1/grading/attempts/:attemptId
```

---

### 10.3 批改单题

```http
PATCH /api/v1/grading/answers/:answerRecordId
```

请求：

```json
{
  "score": 8,
  "comment": "思路正确，但表述不完整。",
  "rubricScores": [
    {
      "dimensionId": "accuracy",
      "score": 5,
      "comment": "关键点完整"
    },
    {
      "dimensionId": "clarity",
      "score": 2,
      "comment": "表达清楚"
    }
  ]
}
```

说明：普通主观题可直接提交 `score`；配置 rubric 的题目必须提交 `rubricScores`，总分由服务端按维度求和，不能由客户端直接覆盖。每次人工批改都会写入评分历史。

---

### 10.4 完成整份试卷批改

```http
POST /api/v1/grading/attempts/:attemptId/finish
```

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "attemptId": "attempt_001",
    "status": "graded",
    "totalScore": 88
  }
}
```

---

### 10.5 重新判分

```http
POST /api/v1/grading/attempts/:attemptId/regrade
```

说明：

兼容旧接口。内部会创建单次试算重判任务并立即确认，使用考试快照评分规则，确认前仍会校验答案更新时间和得分指纹。

---

### 10.5.1 试算重判

```http
POST /api/v1/grading/regrade-runs/preview
GET /api/v1/grading/regrade-runs/:id
POST /api/v1/grading/regrade-runs/:id/confirm
POST /api/v1/grading/regrade-runs/:id/cancel
```

试算请求：

```json
{
  "examId": "exam_001",
  "questionId": "question_001",
  "studentId": "student_001",
  "ruleSource": "snapshot",
  "reason": "修正多选题评分规则"
}
```

说明：

1. `ruleSource` 支持 `snapshot`、`latest` 和指定规则版本。
2. 单次最多处理 5000 条答案；试算只生成差异预览，不改变正式成绩。
3. `confirm` 会在事务内更新正式得分、答题总分和审计记录；如果答案已变化则拒绝覆盖。
4. AI 建议不得作为正式评价来源，正式分数只能由自动判分、人工批改、Judge 或确认后的重判写入。

---

### 10.6 发布成绩

```http
POST /api/v1/grading/exams/:examId/grades/publish
```

请求：

```json
{
  "attemptIds": ["attempt_001"],
  "studentIds": ["student_001"],
  "mode": "after_graded",
  "skipPending": false
}
```

说明：

1. 默认将可发布的提交记录标记为 `graded`。
2. 默认把考试 `showScoreMode` 切换为 `after_graded`，学生端只看到已完成批改的成绩。
3. 存在 `manual_needed` 或 `judge_pending` 时默认阻断；`skipPending=true` 时跳过未完成批改的提交。

---

### 10.7 撤回成绩

```http
POST /api/v1/grading/exams/:examId/grades/withdraw
```

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "examId": "exam_001",
    "showScoreMode": "never",
    "withdrawn": true
  }
}
```

---

## 十一、错题 WrongQuestion 接口

### 11.1 获取我的错题

```http
GET /api/v1/student/wrong-questions?courseId=course_001&knowledgePointId=kp_001&type=single_choice&masteryStatus=unmastered
```

---

### 11.2 查看错题详情

```http
GET /api/v1/student/wrong-questions/:id
```

---

### 11.3 标记已掌握

```http
POST /api/v1/student/wrong-questions/:id/mark-mastered
```

---

### 11.4 忽略错题

```http
POST /api/v1/student/wrong-questions/:id/ignore
```

---

## 十二、Hydro / Judge 接口

### 12.1 Hydro 平台配置

```http
GET    /api/v1/hydro/settings
GET    /api/v1/hydro/platforms
POST   /api/v1/hydro/platforms
PATCH  /api/v1/hydro/platforms/:id
DELETE /api/v1/hydro/platforms/:id
```

说明：

1. `settings` 返回默认 Hydro 站点、回调配置和代码提交能力开关。
2. 平台增删改仅 `SUPER_ADMIN` 可用。
3. Judge Provider 当前以 Hydro 为默认实现，提交记录中保留 `provider` 字段，后续可扩展为其他 OJ。

---

### 12.2 编程题绑定

```http
GET    /api/v1/hydro/problems
GET    /api/v1/hydro/problems/pull?problemUrl=https://hydro.example.com/p/1001
GET    /api/v1/hydro/questions/:questionId/binding
PUT    /api/v1/hydro/questions/:questionId/binding
DELETE /api/v1/hydro/questions/:questionId/binding
```

绑定请求：

```json
{
  "judgeProvider": "hydro",
  "externalProblemId": "1001",
  "externalProblemUrl": "https://hydro.example.com/p/1001",
  "platformBaseUrl": "https://hydro.example.com",
  "domainId": "system",
  "languages": ["py.py3", "cc.cc17o2"]
}
```

---

### 12.3 Hydro 账号绑定

管理员/教师端：

```txt
GET    /api/v1/hydro/accounts
PUT    /api/v1/hydro/accounts/:studentId
POST   /api/v1/hydro/accounts/:accountId/test
DELETE /api/v1/hydro/accounts/:accountId
```

学生个人端：

```txt
GET    /api/v1/hydro/my/accounts
GET    /api/v1/hydro/my/account
PUT    /api/v1/hydro/my/account
POST   /api/v1/hydro/my/accounts/:accountId/test
DELETE /api/v1/hydro/my/accounts/:accountId
```

权限规则：

- `SUPER_ADMIN` 可查看、创建、编辑、检测学生或教师的外部账号。
- `TEACHER` / `ASSISTANT` 按班级数据范围管理学生外部账号。
- `STUDENT` 只能通过 `/hydro/my/*` 查看、添加、编辑、检测自己的外部账号。

---

### 12.4 Hydro 任务看板

```http
GET   /api/v1/hydro/tasks?page=1&pageSize=20&examId=exam_001&status=active
POST  /api/v1/hydro/tasks
PATCH /api/v1/hydro/tasks/:taskId
```

创建请求：

```json
{
  "title": "Python 循环测评",
  "courseId": "course_001",
  "classId": "class_001",
  "examId": "exam_001",
  "hydroUrl": "https://hydro.example.com/p/1001",
  "hydroProblemId": "1001",
  "hydroContestId": "contest_001",
  "startTime": "2026-07-01T09:00:00+08:00",
  "endTime": "2026-07-01T18:00:00+08:00",
  "status": "draft"
}
```

---

### 12.5 提交代码

```http
POST /api/v1/hydro/attempts/:attemptId/questions/:questionId/submit-code
POST /api/v1/hydro/questions/:questionId/submit-code
```

请求：

```json
{
  "language": "py.py3",
  "code": "print(input())"
}
```

说明：第一条用于考试内编程题提交，第二条用于公开练习题提交。后端会写入 `judge_submissions`，并按 Hydro 回写/轮询结果更新答题记录。

---

### 12.6 获取提交详情

```http
GET /api/v1/hydro/submissions/:submissionId
```

---

### 12.7 回写判题结果

```http
PATCH /api/v1/hydro/submissions/:submissionId/result
POST  /api/v1/hydro/writeback
POST  /api/v1/hydro/callback
```

请求：

```json
{
  "submissionId": "submission_001",
  "externalSubmissionId": "hydro_sub_001",
  "status": "accepted",
  "score": 100,
  "result": {},
  "judgedAt": "2026-07-01T10:10:00+08:00",
  "secret": "callback-secret"
}
```

---

### 12.8 Hydro 汇总与任务结果同步

```http
GET  /api/v1/hydro/summary?examId=exam_001&questionId=question_001
GET  /api/v1/hydro/tasks/:taskId/results
POST /api/v1/hydro/tasks/:taskId/sync-results
POST /api/v1/hydro/tasks/:taskId/retry-failed
POST /api/v1/hydro/tasks/sync
```

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "taskId": "task_001",
    "submissionCount": 30,
    "syncedCount": 28,
    "duplicateCleanedCount": 0
  }
}
```

规则：

1. `sync-results` 从 `judge_submissions` 聚合到 `hydro_results`，用于任务看板。
2. `retry-failed` 会尝试重新同步失败、错误或仍在判题中的最新提交。
3. `tasks/sync` 支持按 `taskIds`、`examId`、`classId`、`courseId`、`status` 批量同步，单次最多处理 50 个任务。
4. 回调接口使用 `HYDRO_CALLBACK_SECRET` 或 `x-hydro-secret` 校验。

---

## 十三、AI Analysis 接口

当前源码仅保留 `ai_analysis_reports`、`ai_prompt_templates` 等数据库模型，未开放 `/api/v1/ai/*` 路由。AI 分析、推荐练习和报告查询属于后续模块，验收和联调时不应按本版本 API 调用。

预留能力：

1. 学生考试分析。
2. 班级考试分析。
3. 个性化练习推荐。
4. AI 报告查询。

---

## 十四、统计 Statistics 接口

### 14.1 获取学生考试统计

```http
GET /api/v1/statistics/students/:studentId/exams/:examId
```

---

### 14.2 获取班级考试统计

```http
GET /api/v1/statistics/classes/:classId/exams/:examId
```

---

### 14.3 获取题目正确率统计

```http
GET /api/v1/statistics/exams/:examId/questions
```

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": [
    {
      "questionId": "question_001",
      "correctRate": 0.76,
      "averageScore": 1.52,
      "wrongOptionStats": [
        {
          "optionId": "option_101",
          "count": 5
        }
      ]
    }
  ]
}
```

---

### 14.4 获取知识点统计

```http
GET /api/v1/statistics/exams/:examId/knowledge-points
```

---

## 十五、导出 Export 接口

### 15.1 创建导出任务

```http
POST /api/v1/exports
```

请求：

```json
{
  "type": "exam_result_excel",
  "params": {
    "examId": "exam_001",
    "classId": "class_001"
  }
}
```

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "taskId": "export_001"
  }
}
```

---

### 15.2 查询导出任务

```http
GET /api/v1/exports?page=1&pageSize=20&type=exam_results&status=success
```

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": "export_001",
    "type": "exam_result_excel",
    "status": "success",
    "downloadReady": true,
    "createdAt": "2026-07-01T10:00:00+08:00",
    "finishedAt": "2026-07-01T10:01:00+08:00"
  }
}
```

---

### 15.3 下载导出文件

```http
GET /api/v1/exports/:id/download
```

必须携带 Bearer Token；成功时直接返回二进制文件流和 `Content-Disposition: attachment`，不再返回可绕过权限的静态 URL。

---

### 15.3 试卷导出快捷接口

```http
POST /api/v1/papers/:id/export
```

请求：

```json
{
  "format": "pdf",
  "mode": "with_answer"
}
```

---

### 15.4 成绩导出快捷接口

```http
POST /api/v1/exams/:id/export-results
```

---

## 十六、题目资源 Upload 接口

### 16.1 上传题目附件

```http
POST /api/v1/uploads/question-assets
```

请求：

```http
Content-Type: multipart/form-data
file=<file>
```

说明：

- 用于题目导入时上传图片、PDF、Office、文本、压缩包等题目资源。
- 图片、PDF 等附件统一存放在本地 `uploads/question-assets` 目录，方便后续按题目打包下载。
- 单个文件限制 30MB；可执行脚本类扩展名会被拒绝。
- 返回的 `/uploads/question-assets/...` 为 Markdown 逻辑标识，不能直接静态访问。

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "url": "/uploads/question-assets/2026-06-27-demo-1a2b3c4d.png",
    "filename": "2026-06-27-demo-1a2b3c4d.png",
    "displayName": "demo",
    "originalName": "demo.png",
    "mimeType": "image/png",
    "size": 102400,
    "isImage": true,
    "markdown": "![demo](/uploads/question-assets/2026-06-27-demo-1a2b3c4d.png)"
  }
}
```

---

### 16.2 重命名题目附件

```http
PATCH /api/v1/uploads/question-assets/:filename
```

请求：

```json
{
  "displayName": "循环题配图"
}
```

返回字段同上传接口，`url` 和 `filename` 会随源文件重命名更新。

---

### 16.3 删除题目附件

```http
DELETE /api/v1/uploads/question-assets/:filename
```

说明：

1. 用于题目尚未创建前删除导入页临时上传的资源。前端会同步移除当前草稿中引用该附件的 Markdown 行。
2. 如果附件已被题目、题目版本、试卷快照或答题实例引用，接口会拒绝删除并返回引用数量与部分位置。

---

### 16.4 查询题目附件引用

```http
GET /api/v1/uploads/question-assets/:filename/references
GET /api/v1/uploads/question-assets/report
```

返回：

```json
{
  "filename": "2026-06-30-demo.png",
  "url": "/uploads/question-assets/2026-06-30-demo.png",
  "referenceCount": 3,
  "locations": ["题目：循环基础", "试卷题目快照"]
}
```

说明：

- `report` 返回全部题目附件的引用计数、孤立资源数量和前若干处引用位置。
- 题目删除影响接口也会返回资源引用计数，便于确认删除风险。

---

### 16.5 附件内容读取

```http
GET /api/v1/uploads/question-assets/:filename/content?action=preview
GET /api/v1/uploads/question-assets/:filename/content?action=download
GET /api/v1/uploads/public/questions/:questionId/assets/:filename?token=<signed-token>
```

- 第一个接口必须登录，并会重新校验管理权限、附件创建者或学生本人试卷快照引用。
- `action=preview` 返回内联预览，`action=download` 返回附件下载；签名令牌和权限校验都会绑定动作范围，不能跨动作复用。
- 第二个接口仅服务于公开已发布题目；令牌绑定 `questionId`、作用域、动作和过期时间，篡改、过期或跨题目复用均失败。
- 公开题目详情的 `data.assetAccessToken` 用于构造签名内容 URL。
- 旧 `/api/v1/uploads/files*`、`/api/v1/uploads/images` 和 `/images` 别名已删除。

---

## 十七、操作日志 AuditLog 接口

### 17.1 获取操作日志

```http
GET /api/v1/audit-logs?page=1&pageSize=20&module=question&action=question:create&userId=user_001&keyword=导入
```

说明：仅 `SUPER_ADMIN` 可查询，支持按 `module`、`action`、`userId`、`targetType`、`targetId`、`keyword` 过滤。

---

### 17.2 获取日志详情

```http
GET /api/v1/audit-logs/:id
```

---

## 十八、通知 Notification 接口

### 18.1 获取我的通知

```http
GET /api/v1/notifications?page=1&pageSize=20&unreadOnly=true
```

返回分页通知，同时返回 `unreadCount`。

---

### 18.2 获取未读通知数量

```http
GET /api/v1/notifications/unread-count
```

---

### 18.3 标记单条已读

```http
PATCH /api/v1/notifications/:id/read
```

---

### 18.4 全部标记已读

```http
POST /api/v1/notifications/read-all
```

---

## 十九、复习提醒 ReviewRule 接口

### 19.1 获取复习提醒规则

```http
GET /api/v1/review-rules?courseId=<uuid>&classId=<uuid>&knowledgePointId=<uuid>
```

权限：

```txt
statistics:read
```

### 19.2 创建复习提醒规则

```http
POST /api/v1/review-rules
```

请求：

```json
{
  "courseId": "course_uuid",
  "classId": "class_uuid",
  "knowledgePointId": "kp_uuid",
  "intervalsDays": [1, 3, 7, 14, 30],
  "masteryRule": {
    "correctStreak": 2,
    "reviewingIntervalDays": 3
  },
  "enabled": true
}
```

### 19.3 更新/删除复习提醒规则

```http
PATCH /api/v1/review-rules/:id
DELETE /api/v1/review-rules/:id
```

说明：

1. 规则可按课程、班级、知识点配置，字段为空表示不限制该范围。
2. 学生错题提醒会按知识点 > 班级 > 课程优先匹配规则。
3. `intervalsDays` 控制未掌握错题的复习间隔，`masteryRule` 控制复习中题目的掌握判断提示。

---

## 二十、关键接口业务规则

### 20.1 进入考试接口规则

`POST /student/exams/:examId/enter`

必须校验：

1. 用户是否登录。
2. 用户是否学生。
3. 学生是否属于考试班级。
4. 考试是否已发布。
5. 当前时间是否在允许进入范围内。
6. 是否超过作答次数。
7. 是否已经存在 attempt。
8. 是否已经存在 paper_instance。
9. 如果没有实例，则创建实例。
10. 返回题目时不得返回正确答案。

---

### 20.2 保存答案接口规则

`POST /student/attempts/:attemptId/save-answer`

必须校验：

1. attempt 是否存在。
2. attempt 是否属于当前学生。
3. attempt 是否已提交。
4. 考试是否已结束。
5. questionId 是否属于该 paper_instance。
6. answer_json 格式是否合法。
7. 保存时使用 upsert。

---

### 20.3 提交试卷接口规则

`POST /student/attempts/:attemptId/submit`

必须保证：

1. 幂等。
2. 使用事务。
3. 设置 submitted_at。
4. 锁定 attempt。
5. 批量判分客观题。
6. 生成错题。
7. 汇总成绩。
8. 有主观题则进入 grading。
9. 有编程题则等待 judge。
10. 写入操作日志。

---

### 20.4 发布试卷接口规则

`POST /papers/:id/publish`

必须校验：

1. 试卷存在。
2. 试卷不是 archived。
3. 至少有一题。
4. 分值合法。
5. 题目均为 published。
6. 生成题目快照。
7. 更新试卷总分。
8. 状态改为 published。

---

### 20.5 规则组卷接口规则

`POST /papers/:id/generate-by-rule`

必须校验：

1. 每条规则题量是否充足。
2. 不重复抽题。
3. 只抽 published 题目。
4. 过滤 disabled 和 archived 题目。
5. 生成 paper_sections。
6. 生成 paper_questions。
7. 保存 question_snapshot_json。
8. 保存 paper_rules。

---

### 20.6 Hydro 回调接口规则

必须校验：

1. 签名是否合法。
2. externalSubmissionId 是否存在。
3. 回调是否重复。
4. studentId 是否匹配。
5. questionId 是否匹配。
6. 更新 judge_submissions。
7. 更新 answer_records。
8. 重新汇总成绩。
9. 保存 rawResult。

---

## 二十一、第一阶段必须实现接口清单

MVP 必做：

```txt
Auth:
POST /auth/login
POST /auth/refresh
POST /auth/logout
GET  /auth/me

Course:
GET /courses
POST /courses
PATCH /courses/:id

KnowledgePoint:
GET /knowledge-points/tree
POST /knowledge-points
PATCH /knowledge-points/:id

Tag:
GET /tags
POST /tags
PATCH /tags/:id

Question:
GET /questions
POST /questions
GET /questions/:id
PATCH /questions/:id
DELETE /questions/:id
GET /questions/import-template
POST /questions/import
POST /questions/duplicate-check
POST /questions/batch/delete
PATCH /questions/batch/status

Paper:
GET /papers
POST /papers
GET /papers/:id
PATCH /papers/:id
POST /papers/:id/questions
DELETE /papers/:id/questions/:paperQuestionId
POST /papers/:id/generate-by-rule
POST /papers/:id/publish
GET /papers/:id/preview

Exam:
GET /exams
POST /exams
GET /exams/:id
PATCH /exams/:id
POST /exams/:id/publish
GET /exams/:id/results
GET /exams/:id/statistics
GET /exams/:id/announcement-reads
POST /exams/:id/export-results

Student:
GET /student/exams
POST /student/exams/:examId/enter
GET /student/attempts/:attemptId
POST /student/attempts/:attemptId/save-answer
POST /student/attempts/:attemptId/save-answers
POST /student/attempts/:attemptId/submit
GET /student/attempts/:attemptId/result
GET /student/wrong-questions

Export:
GET /exports
POST /exports
GET /exports/:id/download

Audit:
GET /audit-logs
```

当前已开放的扩展模块：

```txt
Grading: /grading/answers, /grading/attempts/:id, /grading/exams/:id/grades/*
Hydro/Judge: /hydro/platforms, /hydro/questions/:id/binding, /hydro/*/submit-code, /hydro/tasks/*
Advanced Statistics: /statistics/*
Advanced Export: /exports
```

---

## 二十二、2026-06-27 已新增接口

### 22.1 主观题批改中心

```txt
GET   /grading/answers
GET   /grading/attempts/:attemptId
PATCH /grading/answers/:answerRecordId
POST  /grading/attempts/:attemptId/finish
POST  /grading/attempts/:attemptId/regrade
POST  /grading/regrade-runs/preview
GET   /grading/regrade-runs/:id
POST  /grading/regrade-runs/:id/confirm
POST  /grading/regrade-runs/:id/cancel
POST  /grading/exams/:examId/grades/publish
POST  /grading/exams/:examId/grades/withdraw
```

说明：

- `GET /grading/answers` 支持 `examId`、`studentId`、`status`、`keyword`、分页和排序。
- `PATCH /grading/answers/:answerRecordId` 保存分数、rubric 和批改意见，并自动重算答题记录总分。
- `finish` 完成整卷批改，`regrade` 兼容旧重判入口，`regrade-runs/*` 用于试算/确认/取消，`grades/publish` 和 `grades/withdraw` 控制学生端成绩可见性。

### 22.1.1 Hydro 任务级管理

```txt
GET   /hydro/tasks
POST  /hydro/tasks
PATCH /hydro/tasks/:taskId
GET   /hydro/tasks/:taskId/results
POST  /hydro/tasks/:taskId/sync-results
POST  /hydro/tasks/:taskId/retry-failed
POST  /hydro/tasks/sync
```

说明：`hydro_tasks` 与 `hydro_results` 已接入任务看板、单任务同步、失败重试和批量同步；结果来源为现有 `judge_submissions`。

### 22.2 导出中心

```txt
GET  /exports
POST /exports
GET  /exports/:id/download
```

支持导出类型：

```txt
exam_results
grading
question_bank
papers
paper_document
wrong_questions
classes
statistics
full_archive
```

支持格式：

```txt
csv
json
pdf
docx
zip
```

说明：`full_archive` 仅超级管理员可创建，仅支持 `zip`，会导出题库、试卷迁移包、课程、知识点、标签、班级、考试等资源清单。

### 22.3 班级与权限范围

```txt
GET    /classes
POST   /classes
GET    /classes/:id
PATCH  /classes/:id
DELETE /classes/:id
POST   /classes/:id/students
DELETE /classes/:id/students/:studentId
POST   /classes/:id/teachers
DELETE /classes/:id/teachers/:teacherId
GET    /users/students
POST   /users/students
POST   /users/students/batch
GET    /users/teachers
POST   /users/teachers
POST   /users/teachers/batch
```

说明：

- 考试继续使用 `exams.class_id` 表示可见班级。
- 学生端只展示公开考试或本班考试。
- 学生账号由 `SUPER_ADMIN` / `ADMIN` / `TEACHER` 通过 `/users/students` 单个创建，或通过 `/users/students/batch` 批量创建；班级成员接口只负责选择并添加已有学生。
- 教师账号由 `SUPER_ADMIN` / `ADMIN` 通过 `/users/teachers` 创建；班级教师成员接口只负责选择并添加已有教师。
- 教师账号也支持通过 `/users/teachers/batch` 批量创建，输入格式与学生批量创建一致。

### 22.4 用户与权限管理

```txt
GET   /users?page=1&pageSize=20&keyword=tom&userType=TEACHER&status=ACTIVE
POST  /users
PATCH /users/:id
GET   /users/roles
POST  /users/roles
PATCH /users/roles/:id
PUT   /users/roles/:id/permissions
GET   /users/permissions
```

权限：

- 仅 `SUPER_ADMIN` 可访问总用户、角色和权限管理接口。
- `userType` 表示用户身份/职位：`SUPER_ADMIN`、`ADMIN`、`TEACHER`、`ASSISTANT`、`STUDENT`、`PARENT`。
- `roles` / `roleIds` 表示权限角色，最终功能访问由角色关联的 `permissions` 决定。
- 超级管理员不能在当前登录账号上修改自己的身份、状态或角色，避免误操作导致失去管理入口。

创建用户请求：

```json
{
  "username": "teacher002",
  "realName": "李老师",
  "password": "123456",
  "userType": "TEACHER",
  "status": "ACTIVE",
  "roleIds": ["role_uuid"]
}
```

更新角色权限请求：

```json
{
  "permissionIds": ["permission_uuid"]
}
```

### 22.5 统计分析

```txt
GET /statistics/overview
GET /statistics/exams
GET /statistics/exams/:examId
GET /statistics/knowledge
GET /statistics/classes
```

说明：

- 支持按 `courseId`、`classId`、`examId` 过滤。
- 统计来源为 `exam_attempts` 和 `answer_records`。
