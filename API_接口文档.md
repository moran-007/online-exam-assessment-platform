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
  "password": "123456"
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
    "user": {
      "id": "user_001",
      "username": "teacher001",
      "realName": "张老师",
      "userType": "TEACHER"
    }
  }
}
```

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
    "refreshToken": "new_refresh_token"
  }
}
```

---

### 2.3 获取当前用户

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

### 2.4 退出登录

```http
POST /api/v1/auth/logout
```

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

### 6.6 提交审核

```http
POST /api/v1/questions/:id/submit-review
```

---

### 6.7 审核题目

```http
POST /api/v1/questions/:id/review
```

请求：

```json
{
  "approved": true,
  "comment": "通过"
}
```

---

### 6.8 发布题目

```http
POST /api/v1/questions/:id/publish
```

---

### 6.9 禁用题目

```http
POST /api/v1/questions/:id/disable
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
```

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "successCount": 80,
    "failedCount": 3,
    "errorFileUrl": "https://file.example.com/import-error.xlsx"
  }
}
```

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

1. running 状态不允许修改核心考试配置。
2. ended 状态不允许修改。
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

### 8.11 导出考试成绩

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
GET /api/v1/grading/tasks?examId=exam_001&classId=class_001
```

---

### 10.2 获取某次答题详情

```http
GET /api/v1/grading/attempts/:attemptId
```

---

### 10.3 批改单题

```http
POST /api/v1/grading/answers/:answerRecordId
```

请求：

```json
{
  "score": 8,
  "comment": "思路正确，但表述不完整。"
}
```

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

请求：

```json
{
  "reason": "题目答案修正后重新判分"
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

### 12.1 绑定 Hydro 账号

```http
POST /api/v1/hydro/accounts/bind
```

请求：

```json
{
  "studentId": "student_001",
  "hydroUserId": "10001",
  "hydroUsername": "stu001"
}
```

---

### 12.2 创建 Hydro 测评任务

```http
POST /api/v1/hydro/tasks
```

请求：

```json
{
  "title": "Python 循环测评",
  "courseId": "course_001",
  "classId": "class_001",
  "hydroUrl": "https://hydro.example.com/p/1001",
  "hydroProblemId": "1001",
  "startTime": "2026-07-01T09:00:00+08:00",
  "endTime": "2026-07-01T18:00:00+08:00"
}
```

---

### 12.3 获取 Hydro 跳转链接

```http
GET /api/v1/hydro/tasks/:id/start
```

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "url": "https://hydro.example.com/p/1001?token=xxx"
  }
}
```

---

### 12.4 提交代码到 Judge

```http
POST /api/v1/judge/submit
```

请求：

```json
{
  "attemptId": "attempt_001",
  "questionId": "question_001",
  "language": "python3",
  "code": "print(input())"
}
```

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "submissionId": "submission_001",
    "status": "judging"
  }
}
```

---

### 12.5 获取判题结果

```http
GET /api/v1/judge/submissions/:id
```

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "submissionId": "submission_001",
    "status": "accepted",
    "score": 100,
    "result": {
      "time": 120,
      "memory": 10240,
      "cases": []
    }
  }
}
```

---

### 12.6 同步 Hydro 结果

```http
POST /api/v1/hydro/tasks/:id/sync-results
```

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "syncedCount": 30,
    "failedCount": 0
  }
}
```

---

### 12.7 Hydro 回调接口

```http
POST /api/v1/judge/callback/hydro
```

请求：

```json
{
  "externalSubmissionId": "hydro_sub_001",
  "hydroUserId": "10001",
  "problemId": "1001",
  "status": "accepted",
  "score": 100,
  "rawResult": {}
}
```

规则：

1. 回调接口需要签名校验。
2. 重复回调必须幂等。
3. 不能覆盖更高优先级结果，除非配置允许。
4. rawResult 必须保存。

---

## 十三、AI Analysis 接口

### 13.1 创建学生考试分析

```http
POST /api/v1/ai/analyze-attempt
```

请求：

```json
{
  "attemptId": "attempt_001",
  "forceRegenerate": false
}
```

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "reportId": "ai_report_001",
    "status": "pending"
  }
}
```

