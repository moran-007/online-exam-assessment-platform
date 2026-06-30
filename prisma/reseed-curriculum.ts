import {
  KnowledgePoint,
  PrismaClient,
  QuestionStatus,
  QuestionType,
  TagStatus,
  TagType,
} from '@prisma/client';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const prisma = new PrismaClient();

type CourseSeed = {
  code: string;
  name: string;
  stageCode: string;
  stageName: string;
  subjectCode: string;
  subjectName: string;
  description: string;
  points: string[];
};

type CreatedCourse = CourseSeed & {
  id: string;
  tagIds: string[];
};

const curriculum: CourseSeed[] = [
  {
    code: 'primary_chinese',
    name: '小学语文',
    stageCode: 'primary',
    stageName: '小学',
    subjectCode: 'chinese',
    subjectName: '语文',
    description: '义务教育小学阶段语文基础课程。',
    points: ['汉语拼音', '识字写字', '词语积累', '句子与标点', '阅读理解', '习作表达', '口语交际', '古诗文诵读'],
  },
  {
    code: 'primary_math',
    name: '小学数学',
    stageCode: 'primary',
    stageName: '小学',
    subjectCode: 'math',
    subjectName: '数学',
    description: '义务教育小学阶段数学基础课程。',
    points: ['数与代数', '图形与几何', '统计与概率', '综合与实践', '运算律', '分数小数', '应用题', '测量'],
  },
  {
    code: 'primary_english',
    name: '小学英语',
    stageCode: 'primary',
    stageName: '小学',
    subjectCode: 'english',
    subjectName: '英语',
    description: '义务教育小学阶段英语基础课程。',
    points: ['字母与语音', '词汇积累', '基础句型', '日常交际', '阅读理解', '听力理解', '写作启蒙'],
  },
  {
    code: 'primary_morality_law',
    name: '小学道德与法治',
    stageCode: 'primary',
    stageName: '小学',
    subjectCode: 'morality_law',
    subjectName: '道德与法治',
    description: '义务教育小学阶段道德与法治课程。',
    points: ['个人成长', '家庭生活', '校园规则', '公共生活', '法治意识', '国家认同'],
  },
  {
    code: 'primary_science',
    name: '小学科学',
    stageCode: 'primary',
    stageName: '小学',
    subjectCode: 'science',
    subjectName: '科学',
    description: '义务教育小学阶段科学课程。',
    points: ['生命科学', '物质科学', '地球宇宙', '技术工程', '科学探究', '实验安全'],
  },
  {
    code: 'primary_pe_health',
    name: '小学体育与健康',
    stageCode: 'primary',
    stageName: '小学',
    subjectCode: 'pe_health',
    subjectName: '体育与健康',
    description: '义务教育小学阶段体育与健康课程。',
    points: ['体能发展', '运动技能', '健康习惯', '安全防护', '团队合作'],
  },
  {
    code: 'primary_music',
    name: '小学音乐',
    stageCode: 'primary',
    stageName: '小学',
    subjectCode: 'music',
    subjectName: '音乐',
    description: '义务教育小学阶段音乐课程。',
    points: ['节奏与节拍', '歌唱基础', '音乐欣赏', '简谱识读', '创编活动'],
  },
  {
    code: 'primary_art',
    name: '小学美术',
    stageCode: 'primary',
    stageName: '小学',
    subjectCode: 'art',
    subjectName: '美术',
    description: '义务教育小学阶段美术课程。',
    points: ['线条造型', '色彩基础', '手工制作', '欣赏评述', '设计应用'],
  },
  {
    code: 'primary_labor',
    name: '小学劳动教育',
    stageCode: 'primary',
    stageName: '小学',
    subjectCode: 'labor',
    subjectName: '劳动教育',
    description: '义务教育小学阶段劳动教育课程。',
    points: ['日常整理', '烹饪基础', '种植养护', '工具安全', '劳动品质'],
  },
  {
    code: 'primary_information_technology',
    name: '小学信息科技',
    stageCode: 'primary',
    stageName: '小学',
    subjectCode: 'information_technology',
    subjectName: '信息科技',
    description: '义务教育小学阶段信息科技课程。',
    points: ['数字设备', '信息搜索', '图形化编程', '网络安全', '数据意识'],
  },
  {
    code: 'middle_chinese',
    name: '初中语文',
    stageCode: 'middle',
    stageName: '初中',
    subjectCode: 'chinese',
    subjectName: '语文',
    description: '义务教育初中阶段语文课程。',
    points: ['现代文阅读', '文言文基础', '古诗词鉴赏', '写作结构', '名著阅读', '口语表达', '语言运用'],
  },
  {
    code: 'middle_math',
    name: '初中数学',
    stageCode: 'middle',
    stageName: '初中',
    subjectCode: 'math',
    subjectName: '数学',
    description: '义务教育初中阶段数学课程。',
    points: ['有理数与实数', '代数式方程', '函数初步', '几何证明', '统计概率', '综合应用'],
  },
  {
    code: 'middle_english',
    name: '初中英语',
    stageCode: 'middle',
    stageName: '初中',
    subjectCode: 'english',
    subjectName: '英语',
    description: '义务教育初中阶段英语课程。',
    points: ['语法体系', '词汇短语', '阅读策略', '完形填空', '写作表达', '听说交际'],
  },
  {
    code: 'middle_morality_law',
    name: '初中道德与法治',
    stageCode: 'middle',
    stageName: '初中',
    subjectCode: 'morality_law',
    subjectName: '道德与法治',
    description: '义务教育初中阶段道德与法治课程。',
    points: ['青春成长', '法律基础', '公民权利义务', '国家制度', '社会责任', '时事理解'],
  },
  {
    code: 'middle_history',
    name: '初中历史',
    stageCode: 'middle',
    stageName: '初中',
    subjectCode: 'history',
    subjectName: '历史',
    description: '义务教育初中阶段历史课程。',
    points: ['中国古代史', '中国近现代史', '世界古代史', '世界近现代史', '历史材料分析', '时空观念'],
  },
  {
    code: 'middle_geography',
    name: '初中地理',
    stageCode: 'middle',
    stageName: '初中',
    subjectCode: 'geography',
    subjectName: '地理',
    description: '义务教育初中阶段地理课程。',
    points: ['地球地图', '世界地理', '中国地理', '区域发展', '天气气候', '人地关系'],
  },
  {
    code: 'middle_biology',
    name: '初中生物学',
    stageCode: 'middle',
    stageName: '初中',
    subjectCode: 'biology',
    subjectName: '生物学',
    description: '义务教育初中阶段生物学课程。',
    points: ['细胞与组织', '生物体结构', '生物圈生态', '遗传进化', '健康生活', '实验探究'],
  },
  {
    code: 'middle_physics',
    name: '初中物理',
    stageCode: 'middle',
    stageName: '初中',
    subjectCode: 'physics',
    subjectName: '物理',
    description: '义务教育初中阶段物理课程。',
    points: ['机械运动', '声光热', '力与运动', '压强浮力', '电路电学', '能源与信息'],
  },
  {
    code: 'middle_chemistry',
    name: '初中化学',
    stageCode: 'middle',
    stageName: '初中',
    subjectCode: 'chemistry',
    subjectName: '化学',
    description: '义务教育初中阶段化学课程。',
    points: ['物质性质', '化学式方程式', '空气与水', '金属材料', '酸碱盐', '实验操作'],
  },
  {
    code: 'middle_pe_health',
    name: '初中体育与健康',
    stageCode: 'middle',
    stageName: '初中',
    subjectCode: 'pe_health',
    subjectName: '体育与健康',
    description: '义务教育初中阶段体育与健康课程。',
    points: ['体能测试', '球类技能', '田径技能', '健康管理', '运动安全'],
  },
  {
    code: 'middle_music',
    name: '初中音乐',
    stageCode: 'middle',
    stageName: '初中',
    subjectCode: 'music',
    subjectName: '音乐',
    description: '义务教育初中阶段音乐课程。',
    points: ['乐理基础', '合唱欣赏', '民族音乐', '世界音乐', '音乐创编'],
  },
  {
    code: 'middle_art',
    name: '初中美术',
    stageCode: 'middle',
    stageName: '初中',
    subjectCode: 'art',
    subjectName: '美术',
    description: '义务教育初中阶段美术课程。',
    points: ['素描基础', '色彩表现', '设计与工艺', '书法篆刻', '美术鉴赏'],
  },
  {
    code: 'middle_labor',
    name: '初中劳动教育',
    stageCode: 'middle',
    stageName: '初中',
    subjectCode: 'labor',
    subjectName: '劳动教育',
    description: '义务教育初中阶段劳动教育课程。',
    points: ['项目劳动', '家庭服务', '职业体验', '技术实践', '安全规范'],
  },
  {
    code: 'middle_information_technology',
    name: '初中信息科技',
    stageCode: 'middle',
    stageName: '初中',
    subjectCode: 'information_technology',
    subjectName: '信息科技',
    description: '义务教育初中阶段信息科技课程。',
    points: ['信息系统', '数据处理', '算法思想', '网络与安全', '人工智能启蒙'],
  },
  {
    code: 'programming_scratch',
    name: 'Scratch 创意编程',
    stageCode: 'programming',
    stageName: '编程',
    subjectCode: 'scratch',
    subjectName: 'Scratch',
    description: '图形化创意编程课程。',
    points: ['角色舞台', '事件控制', '顺序循环', '条件判断', '变量列表', '克隆广播', '项目调试'],
  },
  {
    code: 'programming_python',
    name: 'Python 基础',
    stageCode: 'programming',
    stageName: '编程',
    subjectCode: 'python',
    subjectName: 'Python',
    description: 'Python 入门与基础语法课程。',
    points: ['输入输出', '变量与数据类型', '条件分支', '循环结构', '列表字典', '函数模块', '文件处理'],
  },
  {
    code: 'programming_cpp',
    name: 'C++ 算法入门',
    stageCode: 'programming',
    stageName: '编程',
    subjectCode: 'cpp',
    subjectName: 'C++',
    description: 'C++ 基础语法与算法启蒙课程。',
    points: ['基本语法', '输入输出', '分支循环', '数组字符串', '函数递归', '排序查找', 'STL 基础'],
  },
  {
    code: 'programming_web',
    name: 'Web 基础',
    stageCode: 'programming',
    stageName: '编程',
    subjectCode: 'web',
    subjectName: 'Web',
    description: 'HTML、CSS 与 JavaScript 基础课程。',
    points: ['HTML 结构', 'CSS 样式', 'JavaScript 基础', 'DOM 交互', '表单处理', '网络请求'],
  },
  {
    code: 'programming_ai',
    name: '人工智能启蒙',
    stageCode: 'programming',
    stageName: '编程',
    subjectCode: 'ai',
    subjectName: '人工智能',
    description: '面向中小学生的人工智能启蒙课程。',
    points: ['数据样本', '模型训练', '分类识别', '提示词基础', '伦理安全', '应用场景'],
  },
  {
    code: 'programming_robotics',
    name: 'Arduino 与机器人',
    stageCode: 'programming',
    stageName: '编程',
    subjectCode: 'robotics',
    subjectName: '机器人',
    description: '硬件编程、传感器与机器人项目课程。',
    points: ['电路安全', '传感器读取', '执行器控制', '串口调试', '项目搭建', '机器人逻辑'],
  },
];