---

### 13.2 创建班级考试分析

```http
POST /api/v1/ai/analyze-class-exam
```

请求：

```json
{
  "examId": "exam_001",
  "classId": "class_001"
}
```

---

### 13.3 推荐练习

```http
POST /api/v1/ai/recommend-practice
```

请求：

```json
{
  "studentId": "student_001",
  "examId": "exam_001",
  "questionCount": 10
}
```

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "recommendationId": "rec_001",
    "rules": [
      {
        "knowledgePointId": "kp_001",
        "difficultyRange": [1, 3],
        "questionCount": 10
      }
    ]
  }
}
```

---

### 13.4 获取 AI 报告

```http
GET /api/v1/ai/reports/:id
```

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": "ai_report_001",
    "type": "student_exam_summary",
    "status": "success",
    "output": {
      "summary": "本次测试基础题掌握较好，但循环结构存在薄弱。",
      "weakPoints": [],
      "teacherAdvice": ""
    }
  }
}
```

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
POST /api/v1/export/tasks
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
GET /api/v1/export/tasks/:id
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
    "fileUrl": "https://file.example.com/export/exam.xlsx",
    "createdAt": "2026-07-01T10:00:00+08:00",
    "finishedAt": "2026-07-01T10:01:00+08:00"
  }
}
```

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

说明：用于题目尚未创建前删除导入页临时上传的资源。前端会同步移除当前草稿中引用该附件的 Markdown 行。

---

### 16.4 兼容接口

```http
POST /api/v1/uploads/images
POST /api/v1/uploads/files
PATCH /api/v1/uploads/files/:filename
DELETE /api/v1/uploads/files/:filename
```

以上接口为兼容旧调用保留，实际仍写入 `uploads/question-assets`。

---

## 十七、操作日志 AuditLog 接口

### 17.1 获取操作日志

```http
GET /api/v1/audit-logs?page=1&pageSize=20&module=question&userId=user_001
```

---

### 17.2 获取日志详情

```http
GET /api/v1/audit-logs/:id
```

---

## 十八、通知 Notification 接口

### 18.1 获取我的通知

```http
GET /api/v1/notifications
```

---

### 18.2 标记已读

```http
POST /api/v1/notifications/:id/read
```

---

### 18.3 全部标记已读

```http
POST /api/v1/notifications/read-all
```

---

## 十九、关键接口业务规则

### 19.1 进入考试接口规则

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

### 19.2 保存答案接口规则

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

### 19.3 提交试卷接口规则

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

### 19.4 发布试卷接口规则

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

### 19.5 规则组卷接口规则

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

### 19.6 Hydro 回调接口规则

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

## 二十、第一阶段必须实现接口清单

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
POST /questions/import
POST /questions/export

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
GET /export/tasks/:id

Audit:
GET /audit-logs
```

第二阶段再做：

```txt
Grading
Hydro
Judge
AI
Advanced Statistics
Advanced Export
```

---

## 二十一、2026-06-27 已新增接口

### 21.1 主观题批改中心

```txt
GET   /grading/answers
GET   /grading/attempts/:attemptId
PATCH /grading/answers/:answerRecordId
```

说明：

- `GET /grading/answers` 支持 `examId`、`studentId`、`status`、`keyword`、分页和排序。
- `PATCH /grading/answers/:answerRecordId` 保存分数和批改意见，并自动重算答题记录总分。

### 21.2 导出中心

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
classes
statistics
```

支持格式：

```txt
csv
json
```

### 21.3 班级与权限范围

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
GET    /users/teachers
```

说明：

- 考试继续使用 `exams.class_id` 表示可见班级。
- 学生端只展示公开考试或本班考试。

### 21.4 统计分析

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