const fixedTags = [
  { code: 'system_reseed_20260630', name: '系统重建-2026-06-30' },
  { code: 'foundation_question', name: '基础题' },
  { code: 'compulsory_education', name: '九年义务教育' },
  { code: 'programming_content', name: '编程内容' },
];

function codeSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

function difficultyByIndex(index: number): number {
  return (index % 5) + 1;
}

async function backupExistingContent() {
  const backupDir = join(process.cwd(), 'output', 'db-backups');
  await mkdir(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = join(backupDir, `curriculum-reset-${timestamp}.json`);
  const [courses, knowledgePoints, tags, questions, papers, exams] = await Promise.all([
    prisma.course.findMany({ select: { id: true, code: true, name: true, status: true, deletedAt: true } }),
    prisma.knowledgePoint.findMany({ select: { id: true, courseId: true, parentId: true, code: true, name: true } }),
    prisma.tag.findMany({ select: { id: true, code: true, name: true, type: true, status: true } }),
    prisma.question.findMany({ select: { id: true, courseId: true, title: true, type: true, status: true } }),
    prisma.paper.findMany({ select: { id: true, name: true, courseId: true, status: true } }),
    prisma.exam.findMany({ select: { id: true, name: true, courseId: true, status: true } }),
  ]);

  await writeFile(
    filePath,
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        note: 'Content metadata backup before destructive curriculum reseed. User/role/permission data is not included.',
        counts: {
          courses: courses.length,
          knowledgePoints: knowledgePoints.length,
          tags: tags.length,
          questions: questions.length,
          papers: papers.length,
          exams: exams.length,
        },
        courses,
        knowledgePoints,
        tags,
        questions,
        papers,
        exams,
      },
      null,
      2,
    ),
    'utf8',
  );

  return filePath;
}

async function clearContentDomain() {
  await prisma.notification.deleteMany({
    where: { bizType: { in: ['exam', 'paper', 'question', 'wrong_question', 'practice'] } },
  });
  await prisma.aiAnalysisReport.deleteMany();
  await prisma.judgeSubmission.deleteMany();
  await prisma.answerRecord.deleteMany();
  await prisma.examAttempt.deleteMany();
  await prisma.paperInstance.deleteMany();
  await prisma.examAnnouncementRead.deleteMany();
  await prisma.examAnnouncement.deleteMany();
  await prisma.exam.deleteMany();
  await prisma.paperQuestion.deleteMany();
  await prisma.paperRule.deleteMany();
  await prisma.paperSection.deleteMany();
  await prisma.paper.deleteMany();
  await prisma.wrongQuestionEvent.deleteMany();
  await prisma.wrongQuestion.deleteMany();
  await prisma.practiceSession.deleteMany();
  await prisma.hydroResult.deleteMany();
  await prisma.hydroTask.deleteMany();
  await prisma.programmingProblemRef.deleteMany();
  await prisma.questionVersion.deleteMany();
  await prisma.questionKnowledgePoint.deleteMany();
  await prisma.questionTag.deleteMany();
  await prisma.questionAnswer.deleteMany();
  await prisma.questionOption.deleteMany();
  await prisma.question.deleteMany();
  await prisma.knowledgePoint.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.classGroup.updateMany({ data: { courseId: null } });
  await prisma.course.deleteMany();
}

async function createTag(code: string, name: string) {
  return prisma.tag.create({
    data: {
      code,
      name,
      type: TagType.QUESTION,
      status: TagStatus.ACTIVE,
    },
  });
}

async function createTags() {
  const tagIdByCode = new Map<string, string>();
  const uniqueTags = new Map<string, string>();

  for (const tag of fixedTags) {
    uniqueTags.set(tag.code, tag.name);
  }

  for (const item of curriculum) {
    uniqueTags.set(`stage_${item.stageCode}`, item.stageName);
    uniqueTags.set(`subject_${item.subjectCode}`, item.subjectName);
    uniqueTags.set(`course_${item.code}`, item.name);
  }

  for (const [code, name] of uniqueTags.entries()) {
    const tag = await createTag(code, name);
    tagIdByCode.set(code, tag.id);
  }

  return tagIdByCode;
}

async function createCourses(tagIdByCode: Map<string, string>): Promise<CreatedCourse[]> {
  const created: CreatedCourse[] = [];

  for (const [index, item] of curriculum.entries()) {
    const course = await prisma.course.create({
      data: {
        code: item.code,
        name: item.name,
        description: `${item.description} 本课程由课程重建脚本生成，知识点均已配套基础题。`,
        sortOrder: index + 1,
      },
    });

    const commonTagCodes = [
      'system_reseed_20260630',
      'foundation_question',
      `stage_${item.stageCode}`,
      `subject_${item.subjectCode}`,
      `course_${item.code}`,
    ];
    if (item.stageCode !== 'programming') {
      commonTagCodes.push('compulsory_education');
    } else {
      commonTagCodes.push('programming_content');
    }

    created.push({
      ...item,
      id: course.id,
      tagIds: commonTagCodes.map((code) => tagIdByCode.get(code)).filter((id): id is string => Boolean(id)),
    });
  }

  return created;
}

async function createKnowledgePoints(course: CreatedCourse): Promise<KnowledgePoint[]> {
  const root = await prisma.knowledgePoint.create({
    data: {
      courseId: course.id,
      code: 'overview',
      name: `${course.name}总览`,
      level: 1,
      sortOrder: 1,
    },
  });

  const points = [root];
  for (const [index, name] of course.points.entries()) {
    points.push(
      await prisma.knowledgePoint.create({
        data: {
          courseId: course.id,
          parentId: root.id,
          code: codeSegment(`kp_${index + 1}_${name}`),
          name,
          level: 2,
          sortOrder: index + 2,
        },
      }),
    );
  }

  return points;
}

function buildQuestionContent(course: CreatedCourse, point: KnowledgePoint) {
  return [
    `【${course.name}】知识点：${point.name}`,
    '',
    `下列说法哪一项最能体现“${point.name}”的学习重点？`,
  ].join('\n');
}

function buildAnalysis(course: CreatedCourse, point: KnowledgePoint) {
  return `“${point.name}”属于${course.name}的重要知识点，学习时需要理解概念、掌握方法，并能迁移到真实题目或实践任务中。`;
}

async function createQuestion(course: CreatedCourse, point: KnowledgePoint, pointIndex: number) {
  const question = await prisma.question.create({
    data: {
      courseId: course.id,
      type: QuestionType.SINGLE_CHOICE,
      title: `${course.name}：${point.name}`,
      content: buildQuestionContent(course, point),
      difficulty: difficultyByIndex(pointIndex),
      defaultScore: 2,
      analysis: buildAnalysis(course, point),
      status: QuestionStatus.PUBLISHED,
      reviewedAt: new Date(),
    },
  });

  const optionSeeds = [
    { key: 'A', content: `理解“${point.name}”的核心概念，并能结合${course.name}任务进行应用。`, correct: true },
    { key: 'B', content: '只记住知识点标题，不需要理解具体含义。', correct: false },
    { key: 'C', content: '完全跳过该知识点，也不会影响同一课程后续学习。', correct: false },
    { key: 'D', content: '只依靠猜测即可稳定完成相关题目。', correct: false },
  ];
  const options = [];

  for (const [index, option] of optionSeeds.entries()) {
    options.push(
      await prisma.questionOption.create({
        data: {
          questionId: question.id,
          optionKey: option.key,
          content: option.content,
          isCorrect: option.correct,
          sortOrder: index + 1,
        },
      }),
    );
  }

  await prisma.questionAnswer.create({
    data: {
      questionId: question.id,
      answerJson: {
        correctOptionIds: options.filter((option) => option.isCorrect).map((option) => option.id),
      },
      scoringRuleJson: { mode: 'strict' },
    },
  });

  await prisma.questionKnowledgePoint.create({
    data: {
      questionId: question.id,
      knowledgePointId: point.id,
    },
  });

  for (const tagId of course.tagIds) {
    await prisma.questionTag.create({
      data: {
        questionId: question.id,
        tagId,
      },
    });
  }

  const snapshot = {
    id: question.id,
    courseId: question.courseId,
    courseName: course.name,
    type: 'single_choice',
    title: question.title,
    content: question.content,
    difficulty: question.difficulty,
    defaultScore: 2,
    analysis: question.analysis,
    allowOptionShuffle: question.allowOptionShuffle,
    version: question.version,
    options: options.map((option) => ({
      id: option.id,
      optionKey: option.optionKey,
      content: option.content,
      isCorrect: option.isCorrect,
      sortOrder: option.sortOrder,
    })),
    answer: {
      correctOptionIds: options.filter((option) => option.isCorrect).map((option) => option.id),
    },
    scoringRule: { mode: 'strict' },
    knowledgePoints: [{ id: point.id, name: point.name }],
    tags: course.tagIds,
  };

  await prisma.questionVersion.create({
    data: {
      questionId: question.id,
      version: question.version,
      snapshotJson: snapshot,
    },
  });
}

async function seedCurriculum() {
  const tagIdByCode = await createTags();
  const courses = await createCourses(tagIdByCode);

  for (const course of courses) {
    const points = await createKnowledgePoints(course);
    for (const [index, point] of points.entries()) {
      await createQuestion(course, point, index);
    }
  }
}

async function verifyCoverage() {
  const [courseCount, tagCount, knowledgePointCount, questionCount, coveredKnowledgePointCount] = await Promise.all([
    prisma.course.count({ where: { deletedAt: null } }),
    prisma.tag.count({ where: { deletedAt: null } }),
    prisma.knowledgePoint.count({ where: { deletedAt: null } }),
    prisma.question.count({ where: { deletedAt: null } }),
    prisma.questionKnowledgePoint.findMany({
      distinct: ['knowledgePointId'],
      select: { knowledgePointId: true },
    }),
  ]);

  const uncovered = await prisma.knowledgePoint.findMany({
    where: {
      deletedAt: null,
      questions: { none: {} },
    },
    include: { course: true },
    orderBy: [{ course: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
  });

  if (uncovered.length > 0) {
    throw new Error(`知识点题目覆盖不完整：${uncovered.map((item) => `${item.course.name}/${item.name}`).join('、')}`);
  }

  return {
    courseCount,
    tagCount,
    knowledgePointCount,
    questionCount,
    coveredKnowledgePointCount: coveredKnowledgePointCount.length,
  };
}

async function main() {
  const backupPath = await backupExistingContent();
  await clearContentDomain();
  await seedCurriculum();
  const result = await verifyCoverage();

  console.log(
    JSON.stringify(
      {
        backupPath,
        ...result,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
