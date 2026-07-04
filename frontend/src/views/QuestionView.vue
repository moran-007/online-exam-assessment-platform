<template>
  <div class="page">
    <div class="page-head question-page-head">
      <h1 class="page-title">题库管理</h1>
      <div class="toolbar question-toolbar">
        <el-input
          v-model="filter.keyword"
          clearable
          placeholder="题目关键词"
          style="width: 180px"
          @keyup.enter="loadFirstPage"
          @clear="loadFirstPage"
        />
        <el-select v-model="filter.courseId" clearable placeholder="课程" style="width: 170px" @change="handleFilterCourseChange">
          <el-option v-for="course in courses" :key="course.id" :label="course.name" :value="course.id" />
        </el-select>
        <el-tree-select
          v-model="filter.knowledgePointId"
          :data="filterKnowledgeTreeOptions"
          check-strictly
          clearable
          filterable
          placeholder="知识点"
          style="width: 180px"
          :disabled="!filter.courseId"
          @change="loadFirstPage"
        />
        <el-select v-model="filter.tagId" clearable filterable placeholder="标签" style="width: 170px" @change="loadFirstPage">
          <el-option v-for="tag in tags" :key="tag.id" :label="tag.name" :value="tag.id" />
        </el-select>
        <el-select v-model="filter.type" clearable placeholder="题型" style="width: 130px" @change="loadFirstPage">
          <el-option v-for="type in typeOptions" :key="type.value" :label="type.label" :value="type.value" />
        </el-select>
        <el-switch
          v-model="editMode"
          active-text="编辑模式"
          inactive-text="答题模式"
          inline-prompt
          style="--el-switch-on-color: #d97706; --el-switch-off-color: #256f78"
          @change="onEditModeChange"
        />
        <el-button :icon="Search" @click="loadFirstPage">查询</el-button>
        <el-button :icon="Refresh" @click="refreshAll">刷新</el-button>
        <el-button v-if="editMode" :icon="Upload" @click="router.push('/question-import')">题目导入</el-button>
        <template v-if="editMode">
          <el-select v-model="bulkQuestionStatus" clearable placeholder="批量状态" style="width: 132px">
            <el-option v-for="status in statusOptions" :key="status.value" :label="status.label" :value="status.value" />
          </el-select>
          <el-button
            :icon="Check"
            :disabled="!selectedQuestionIds.length || !bulkQuestionStatus"
            @click="bulkUpdateQuestionStatus"
          >
            批量设置
          </el-button>
          <el-button
            :icon="Download"
            :disabled="!selectedQuestionIds.length"
            @click="openQuestionExportDialog(selectedQuestionIds)"
          >
            导出选中
          </el-button>
        </template>
        <el-button
          v-if="editMode"
          type="danger"
          plain
          :icon="Delete"
          :disabled="!selectedQuestionIds.length"
          @click="bulkDeleteQuestions"
        >
          批量删除
        </el-button>
      </div>
    </div>

    <div class="question-list-only">
      <el-tabs v-model="questionScope" class="page-tabs" @tab-change="loadFirstPage">
        <el-tab-pane label="考试中" name="occupied" />
        <el-tab-pane label="已公开" name="published" />
        <el-tab-pane label="草稿" name="draft" />
      </el-tabs>
      <el-dialog v-model="editorVisible" :title="editorTitle" width="980px" destroy-on-close @closed="resetForm">
        <div class="question-editor-dialog">
          <el-alert
            type="warning"
            show-icon
            :closable="false"
            title="风险操作提示：修改题干、答案、选项或状态会影响后续使用；已生成的试卷快照不会自动同步。复制会创建草稿副本，不覆盖原题。"
          />
        <el-tabs v-model="entryMode">
          <el-tab-pane label="编辑题目" name="single">
            <div class="edit-state">
              <el-tag type="warning">编辑中</el-tag>
              <span class="muted">{{ form.title || '未命名题目' }}</span>
              <el-button size="small" :icon="Close" @click="closeEditor">取消编辑</el-button>
            </div>

            <el-form :model="form" label-width="86px">
              <el-form-item label="课程">
                <el-select v-model="form.courseId" filterable style="width: 100%" @change="handleFormCourseChange">
                  <el-option v-for="course in courses" :key="course.id" :label="course.name" :value="course.id" />
                </el-select>
              </el-form-item>
              <el-form-item label="知识点">
                <el-tree-select
                  v-model="form.knowledgePointIds"
                  :data="formKnowledgeTreeOptions"
                  multiple
                  check-strictly
                  collapse-tags
                  collapse-tags-tooltip
                  clearable
                  filterable
                  placeholder="选择所属知识点"
                  style="width: 100%"
                />
              </el-form-item>
              <el-form-item label="题型">
                <el-select v-model="form.type" filterable style="width: 100%" @change="resetOptions">
                  <el-option v-for="type in typeOptions" :key="type.value" :label="type.label" :value="type.value" />
                </el-select>
              </el-form-item>
              <el-form-item v-if="isEditing" label="状态">
                <el-segmented v-model="form.status" :options="statusSegmentOptions" />
              </el-form-item>
              <el-form-item label="标题">
                <el-input v-model="form.title" placeholder="请输入题目标题" />
              </el-form-item>
              <el-form-item label="标签">
                <div class="tag-field">
                  <el-select
                    v-model="form.tagNames"
                    multiple
                    filterable
                    allow-create
                    default-first-option
                    placeholder="可选择已有标签，也可直接输入新标签"
                    style="width: 100%"
                  >
                    <el-option v-for="tag in tags" :key="tag.id" :label="tag.name" :value="tag.name" />
                  </el-select>
                  <div class="tag-suggestions">
                    <el-tag
                      v-for="tag in quickTags"
                      :key="tag.id"
                      effect="plain"
                      size="small"
                      @click="appendTag(tag.name)"
                    >
                      {{ tag.name }}
                    </el-tag>
                  </div>
                </div>
              </el-form-item>
              <el-form-item label="题干">
                <div style="width: 100%">
                  <div class="toolbar" style="margin-bottom: 8px">
                    <el-button size="small" :icon="DocumentAdd" @click="insertCodeBlock(form, 'content')">
                      代码块
                    </el-button>
                    <el-button v-if="form.type === 'fill_blank'" size="small" :icon="Plus" @click="insertFormBlankMarker">
                      插入空位
                    </el-button>
                    <el-button size="small" :icon="View" @click="previewVisible = !previewVisible">
                      预览
                    </el-button>
                  </div>
                  <el-input
                    v-model="form.content"
                    type="textarea"
                    :rows="8"
                    resize="vertical"
                    placeholder="支持 Markdown，例如 ```python"
                  />
                  <div v-if="previewVisible" class="panel markdown-preview">
                    <MarkdownRenderer :source="form.content" />
                  </div>
                </div>
              </el-form-item>
              <el-form-item label="难度">
                <div class="inline-control">
                  <el-rate v-model="form.difficulty" :max="5" />
                  <span class="muted">From 1-5</span>
                </div>
              </el-form-item>
              <el-form-item label="分值">
                <el-input-number v-model="form.defaultScore" :min="0" :step="1" />
              </el-form-item>
              <template v-if="form.type === 'programming'">
                <el-form-item label="Hydro题目">
                  <div class="hydro-inline-field">
                    <el-input
                      v-model="form.programmingRef.externalProblemId"
                      placeholder="输入题号或题目地址，例如 P1000 / https://tarjanoj.com/d/shiyan/p/B2002"
                      @change="handleHydroProblemInputChange"
                      @blur="handleHydroProblemInputChange"
                    />
                    <el-button :icon="Refresh" :loading="hydroPulling" :disabled="!canPullHydroProblem" @click="pullHydroProblem">
                      拉取
                    </el-button>
                    <el-button :icon="Link" :disabled="!hydroProblemUrl" @click="openHydroProblemUrl">打开</el-button>
                  </div>
                </el-form-item>
                <el-form-item label="站点">
                  <el-select
                    v-model="form.programmingRef.platformBaseUrl"
                    filterable
                    allow-create
                    default-first-option
                    placeholder="选择平台站点"
                    style="width: 100%"
                    @change="handleHydroSiteChange"
                  >
                    <el-option
                      v-for="site in hydroSiteOptions"
                      :key="site.key"
                      :label="site.label"
                      :value="site.value"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item label="Hydro域">
                  <div class="hydro-inline-field">
                    <el-input v-model="form.programmingRef.domainId" placeholder="默认 system；其他域填写域 ID" />
                    <el-input v-model="form.programmingRef.domainName" placeholder="域名称/备注，可选" />
                  </div>
                </el-form-item>
                <el-form-item label="录入账号">
                  <div class="hydro-inline-field">
                    <el-select
                      v-model="form.programmingRef.accountId"
                      clearable
                      filterable
                      placeholder="同站点账号自动匹配，可手动切换"
                      @change="handleHydroAccountChange"
                    >
                      <el-option
                        v-for="account in hydroAccountOptions"
                        :key="account.id"
                        :label="account.label"
                        :value="account.id"
                      />
                    </el-select>
                    <el-tag v-if="hydroBindingLabel" type="info">{{ hydroBindingLabel }}</el-tag>
                  </div>
                </el-form-item>
                <el-form-item label="测评语言">
                  <el-input v-model="form.programmingRef.languagesText" placeholder="cc.cc17o2, py.py3, java" />
                </el-form-item>
              </template>

              <template v-if="isChoice">
                <el-form-item label="选项">
                  <div class="choice-editor">
                    <div class="toolbar">
                      <el-button v-if="form.type !== 'true_false'" size="small" :icon="Plus" @click="addOption">
                        增加选项
                      </el-button>
                      <span class="muted">单选/判断只允许一个正确项，多选至少两个正确项。</span>
                    </div>
                    <div v-for="(option, index) in form.options" :key="option.optionKey" class="option-editor">
                      <el-radio
                        v-if="form.type === 'single_choice' || form.type === 'true_false'"
                        v-model="correctChoiceKey"
                        :label="option.optionKey"
                      />
                      <el-checkbox v-else v-model="option.isCorrect" />
                      <el-tag>{{ option.optionKey }}</el-tag>
                      <div class="option-content">
                        <el-input v-model="option.content" type="textarea" :rows="2" resize="vertical" />
                        <MarkdownRenderer v-if="option.content" :source="option.content" />
                      </div>
                      <el-button
                        v-if="form.type !== 'true_false'"
                        size="small"
                        plain
                        :icon="Delete"
                        :disabled="form.options.length <= 2"
                        @click="removeOption(index)"
                      >
                        删除
                      </el-button>
                    </div>
                  </div>
                </el-form-item>
              </template>
              <el-form-item v-else-if="form.type === 'fill_blank'" label="答案">
                <div class="fill-blank-answer-editor">
                  <div class="toolbar">
                    <el-button size="small" :icon="Plus" @click="addBlankAnswerRow">增加空位</el-button>
                    <el-button size="small" :icon="DocumentAdd" @click="insertFormBlankMarker">插入题干空位</el-button>
                    <span class="muted">题干中的 ____ 是学生看到的填空横线，也用于自动识别空位数量。</span>
                  </div>
                  <div v-for="(blank, index) in blankAnswerRows" :key="index" class="blank-answer-row">
                    <el-tag>第 {{ index + 1 }} 空</el-tag>
                    <el-input v-model="blank.answerText" placeholder="正确答案；多个答案用逗号分隔" />
                    <el-button
                      size="small"
                      plain
                      :icon="Delete"
                      :disabled="blankAnswerRows.length <= 1"
                      @click="removeBlankAnswerRow(index)"
                    >
                      删除
                    </el-button>
                  </div>
                </div>
              </el-form-item>
              <el-form-item v-else-if="form.type === 'material'" label="子题">
                <div class="material-child-editor">
                  <el-alert type="info" :closable="false" title="当前仅支持单层组合；材料题本身不计分，总分由子题分值相加。" />
                  <div v-for="(child, index) in form.children" :key="`${child.questionId}-${index}`" class="material-child-row">
                    <el-tag>{{ index + 1 }}</el-tag>
                    <el-select v-model="child.questionId" filterable placeholder="选择已发布子题" style="flex: 1">
                      <el-option
                        v-for="candidate in materialCandidates"
                        :key="candidate.id"
                        :label="`${candidate.title}（${typeLabel(candidate.type)}）`"
                        :value="candidate.id"
                        :disabled="form.children.some((item, childIndex) => childIndex !== index && item.questionId === candidate.id)"
                      />
                    </el-select>
                    <el-input-number v-model="child.score" :min="0.01" :precision="2" :step="1" />
                    <el-button plain :icon="Delete" @click="removeMaterialChild(index)">删除</el-button>
                  </div>
                  <el-button plain :icon="Plus" @click="addMaterialChild">增加子题</el-button>
                </div>
              </el-form-item>
              <el-form-item v-else label="参考答案">
                <el-input
                  v-model="answerReference"
                  type="textarea"
                  :rows="3"
                  resize="vertical"
                  placeholder="可选，简答题/编程题可填写参考答案或评测说明"
                />
              </el-form-item>
              <el-form-item label="解析">
                <div style="width: 100%">
                  <el-input v-model="form.analysis" type="textarea" :rows="3" resize="vertical" />
                  <MarkdownRenderer v-if="form.analysis" :source="form.analysis" />
                </div>
              </el-form-item>
              <div class="toolbar">
                <el-button type="primary" :icon="Edit" :loading="saving" @click="saveQuestion(false)">保存修改</el-button>
                <el-button type="success" :icon="Check" :loading="saving" @click="saveQuestion(true)">保存并发布</el-button>
                <el-button type="warning" :icon="DocumentCopy" :loading="saving" @click="copyQuestion">复制为新题</el-button>
                <el-button :icon="Close" @click="closeEditor">取消</el-button>
              </div>
            </el-form>
          </el-tab-pane>
</el-tabs>
        </div>
      </el-dialog>

      <div class="panel question-table-panel">
        <el-table
          class="question-list-table"
          :data="items"
          height="100%"
          :default-sort="{ prop: filter.sortBy, order: filter.sortOrder === 'asc' ? 'ascending' : 'descending' }"
          highlight-current-row
          @row-click="handleQuestionRowClick"
          @selection-change="handleSelectionChange"
          @sort-change="handleQuestionSortChange"
        >
          <el-table-column v-if="editMode" type="selection" width="48" />
          <el-table-column prop="title" label="题目" min-width="300" sortable="custom">
            <template #default="{ row }">
              <div class="question-title-cell">
                <strong>{{ row.title }}</strong>
                <el-tag
                  v-if="row.occupiedByExam"
                  size="small"
                  type="warning"
                  class="clickable-tag"
                  @click.stop="openRelatedExams(row)"
                >
                  比赛占用
                </el-tag>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="type" label="题型" width="96" sortable="custom">
            <template #default="{ row }">{{ typeLabel(row.type) }}</template>
          </el-table-column>
          <el-table-column prop="difficulty" label="难度" width="74" sortable="custom" />
          <el-table-column v-if="showMediumColumns" prop="defaultScore" label="分值" width="74" sortable="custom" />
          <el-table-column v-if="showMediumColumns" label="知识点" min-width="120">
            <template #default="{ row }">
              <div class="table-tag-list">
                <el-tag
                  v-for="point in row.knowledgePoints || []"
                  :key="point.id"
                  size="small"
                  type="success"
                  effect="plain"
                  class="clickable-tag"
                  @click.stop="filterByKnowledgePoint(point)"
                >
                  {{ point.name }}
                </el-tag>
                <span v-if="!(row.knowledgePoints || []).length" class="muted">-</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column v-if="showMediumColumns" label="标签" min-width="120">
            <template #default="{ row }">
              <div class="table-tag-list">
                <el-tag
                  v-for="tag in row.tags || []"
                  :key="tag.id"
                  size="small"
                  effect="plain"
                  class="clickable-tag"
                  @click.stop="filterByTag(tag)"
                >
                  {{ tag.name }}
                </el-tag>
                <span v-if="!(row.tags || []).length" class="muted">-</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="86" sortable="custom">
            <template #default="{ row }">
              <el-tag :type="statusTagType(row.status)">{{ statusLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column v-if="showLowColumns" prop="createdAt" label="录入时间" width="148" sortable="custom">
            <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="96" fixed="right">
            <template #default="{ row }">
              <div class="question-actions row-action-cell" @click.stop @mousedown.stop>
                <template v-if="!editMode">
                  <el-button size="small" :icon="View" @click.stop="openPracticeQuestion(row)">答题</el-button>
                </template>
                <template v-else>
                  <el-dropdown trigger="click" @command="(command) => handleQuestionCommand(row, command)">
                    <el-button size="small" :icon="MoreFilled" @click.stop>操作</el-button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="edit" :icon="Edit">编辑/复制</el-dropdown-item>
                        <el-dropdown-item v-if="row.status !== 'published'" command="publish" :icon="Check">发布</el-dropdown-item>
                        <el-dropdown-item v-if="row.status === 'published'" command="unpublish" :icon="Close">取消发布</el-dropdown-item>
                        <el-dropdown-item v-if="row.status !== 'disabled'" command="hide" :icon="Hide">隐藏</el-dropdown-item>
                        <el-dropdown-item v-if="row.status === 'disabled'" command="show" :icon="View">显示</el-dropdown-item>
                        <el-dropdown-item command="download" :icon="Download">下载</el-dropdown-item>
                        <el-dropdown-item command="delete" :icon="Delete" divided>删除</el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </template>
              </div>
            </template>
          </el-table-column>
        </el-table>
        <div class="table-footer question-table-footer">
          <span class="muted">共 {{ pagination.total }} 道题</span>
          <el-pagination
            v-model:current-page="pagination.page"
            v-model:page-size="pagination.pageSize"
            background
            size="small"
            :pager-count="5"
            layout="sizes, prev, pager, next"
            :page-sizes="pageSizes"
            :total="pagination.total"
            @size-change="handleSizeChange"
            @current-change="handleCurrentChange"
          />
        </div>
      </div>
    </div>

    <el-dialog v-model="practiceVisible" title="题目作答" :width="practiceDialogWidth">
      <template v-if="practiceDetail">
        <div class="paper-preview-head answer-dialog-head">
          <div>
            <h2>{{ practiceDetail.title }}</h2>
            <span class="muted">{{ typeLabel(practiceDetail.type) }} · {{ practiceDetail.defaultScore }} 分</span>
          </div>
          <div class="toolbar">
            <el-radio-group v-model="answerLayout" size="small" class="answer-layout-toggle">
              <el-radio-button label="side">左右</el-radio-button>
              <el-radio-button label="stack">上下</el-radio-button>
            </el-radio-group>
            <el-tag :type="practiceDetail.status === 'published' ? 'success' : 'warning'">
              {{ statusLabel(practiceDetail.status) || practiceDetail.status }}
            </el-tag>
          </div>
        </div>

        <QuestionAnswerLayout :mode="answerLayout" framed>
          <template #statement>
            <MarkdownRenderer :source="practiceDetail.content || ''" />
          </template>

          <template #answer>
            <div class="question-answer-body">
              <div v-if="practiceDetail.type === 'programming'" class="programming-answer">
                <ProgrammingToolbarShell :summary="languageLabel(practiceAnswer.language)">
                  <template #badge>
                    <el-tag v-if="!practiceMatchedHydroAccounts.length" type="warning" size="small">无账号</el-tag>
                  </template>
                  <template #default="{ close }">
                  <div class="programming-toolbar">
                    <span class="programming-language-label">语言</span>
                    <el-select v-model="practiceAnswer.language" style="width: 170px" @change="close">
                      <el-option
                        v-for="language in languageOptionsFor(practiceDetail)"
                        :key="language"
                        :label="languageLabel(language)"
                        :value="language"
                      />
                    </el-select>
                    <el-tag v-if="practiceDetail.programmingRef?.platformBaseUrl || practiceDetail.programmingRef?.externalProblemUrl" type="info">
                      来源：{{ hydroSourceLabel(practiceDetail.programmingRef) }}
                    </el-tag>
                    <el-tag v-if="practiceDetail.programmingRef?.domainId" type="info">
                      域：{{ formatHydroDomainLabel(practiceDetail.programmingRef) }}
                    </el-tag>
                    <el-tag v-if="practiceDetail.programmingRef?.externalProblemId" type="success">
                      {{ practiceDetail.programmingRef.externalProblemId }}
                    </el-tag>
                    <span class="programming-language-label">账号</span>
                    <el-select
                      v-model="practiceHydroAccountId"
                      :disabled="!practiceMatchedHydroAccounts.length"
                      placeholder="选择提交账号"
                      style="width: 230px"
                      @change="close"
                    >
                      <el-option
                        v-for="account in practiceMatchedHydroAccounts"
                        :key="account.id"
                        :label="hydroPracticeAccountLabel(account)"
                        :value="account.id"
                      />
                    </el-select>
                    <el-tag v-if="!practiceMatchedHydroAccounts.length" type="warning">无同站点账号</el-tag>
                    <el-button :icon="Link" :disabled="!practiceDetail.programmingRef?.externalProblemUrl" @click="close(); openHydroProblem(practiceDetail)">
                      打开 Hydro
                    </el-button>
                  </div>
                  </template>
                </ProgrammingToolbarShell>
                <el-alert
                  v-if="practiceProgrammingResult"
                  class="code-submit-feedback"
                  :type="programmingFeedbackType(practiceProgrammingResult)"
                  :closable="false"
                  show-icon
                >
                  <template #title>{{ programmingFeedbackTitle(practiceProgrammingResult) }}</template>
                  <div class="code-submit-meta">
                    <span>状态：{{ practiceProgrammingResult.status || '-' }}</span>
                    <span>语言：{{ languageLabel(practiceProgrammingResult.language || practiceAnswer.language) }}</span>
                    <span v-if="practiceProgrammingResult.externalSubmissionId">Hydro提交：{{ practiceProgrammingResult.externalSubmissionId }}</span>
                    <span v-if="practiceProgrammingResult.score !== null && practiceProgrammingResult.score !== undefined">
                      得分：{{ practiceProgrammingResult.score }} / {{ practiceProgrammingResult.maxScore || practiceDetail.defaultScore || '-' }}
                    </span>
                    <span v-if="practiceProgrammingResult.totalTestCaseCount">
                      测试点：{{ practiceProgrammingResult.passedTestCaseCount }} / {{ practiceProgrammingResult.totalTestCaseCount }}
                    </span>
                  </div>
                  <div v-if="practiceProgrammingResult.message" class="code-submit-message">{{ practiceProgrammingResult.message }}</div>
                </el-alert>
                <CodeAnswerEditor
                  v-model="practiceAnswer.code"
                  :language="practiceAnswer.language"
                  :language-label="languageLabel(practiceAnswer.language)"
                  :rows="18"
                />
              </div>
              <div v-else-if="isSplitPracticeQuestion(practiceDetail.type)" class="programming-answer">
                <div class="programming-toolbar">
                  <span class="programming-language-label">作答</span>
                  <el-tag>{{ typeLabel(practiceDetail.type) }}</el-tag>
                </div>
                <el-input
                  v-model="practiceAnswer.text"
                  class="answer-input subjective-answer-input"
                  type="textarea"
                  :rows="18"
                  placeholder="填写答案"
                />
              </div>
              <template v-else>
                <div class="programming-toolbar">
                  <span class="programming-language-label">作答</span>
                  <el-tag>{{ typeLabel(practiceDetail.type) }}</el-tag>
                </div>
                <el-radio-group
                  v-if="['single_choice', 'true_false'].includes(practiceDetail.type)"
                  v-model="practiceAnswer.selectedOptionIds[0]"
                  class="answer-options"
                >
                  <el-radio v-for="option in practiceOptions" :key="option.optionId" :label="option.optionId" class="answer-option">
                    <span class="option-choice">
                      <strong>{{ option.label }}.</strong>
                      <MarkdownRenderer :source="option.content" />
                    </span>
                  </el-radio>
                </el-radio-group>

                <el-checkbox-group v-else-if="practiceDetail.type === 'multiple_choice'" v-model="practiceAnswer.selectedOptionIds" class="answer-options">
                  <el-checkbox v-for="option in practiceOptions" :key="option.optionId" :label="option.optionId" class="answer-option">
                    <span class="option-choice">
                      <strong>{{ option.label }}.</strong>
                      <MarkdownRenderer :source="option.content" />
                    </span>
                  </el-checkbox>
                </el-checkbox-group>

                <FillBlankAnswerInputs
                  v-else-if="practiceDetail.type === 'fill_blank'"
                  v-model="practiceAnswer.blanks"
                  :count="blankCountFor(practiceDetail)"
                />
                <el-input v-else v-model="practiceAnswer.text" type="textarea" :rows="5" placeholder="填写答案" />
              </template>
            </div>
          </template>
        </QuestionAnswerLayout>

        <el-alert
          v-if="practiceDetail.status !== 'published'"
          title="未发布题目只可预览或进入编辑模式，发布后才能按学生方式判分。"
          type="warning"
          show-icon
          :closable="false"
          class="batch-alert"
        />
        <el-alert
          v-if="practiceResult"
          :title="`${practiceResult.message}，得分 ${practiceResult.score} / ${practiceResult.totalScore}`"
          :type="practiceResult.isCorrect ? 'success' : practiceResult.isCorrect === false ? 'error' : 'warning'"
          show-icon
          :closable="false"
          class="batch-alert"
        />

        <AnswerFeedback :result="practiceResult" />
      </template>
      <template #footer>
        <el-button @click="practiceVisible = false">关闭</el-button>
        <el-button :icon="Edit" @click="practiceDetail && editQuestionFromPractice()">进入编辑模式</el-button>
        <el-button
          type="primary"
          :loading="practiceProgrammingSubmitLoading"
          :disabled="practiceDetail?.status !== 'published' || (practiceDetail?.type === 'programming' && !practiceHydroAccountId)"
          @click="practiceDetail?.type === 'programming' ? submitPracticeProgrammingAnswer() : checkPracticeAnswer()"
        >
          {{ practiceDetail?.type === 'programming' ? '提交 Hydro 评测' : '提交作答' }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="questionExportVisible" title="题目导出设置" width="520px">
      <el-form label-width="96px">
        <el-form-item label="导出数量">
          <span>{{ pendingExportQuestionIds.length }} 道题</span>
        </el-form-item>
        <el-form-item label="导出格式">
          <el-radio-group v-model="questionExportOptions.format">
            <el-radio-button label="zip">题目压缩包</el-radio-button>
            <el-radio-button label="json">JSON</el-radio-button>
            <el-radio-button label="csv">CSV</el-radio-button>
            <el-radio-button label="pdf">PDF</el-radio-button>
            <el-radio-button label="docx">Word</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="包含内容">
          <el-checkbox v-model="questionExportOptions.includeAnswers">答案</el-checkbox>
          <el-checkbox v-model="questionExportOptions.includeAnalysis">解析</el-checkbox>
        </el-form-item>
        <el-alert
          type="info"
          show-icon
          :closable="false"
          title="ZIP、JSON、CSV 与题目导入字段保持对应；可回导必需字段：schemaVersion、title、type、difficulty、defaultScore、contentMarkdown、optionsJson、answerJson、scoringRuleJson、analysisMarkdown、tagNames、knowledgePointNames。取消答案后需补充答案再导入。"
        />
      </el-form>
      <template #footer>
        <el-button @click="questionExportVisible = false">取消</el-button>
        <el-button type="primary" :icon="Download" @click="confirmQuestionExport">生成导出</el-button>
      </template>
    </el-dialog>
</div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  Check,
  Close,
  Delete,
  Download,
  DocumentAdd,
  DocumentCopy,
  Edit,
  Hide,
  Link,
  MoreFilled,
  Plus,
  Refresh,
  Search,
  Upload,
  View,
} from '@element-plus/icons-vue';
import { api, buildQuery } from '../api';
import AnswerFeedback from '../components/AnswerFeedback.vue';
import CodeAnswerEditor from '../components/CodeAnswerEditor.vue';
import FillBlankAnswerInputs from '../components/FillBlankAnswerInputs.vue';
import MarkdownRenderer from '../components/MarkdownRenderer.vue';
import ProgrammingToolbarShell from '../components/ProgrammingToolbarShell.vue';
import QuestionAnswerLayout from '../components/QuestionAnswerLayout.vue';
import { useResponsiveColumns } from '../composables/useResponsiveColumns';
import {
  buildFillBlankAnswer,
  emptyFillBlankRows,
  fillBlankAnswerTextFromRows,
  fillBlankAnswerTextFromRules,
  fillBlankRowsFromText,
} from '../utils/fillBlankAnswers';

const router = useRouter();
const { showMediumColumns, showLowColumns } = useResponsiveColumns();
const typeOptions = [
  { label: '单选题', value: 'single_choice' },
  { label: '多选题', value: 'multiple_choice' },
  { label: '判断题', value: 'true_false' },
  { label: '填空题', value: 'fill_blank' },
  { label: '简答题', value: 'short_answer' },
  { label: '编程题', value: 'programming' },
  { label: '材料题', value: 'material' },
  { label: '文件上传题', value: 'file_upload' },
  { label: 'Scratch 项目题', value: 'scratch_project' },
  { label: 'Arduino 项目题', value: 'arduino_project' },
];
const statusOptions = [
  { label: '草稿', value: 'draft' },
  { label: '待审核', value: 'pending_review' },
  { label: '已公开', value: 'published' },
  { label: '已隐藏', value: 'disabled' },
];
const statusSegmentOptions = statusOptions.map((item) => ({ label: item.label, value: item.value }));
const objectiveQuestionTypes = new Set(['single_choice', 'multiple_choice', 'true_false', 'fill_blank']);

const courses = ref([]);
const tags = ref([]);
const formKnowledgeTree = ref([]);
const filterKnowledgeTree = ref([]);
const items = ref([]);
const materialCandidates = ref([]);
const blankAnswerRows = ref(emptyFillBlankRows());
const blankAnswerText = computed({
  get: () => fillBlankAnswerTextFromRows(blankAnswerRows.value),
  set: (value) => {
    blankAnswerRows.value = fillBlankRowsFromText(value);
  },
});
const answerReference = ref('');
const previewVisible = ref(true);
const entryMode = ref('single');
const saving = ref(false);
const hydroPulling = ref(false);
const editingId = ref('');
const editMode = ref(false);
const editorVisible = ref(false);
const selectedQuestionRows = ref([]);
const questionScope = ref('published');
const filter = reactive({
  courseId: '',
  knowledgePointId: '',
  tagId: '',
  type: '',
  keyword: '',
  sortBy: 'createdAt',
  sortOrder: 'desc',
});
const pagination = reactive({ page: 1, pageSize: 20, total: 0 });
const pageSizes = [20, 50, 100];
const bulkQuestionStatus = ref('');
const questionExportVisible = ref(false);
const pendingExportQuestionIds = ref([]);
const hydroAccounts = ref([]);
const hydroPlatforms = ref([]);
const questionExportOptions = reactive({
  format: 'zip',
  includeAnswers: true,
  includeAnalysis: true,
});
const form = reactive(baseForm());
const practiceVisible = ref(false);
const practiceDetail = ref(null);
const practiceResult = ref(null);
const practiceProgrammingResult = ref(null);
const practiceProgrammingSubmitLoading = ref(false);
const practiceHydroAccountId = ref('');
const answerLayout = ref('side');
const practiceAnswer = reactive(emptyPracticeAnswer());

const isEditing = computed(() => Boolean(editingId.value));
const isChoice = computed(() => isChoiceType(form.type));
const quickTags = computed(() => tags.value.slice(0, 3));
const formKnowledgeTreeOptions = computed(() => convertKnowledgeTree(formKnowledgeTree.value));
const filterKnowledgeTreeOptions = computed(() => convertKnowledgeTree(filterKnowledgeTree.value));
const editorTitle = computed(() => (isEditing.value ? '编辑题目 / 复制题目' : '题目编辑'));
const selectedQuestionIds = computed(() => selectedQuestionRows.value.map((row) => row.id));
const practiceDialogWidth = computed(() => (answerLayout.value === 'side' ? '1180px' : '860px'));
const practiceMatchedHydroAccounts = computed(() => matchedHydroAccountsFor(practiceDetail.value));
const canPullHydroProblem = computed(() =>
  Boolean(form.programmingRef.externalProblemId?.trim() || form.programmingRef.externalProblemUrl?.trim()),
);
const hydroProblemUrl = computed(() => {
  const explicit = effectiveHydroProblemUrl(form.programmingRef);
  const problemId = form.programmingRef.externalProblemId?.trim();
  if (explicit) return explicit;
  const baseUrl = normalizeBaseUrl(form.programmingRef.platformBaseUrl || 'https://oj.example.com');
  const domainId = form.programmingRef.domainId?.trim();
  const domainPrefix = domainId && domainId !== 'system' ? `/d/${encodeURIComponent(domainId)}` : '';
  return problemId ? `${baseUrl}${domainPrefix}/p/${encodeURIComponent(problemId)}` : '';
});
const hydroAccountOptions = computed(() =>
  matchingHydroAccountsForRef(form.programmingRef).map((account) => ({
    ...account,
    label: `${account.loginUsername || account.hydroUsername || '外部账号'} · ${account.platformName || account.platformCode || 'Hydro'} · ${shortHost(account.platformBaseUrl)}`,
  })),
);
const hydroSiteOptions = computed(() => {
  const map = new Map();
  const pushSite = (site) => {
    const value = normalizeBaseUrl(site.value || site.baseUrl || site.platformBaseUrl);
    const host = canonicalHost(value);
    if (!host || map.has(host)) return;
    map.set(host, {
      key: host,
      value,
      judgeProvider: site.judgeProvider || site.code || site.platformCode || 'hydro',
      label: `${site.name || site.platformName || '外部平台'} (${shortHost(value)})`,
    });
  };
  hydroPlatforms.value.forEach((platform) => pushSite(platform));
  hydroAccounts.value.forEach((account) =>
    pushSite({
      value: account.platformBaseUrl,
      platformCode: account.platformCode,
      platformName: account.platformName,
    }),
  );
  return [...map.values()];
});
const selectedHydroAccount = computed(() =>
  hydroAccounts.value.find((account) => account.id === form.programmingRef.accountId) ?? null,
);
const hydroBindingLabel = computed(() => {
  const parts = [
    form.programmingRef.platformBaseUrl,
    `域 ${formatHydroDomainLabel(form.programmingRef)}`,
    form.programmingRef.accountLabel || selectedHydroAccount.value?.loginUsername,
  ].filter(Boolean);
  return parts.join(' / ');
});

function formatHydroDomainLabel(ref) {
  const domainId = String(ref?.domainId || '').trim();
  const domainName = String(ref?.domainName || '').trim();
  if (domainId && domainName && domainName !== domainId && domainName !== 'system') {
    return `${domainId} / ${domainName}`;
  }
  return domainId || domainName || 'system';
}

function languageOptionsFor(question) {
  const languages = question?.programmingRef?.languages || [];
  return languages.length ? languages : ['cc.cc17o2', 'py.py3', 'java'];
}

function languageLabel(language) {
  const labels = {
    'cc.cc17o2': 'C++17(O2)',
    'cc.cc17': 'C++17',
    'cc.cc14o2': 'C++14(O2)',
    'cc.cc14': 'C++14',
    'cc.cc11o2': 'C++11(O2)',
    'cc.cc11': 'C++11',
    'py.py3': 'Python 3',
    'py.py2': 'Python 2',
    'cc.cc20o2': 'C++20(O2)',
    'cc.cc20': 'C++20',
    cpp17: 'C++17',
    python3: 'Python 3',
    java: 'Java',
    c: 'C',
    cc: 'C++',
    pas: 'Pascal',
  };
  return labels[language] ?? language;
}

function programmingFeedbackType(result) {
  if (!isProgrammingFinal(result)) return 'info';
  return isFullProgrammingScore(result) ? 'success' : 'error';
}

function programmingFeedbackTitle(result) {
  if (!isProgrammingFinal(result)) return '等待 Hydro 评测';
  return isFullProgrammingScore(result) ? '全部测试点通过' : '部分测试点未通过';
}

function isProgrammingFinal(result) {
  return Boolean(result) && !['pending', 'judging'].includes(result.status);
}

function isFullProgrammingScore(result) {
  const passed = Number(result?.passedTestCaseCount);
  const total = Number(result?.totalTestCaseCount);
  if (Number.isFinite(total) && total > 0 && Number.isFinite(passed)) return passed === total;
  const rate = Number(result?.scoreRate);
  if (Number.isFinite(rate)) return rate >= 1;
  const score = Number(result?.score);
  const maxScore = Number(result?.maxScore);
  if (Number.isFinite(score) && Number.isFinite(maxScore) && maxScore > 0) return score >= maxScore;
  if (result?.isCorrect === true) return true;
  if (result?.isCorrect === false) return false;
  return result?.status === 'accepted';
}

const practiceOptions = computed(() =>
  (practiceDetail.value?.options ?? []).map((option, index) => ({
    optionId: option.id ?? option.optionId,
    label: option.optionKey ?? option.label ?? optionKeyForIndex(index),
    content: option.content ?? '',
  })),
);
const correctChoiceKey = computed({
  get() {
    return form.options.find((option) => option.isCorrect)?.optionKey ?? '';
  },
  set(value) {
    form.options.forEach((option) => {
      option.isCorrect = option.optionKey === value;
    });
  },
});

function baseForm() {
  return {
    courseId: '',
    type: 'single_choice',
    status: 'draft',
    title: '',
    knowledgePointIds: [],
    tagNames: [],
    content: '',
    difficulty: 1,
    defaultScore: 2,
    analysis: '',
    programmingRef: emptyProgrammingRef(),
    children: [],
    options: [
      { optionKey: 'A', content: '', isCorrect: false, sortOrder: 1 },
      { optionKey: 'B', content: '', isCorrect: true, sortOrder: 2 },
      { optionKey: 'C', content: '', isCorrect: false, sortOrder: 3 },
      { optionKey: 'D', content: '', isCorrect: false, sortOrder: 4 },
    ],
  };
}

function emptyProgrammingRef() {
  return {
    externalProblemId: '',
    externalProblemUrl: '',
    platformBaseUrl: 'https://oj.example.com',
    domainId: 'system',
    domainName: 'system',
    judgeProvider: 'hydro',
    accountId: '',
    accountLabel: '',
    languagesText: 'cc.cc17o2, py.py3',
    timeLimit: null,
    memoryLimit: null,
    judgeConfig: null,
  };
}

async function loadCourses() {
  const data = await api('/courses?pageSize=100');
  courses.value = data.items;
  if (!form.courseId) form.courseId = courses.value[0]?.id ?? '';
  await loadFormKnowledgeTree();
  await loadFilterKnowledgeTree();
}

async function loadHydroAccounts() {
  try {
    const data = await api('/hydro/my/accounts');
    hydroAccounts.value = data.items ?? data ?? [];
    syncHydroAccountForSite();
  } catch {
    hydroAccounts.value = [];
  }
}

async function loadHydroPlatforms() {
  try {
    hydroPlatforms.value = await api('/hydro/platforms');
  } catch {
    hydroPlatforms.value = [];
  }
}

function handleHydroAccountChange(accountId) {
  const account = hydroAccounts.value.find((item) => item.id === accountId);
  if (!account) {
    form.programmingRef.accountLabel = '';
    return;
  }
  form.programmingRef.platformBaseUrl = account.platformBaseUrl || form.programmingRef.platformBaseUrl;
  form.programmingRef.judgeProvider = account.platformCode || form.programmingRef.judgeProvider || 'hydro';
  form.programmingRef.accountLabel = `${account.loginUsername || account.hydroUsername}@${shortHost(account.platformBaseUrl)}`;
}

function handleHydroSiteChange(value) {
  applyHydroSiteToRef(form.programmingRef, value);
  if (form.programmingRef.externalProblemUrl && value && !sameHydroBaseUrl(form.programmingRef.externalProblemUrl, value)) {
    form.programmingRef.externalProblemUrl = '';
  }
  syncHydroAccountForSite();
}

function handleHydroProblemInputChange() {
  normalizeHydroProblemInput(form.programmingRef);
  syncHydroAccountForSite();
}

function normalizeHydroProblemInput(ref) {
  const raw = String(ref.externalProblemId || '').trim();
  if (!raw) {
    ref.externalProblemUrl = '';
    return;
  }
  const parsed = parseHydroProblemUrl(raw);
  if (parsed) {
    ref.externalProblemId = parsed.problemId || raw;
    ref.externalProblemUrl = parsed.url;
    applyHydroSiteToRef(ref, parsed.baseUrl);
    if (parsed.domainId) {
      ref.domainId = parsed.domainId;
      ref.domainName = parsed.domainId;
    }
    return;
  }

  ref.externalProblemId = cleanHydroProblemId(raw);
  const explicitProblemId = problemIdFromHydroUrl(ref.externalProblemUrl);
  if (explicitProblemId && explicitProblemId !== ref.externalProblemId) {
    ref.externalProblemUrl = '';
  }
}

function applyHydroSiteToRef(ref, value) {
  const normalized = normalizeBaseUrl(value || ref.platformBaseUrl);
  const site = hydroSiteOptions.value.find((item) => sameHydroBaseUrl(item.value, normalized));
  ref.platformBaseUrl = site?.value || normalized;
  ref.judgeProvider = site?.judgeProvider || matchingHydroAccountForSite(ref.platformBaseUrl)?.platformCode || ref.judgeProvider || 'hydro';
}

function syncHydroAccountForSite() {
  const account = selectedHydroAccount.value;
  if (account && sameHydroBaseUrl(account.platformBaseUrl, form.programmingRef.platformBaseUrl)) {
    handleHydroAccountChange(account.id);
    return;
  }
  const nextAccount = matchingHydroAccountForSite(form.programmingRef.platformBaseUrl);
  form.programmingRef.accountId = nextAccount?.id || '';
  form.programmingRef.accountLabel = nextAccount
    ? `${nextAccount.loginUsername || nextAccount.hydroUsername}@${shortHost(nextAccount.platformBaseUrl)}`
    : '';
  if (nextAccount?.platformCode) {
    form.programmingRef.judgeProvider = nextAccount.platformCode;
  }
}

function matchingHydroAccountForSite(baseUrl) {
  return hydroAccounts.value.find((account) => account.bindStatus === 'bound' && sameHydroBaseUrl(account.platformBaseUrl, baseUrl))
    || hydroAccounts.value.find((account) => sameHydroBaseUrl(account.platformBaseUrl, baseUrl))
    || null;
}

watch(
  () => form.programmingRef.platformBaseUrl,
  (value) => {
    const account = selectedHydroAccount.value;
    if (account && value && !sameHydroBaseUrl(account.platformBaseUrl, value)) {
      form.programmingRef.accountId = '';
      form.programmingRef.accountLabel = '';
    }
  },
);

watch(
  () => form.programmingRef.externalProblemId,
  (value) => {
    const raw = String(value || '').trim();
    if (!raw || parseHydroProblemUrl(raw)) return;
    const currentProblemId = cleanHydroProblemId(raw);
    const explicitProblemId = problemIdFromHydroUrl(form.programmingRef.externalProblemUrl);
    if (explicitProblemId && explicitProblemId !== currentProblemId) {
      form.programmingRef.externalProblemUrl = '';
    }
  },
);

async function loadFormKnowledgeTree() {
  formKnowledgeTree.value = form.courseId ? await api(`/knowledge-points/tree?courseId=${form.courseId}`) : [];
}

async function loadFilterKnowledgeTree() {
  filterKnowledgeTree.value = filter.courseId ? await api(`/knowledge-points/tree?courseId=${filter.courseId}`) : [];
}

async function handleFormCourseChange() {
  form.knowledgePointIds = [];
  form.children = [];
  await loadFormKnowledgeTree();
  if (form.type === 'material') await loadMaterialCandidates();
}

async function loadMaterialCandidates() {
  if (!form.courseId) {
    materialCandidates.value = [];
    return;
  }
  const data = await api(`/questions${buildQuery({ page: 1, pageSize: 200, courseId: form.courseId, scope: 'published' })}`);
  materialCandidates.value = (data.items ?? []).filter((item) => item.type !== 'material' && item.id !== editingId.value);
}

function addMaterialChild() {
  const used = new Set(form.children.map((child) => child.questionId));
  const candidate = materialCandidates.value.find((item) => !used.has(item.id));
  form.children.push({
    questionId: candidate?.id || '',
    score: Number(candidate?.defaultScore || 1),
    sortOrder: form.children.length + 1,
  });
}

function removeMaterialChild(index) {
  form.children.splice(index, 1);
}

async function handleFilterCourseChange() {
  filter.knowledgePointId = '';
  await loadFilterKnowledgeTree();
  await loadFirstPage();
}

async function loadTags() {
  const data = await api('/tags?pageSize=100&type=QUESTION');
  tags.value = data.items;
}

async function load() {
  const data = await api(
    `/questions${buildQuery({
      page: pagination.page,
      pageSize: pagination.pageSize,
      courseId: filter.courseId,
      tagId: filter.tagId,
      knowledgePointId: filter.knowledgePointId,
      scope: questionScope.value,
      type: filter.type,
      keyword: filter.keyword,
      sortBy: filter.sortBy,
      sortOrder: filter.sortOrder,
    })}`,
  );
  items.value = data.items;
  pagination.page = data.page;
  pagination.pageSize = data.pageSize;
  pagination.total = data.total;
}

async function refreshAll() {
  await Promise.all([loadTags(), load()]);
}

function loadFirstPage() {
  pagination.page = 1;
  return load();
}

function handleQuestionSortChange({ prop, order }) {
  filter.sortBy = prop || 'createdAt';
  filter.sortOrder = order === 'ascending' ? 'asc' : 'desc';
  return loadFirstPage();
}

async function filterByTag(tag) {
  filter.tagId = tag.id;
  await loadFirstPage();
}

async function filterByKnowledgePoint(point) {
  if (point.courseId && filter.courseId !== point.courseId) {
    filter.courseId = point.courseId;
    await loadFilterKnowledgeTree();
  }
  filter.knowledgePointId = point.id;
  await loadFirstPage();
}

function handleSizeChange(size) {
  pagination.pageSize = size;
  pagination.page = 1;
  load();
}

function handleCurrentChange(page) {
  pagination.page = page;
  load();
}

function resetOptions() {
  if (form.type === 'material') {
    form.options = [];
    void loadMaterialCandidates();
    if (!form.children.length) addMaterialChild();
    return;
  }
  if (form.type === 'true_false') {
    form.options = [
      { optionKey: 'A', content: '正确', isCorrect: true, sortOrder: 1 },
      { optionKey: 'B', content: '错误', isCorrect: false, sortOrder: 2 },
    ];
    return;
  }

  if (isChoice.value) {
    form.options = baseForm().options.map((option) => ({ ...option }));
    return;
  }

  form.options = [];
}

function addBlankAnswerRow() {
  blankAnswerRows.value = [...blankAnswerRows.value, { answerText: '' }];
}

function removeBlankAnswerRow(index) {
  if (blankAnswerRows.value.length <= 1) return;
  blankAnswerRows.value = blankAnswerRows.value.filter((_, rowIndex) => rowIndex !== index);
}

function insertFormBlankMarker() {
  if (form.type !== 'fill_blank') return;
  if (!blankAnswerRows.value.length) addBlankAnswerRow();
  const marker = '____';
  const current = String(form.content || '');
  const needsSpace = current && !/[\s([{（【]$/.test(current);
  form.content = `${current}${needsSpace ? ' ' : ''}${marker}`;
  if (countBlankMarkers(form.content) > blankAnswerRows.value.length) {
    addBlankAnswerRow();
  }
}

function addOption() {
  const sortOrder = form.options.length + 1;
  form.options.push({
    optionKey: optionKeyForIndex(form.options.length),
    content: '',
    isCorrect: false,
    sortOrder,
  });
}

function removeOption(index) {
  form.options.splice(index, 1);
  renumberOptions();
  if ((form.type === 'single_choice' || form.type === 'true_false') && !form.options.some((option) => option.isCorrect)) {
    form.options[0].isCorrect = true;
  }
}

function renumberOptions() {
  form.options.forEach((option, index) => {
    option.optionKey = optionKeyForIndex(index);
    option.sortOrder = index + 1;
  });
}

function optionKeyForIndex(index) {
  return index < 26 ? String.fromCharCode(65 + index) : `X${index + 1}`;
}

function appendTag(name) {
  if (!form.tagNames.includes(name)) {
    form.tagNames.push(name);
  }
}

function insertCodeBlock(target, field) {
  const block = '\n```python\nprint("hello")\n```\n';
  target[field] = `${target[field] || ''}${block}`;
}

function validateForm() {
  validatePayload({ ...form, courseId: form.courseId }, '当前题目');
}

function validatePayload(payload, label) {
  if (!payload.courseId) throw new Error(`${label}：请选择课程`);
  if (!payload.title?.trim()) throw new Error(`${label}：请填写标题`);
  if (!payload.content?.trim()) throw new Error(`${label}：请填写题干`);
  if (!Number.isFinite(Number(payload.difficulty)) || payload.difficulty < 1 || payload.difficulty > 5) {
    throw new Error(`${label}：难度必须是 1-5`);
  }
  if (!Number.isFinite(Number(payload.defaultScore)) || payload.defaultScore < 0) {
    throw new Error(`${label}：分值不能小于 0`);
  }

  if (isChoiceType(payload.type)) {
    const options = payload.options ?? [];
    const correctCount = options.filter((option) => option.isCorrect).length;
    if (options.length < 2 || options.some((option) => !option.content?.trim())) {
      throw new Error(`${label}：请至少填写两个完整选项`);
    }
    if ((payload.type === 'single_choice' || payload.type === 'true_false') && correctCount !== 1) {
      throw new Error(`${label}：单选/判断题必须有且只有一个正确选项`);
    }
    if (payload.type === 'multiple_choice' && correctCount < 2) {
      throw new Error(`${label}：多选题至少需要两个正确选项`);
    }
  }
  if (payload.type === 'material') {
    if (!payload.children?.length || payload.children.some((child) => !child.questionId || Number(child.score) <= 0)) {
      throw new Error(`${label}：请至少选择一道子题并填写有效分值`);
    }
    if (new Set(payload.children.map((child) => child.questionId)).size !== payload.children.length) {
      throw new Error(`${label}：子题不能重复`);
    }
  }
}

async function buildQuestionPayload(options = {}) {
  const { includeStatus = isEditing.value } = options;
  validateForm();
  const tagIds = await resolveTagIds(form.tagNames);
  const payload = {
    courseId: form.courseId,
    type: form.type,
    title: form.title.trim(),
    content: form.content.trim(),
    difficulty: Number(form.difficulty),
    defaultScore: Number(form.defaultScore),
    analysis: form.analysis?.trim() || '',
    knowledgePointIds: [...form.knowledgePointIds],
    tagIds,
    options: isChoice.value
      ? form.options.map((option, index) => ({
          optionKey: option.optionKey,
          content: option.content.trim(),
          isCorrect: Boolean(option.isCorrect),
          sortOrder: index + 1,
        }))
      : [],
    children: form.type === 'material'
      ? form.children.map((child, index) => ({ questionId: child.questionId, score: Number(child.score), sortOrder: index + 1 }))
      : undefined,
  };

  if (form.type === 'programming') {
    payload.programmingRef = buildProgrammingRefPayload();
  }

  if (includeStatus) {
    payload.status = form.status;
  }

  if (form.type === 'fill_blank') {
    payload.answer = buildFillBlankAnswer(blankAnswerText.value, payload.defaultScore);
  } else if (!isChoice.value && answerReference.value.trim()) {
    payload.answer = { reference: answerReference.value.trim() };
  }

  return payload;
}

async function saveQuestion(shouldPublish) {
  saving.value = true;
  try {
    const payload = await buildQuestionPayload();
    const targetScope = shouldPublish ? 'published' : questionScopeForStatus(payload.status ?? form.status);
    const result = isEditing.value
      ? await api(`/questions/${editingId.value}`, { method: 'PATCH', body: payload })
      : await api('/questions', { method: 'POST', body: payload });

    const id = editingId.value || result.id;
    if (shouldPublish) {
      await api(`/questions/${id}/publish`, { method: 'POST' });
    }

    ElMessage.success(shouldPublish ? '已保存并发布' : isEditing.value ? '已保存修改' : '已创建');
    questionScope.value = targetScope;
    editorVisible.value = false;
    resetForm();
    await refreshAll();
  } catch (error) {
    ElMessage.error(error.message);
  } finally {
    saving.value = false;
  }
}

function questionScopeForStatus(status) {
  return status === 'published' ? 'published' : 'draft';
}

async function editQuestion(row) {
  let detail;
  try {
    detail = await api(`/questions/${row.id}`);
  } catch (error) {
    ElMessage.error(error.message);
    return;
  }
  editMode.value = true;
  editorVisible.value = true;
  editingId.value = detail.id;
  entryMode.value = 'single';
  Object.assign(form, {
    courseId: detail.courseId,
    type: detail.type,
    status: detail.status,
    title: detail.title,
    knowledgePointIds: (detail.knowledgePoints ?? []).map((point) => point.id),
    tagNames: (detail.tags ?? []).map((tag) => tag.name),
    content: detail.content,
    difficulty: detail.difficulty,
    defaultScore: Number(detail.defaultScore),
    analysis: detail.analysis ?? '',
    programmingRef: {
      externalProblemId: detail.programmingRef?.externalProblemId ?? '',
      externalProblemUrl: detail.programmingRef?.externalProblemUrl ?? '',
      platformBaseUrl: detail.programmingRef?.platformBaseUrl ?? detail.programmingRef?.judgeConfig?.platformBaseUrl ?? 'https://oj.example.com',
      domainId: detail.programmingRef?.domainId ?? detail.programmingRef?.judgeConfig?.domainId ?? 'system',
      domainName: detail.programmingRef?.domainName ?? detail.programmingRef?.judgeConfig?.domainName ?? 'system',
      judgeProvider: detail.programmingRef?.judgeProvider ?? detail.programmingRef?.judgeConfig?.platformCode ?? 'hydro',
      accountId: detail.programmingRef?.accountId ?? detail.programmingRef?.judgeConfig?.accountId ?? '',
      accountLabel: detail.programmingRef?.accountLabel ?? detail.programmingRef?.judgeConfig?.accountLabel ?? '',
      languagesText: (detail.programmingRef?.languages ?? []).join(', ') || 'cc.cc17o2, py.py3',
      timeLimit: detail.programmingRef?.timeLimit ?? null,
      memoryLimit: detail.programmingRef?.memoryLimit ?? null,
      judgeConfig: detail.programmingRef?.judgeConfig ?? null,
    },
    options: (detail.options ?? []).map((option, index) => ({
      optionKey: option.optionKey || optionKeyForIndex(index),
      content: option.content,
      isCorrect: option.isCorrect,
      sortOrder: option.sortOrder ?? index + 1,
    })),
    children: (detail.children ?? []).map((child, index) => ({
      questionId: child.questionId,
      score: Number(child.score),
      sortOrder: child.sortOrder ?? index + 1,
    })),
  });
  if (form.type === 'material') await loadMaterialCandidates();
  await loadFormKnowledgeTree();
  if (isChoice.value && !form.options.length) resetOptions();

  const answerJson = detail.answer?.answerJson ?? {};
  blankAnswerText.value = fillBlankAnswerTextFromRules(answerJson.blanks);
  answerReference.value = answerJson.reference ?? '';
}

async function copyQuestion() {
  if (!isEditing.value) {
    ElMessage.warning('请先选择一道题目');
    return;
  }

  saving.value = true;
  try {
    const payload = await buildQuestionPayload({ includeStatus: false });
    payload.title = `${payload.title}（副本）`;
    const created = await api('/questions', { method: 'POST', body: payload });
    ElMessage.success('已复制为草稿题目');
    await refreshAll();
    await editQuestion({ id: created.id });
  } catch (error) {
    ElMessage.error(error.message);
  } finally {
    saving.value = false;
  }
}

function handleQuestionRowClick(row) {
  if (editMode.value) {
    editQuestion(row);
    return;
  }

  openPracticeQuestion(row);
}

function handleSelectionChange(rows) {
  selectedQuestionRows.value = rows;
}

function openRelatedExams(row) {
  const examId = row.occupationExams?.[0]?.id;
  router.push(examId ? `/exams?focusExamId=${examId}` : '/exams');
}

function onEditModeChange(value) {
  if (!value) {
    closeEditor();
    ElMessage.info('已退出编辑模式，点击题目将进入答题');
    return;
  }

  ElMessage.warning('已进入编辑模式，点击题目将打开编辑/复制窗口');
}

async function bulkDeleteQuestions() {
  if (!selectedQuestionIds.value.length) {
    ElMessage.warning('请选择需要删除的题目');
    return;
  }

  try {
    await ElMessageBox.confirm(
      `风险操作提示：将批量归档 ${selectedQuestionIds.value.length} 道题目，并从引用这些题目的试卷中同步移除题位、重算总分；历史答卷与已生成考试快照仍会保留。`,
      '批量删除题目',
      {
        type: 'warning',
        confirmButtonText: '批量删除',
        cancelButtonText: '取消',
      },
    );
    const result = await api('/questions/batch/delete', {
      method: 'POST',
      body: { ids: selectedQuestionIds.value },
    });
    const failedText = result.failed?.length ? `，${result.failed.length} 道失败` : '';
    ElMessage.success(`已删除 ${result.successCount} 道题${failedText}`);
    selectedQuestionRows.value = [];
    await refreshAll();
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.message);
    }
  }
}

async function bulkUpdateQuestionStatus() {
  if (!selectedQuestionIds.value.length || !bulkQuestionStatus.value) {
    ElMessage.warning('请选择题目和目标状态');
    return;
  }

  try {
    await ElMessageBox.confirm(
      `风险操作提示：将批量把 ${selectedQuestionIds.value.length} 道题设置为“${statusLabel(bulkQuestionStatus.value)}”，会影响题库可见性和后续组卷。`,
      '批量设置题目状态',
      {
        type: 'warning',
        confirmButtonText: '批量设置',
        cancelButtonText: '取消',
      },
    );
    const result = await api('/questions/batch/status', {
      method: 'PATCH',
      body: { ids: selectedQuestionIds.value, status: bulkQuestionStatus.value },
    });
    const failedText = result.failed?.length ? `，${result.failed.length} 道失败` : '';
    ElMessage.success(`已设置 ${result.successCount} 道题为${statusLabel(result.status)}${failedText}`);
    selectedQuestionRows.value = [];
    await refreshAll();
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.message);
    }
  }
}

function openQuestionExportDialog(questionIds) {
  const ids = [...questionIds];
  if (!ids.length) {
    ElMessage.warning('请先选择需要导出的题目');
    return;
  }

  pendingExportQuestionIds.value = ids;
  questionExportVisible.value = true;
}

async function exportQuestion(row) {
  openQuestionExportDialog([row.id]);
}

function handleQuestionCommand(row, command) {
  const actions = {
    edit: () => editQuestion(row),
    publish: () => changeStatus(row, 'published'),
    unpublish: () => changeStatus(row, 'draft'),
    hide: () => changeStatus(row, 'disabled'),
    show: () => changeStatus(row, 'draft'),
    download: () => exportQuestion(row),
    delete: () => removeQuestion(row),
  };
  return actions[command]?.();
}

function buildProgrammingRefPayload() {
  normalizeHydroProblemInput(form.programmingRef);
  const externalProblemId = form.programmingRef.externalProblemId.trim();
  if (!externalProblemId) return null;
  const payload = {
    judgeProvider: form.programmingRef.judgeProvider || undefined,
    externalProblemId,
    externalProblemUrl: effectiveHydroProblemUrl(form.programmingRef) || undefined,
    platformBaseUrl: form.programmingRef.platformBaseUrl?.trim() || undefined,
    domainId: form.programmingRef.domainId?.trim() || undefined,
    domainName: form.programmingRef.domainName?.trim() || undefined,
    accountId: form.programmingRef.accountId || undefined,
    accountLabel: form.programmingRef.accountLabel?.trim() || undefined,
    languages: parseHydroLanguages(form.programmingRef.languagesText),
  };
  if (form.programmingRef.timeLimit) payload.timeLimit = Number(form.programmingRef.timeLimit);
  if (form.programmingRef.memoryLimit) payload.memoryLimit = Number(form.programmingRef.memoryLimit);
  if (form.programmingRef.judgeConfig) {
    payload.judgeConfig = {
      ...form.programmingRef.judgeConfig,
      ...(form.programmingRef.judgeProvider ? { platformCode: form.programmingRef.judgeProvider } : {}),
    };
  }
  return payload;
}

async function pullHydroProblem() {
  normalizeHydroProblemInput(form.programmingRef);
  if (!canPullHydroProblem.value) {
    ElMessage.warning('请先填写 Hydro 题号或链接');
    return;
  }

  const problemUrl = effectiveHydroProblemUrl(form.programmingRef);
  hydroPulling.value = true;
  try {
    const pulled = await api(
      `/hydro/problems/pull${buildQuery({
        problemId: form.programmingRef.externalProblemId.trim(),
        problemUrl,
        platformBaseUrl: form.programmingRef.platformBaseUrl.trim(),
        domainId: form.programmingRef.domainId.trim(),
        domainName: form.programmingRef.domainName.trim(),
        accountId: form.programmingRef.accountId,
        judgeProvider: form.programmingRef.judgeProvider,
      })}`,
    );
    applyPulledHydroProblem(form, pulled);
    ElMessage.success('Hydro 题目已拉取');
  } catch (error) {
    ElMessage.error(error.message || 'Hydro 题目拉取失败');
  } finally {
    hydroPulling.value = false;
  }
}

function applyPulledHydroProblem(target, pulled) {
  const ref = pulled.programmingRef ?? pulled;
  target.type = 'programming';
  target.title = pulled.title || target.title;
  target.content = pulled.content || target.content;
  target.programmingRef.externalProblemId = ref.externalProblemId || pulled.externalProblemId || target.programmingRef.externalProblemId;
  target.programmingRef.externalProblemUrl = ref.externalProblemUrl || pulled.externalProblemUrl || target.programmingRef.externalProblemUrl;
  target.programmingRef.platformBaseUrl = ref.platformBaseUrl || ref.judgeConfig?.platformBaseUrl || target.programmingRef.platformBaseUrl;
  target.programmingRef.judgeProvider = ref.judgeProvider || ref.judgeConfig?.platformCode || target.programmingRef.judgeProvider || 'hydro';
  const pulledDomainId = ref.domainId || ref.judgeConfig?.domainId || target.programmingRef.domainId || 'system';
  target.programmingRef.domainId = pulledDomainId;
  target.programmingRef.domainName = ref.domainName || ref.judgeConfig?.domainName || pulledDomainId;
  target.programmingRef.accountId = ref.accountId || ref.judgeConfig?.accountId || target.programmingRef.accountId || '';
  target.programmingRef.accountLabel = ref.accountLabel || ref.judgeConfig?.accountLabel || target.programmingRef.accountLabel || '';
  target.programmingRef.languagesText = (ref.languages || pulled.languages || []).join(', ') || target.programmingRef.languagesText;
  target.programmingRef.timeLimit = ref.timeLimit ?? pulled.timeLimit ?? null;
  target.programmingRef.memoryLimit = ref.memoryLimit ?? pulled.memoryLimit ?? null;
  target.programmingRef.judgeConfig = ref.judgeConfig ?? null;
  resetOptions();
}

function openHydroProblemUrl() {
  if (!hydroProblemUrl.value) return;
  window.open(hydroProblemUrl.value, '_blank', 'noopener,noreferrer');
}

function effectiveHydroProblemUrl(ref) {
  const explicit = String(ref?.externalProblemUrl || '').trim();
  if (!explicit) return '';
  const explicitProblemId = problemIdFromHydroUrl(explicit);
  const currentProblemId = cleanHydroProblemId(ref?.externalProblemId);
  if (explicitProblemId && currentProblemId && explicitProblemId !== currentProblemId) return '';
  return explicit;
}

function cleanHydroProblemId(value) {
  return String(value || '').trim().replace(/^#/, '');
}

function parseHydroProblemUrl(value) {
  const raw = String(value || '').trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const parsed = new URL(raw);
    const problemId = problemIdFromHydroUrl(raw);
    if (!problemId) return null;
    return {
      url: raw,
      problemId,
      baseUrl: `${parsed.protocol}//${parsed.host}`,
      domainId: domainIdFromHydroUrl(raw) || 'system',
    };
  } catch {
    return null;
  }
}

function problemIdFromHydroUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/\/p\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]).trim() : '';
}

function domainIdFromHydroUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/\/d\/([^/]+)\/p\//);
  return match?.[1] ? decodeURIComponent(match[1]).trim() : 'system';
}

function normalizeBaseUrl(value) {
  const raw = String(value || 'https://oj.example.com').trim() || 'https://oj.example.com';
  return (/^https?:\/\//i.test(raw) ? raw : `http://${raw}`).replace(/\/+$/, '');
}

function shortHost(value) {
  try {
    return new URL(normalizeBaseUrl(value)).host;
  } catch {
    return String(value || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  }
}

function baseUrlFromProblemUrl(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
}

function programmingRefBaseUrl(ref) {
  const raw = ref?.platformBaseUrl || baseUrlFromProblemUrl(ref?.externalProblemUrl);
  return raw ? normalizeBaseUrl(raw) : '';
}

function matchingHydroAccountsForRef(ref) {
  const targetBaseUrl = programmingRefBaseUrl(ref);
  if (!targetBaseUrl) return hydroAccounts.value;
  return hydroAccounts.value.filter((account) => sameHydroBaseUrl(account.platformBaseUrl, targetBaseUrl));
}

function matchedHydroAccountsFor(question) {
  const targetBaseUrl = programmingRefBaseUrl(question?.programmingRef);
  if (!targetBaseUrl) return [];
  return hydroAccounts.value.filter(
    (account) => account.bindStatus === 'bound' && sameHydroBaseUrl(account.platformBaseUrl, targetBaseUrl),
  );
}

function defaultHydroAccountId(question) {
  const matched = matchedHydroAccountsFor(question);
  const boundAccountId = question?.programmingRef?.accountId;
  return matched.find((account) => account.id === boundAccountId)?.id || matched[0]?.id || '';
}

function hydroPracticeAccountLabel(account) {
  return `${account.loginUsername || account.hydroUsername || 'Hydro账号'} · ${shortHost(account.platformBaseUrl)}`;
}

function sameHydroBaseUrl(left, right) {
  const leftHost = canonicalHost(left);
  const rightHost = canonicalHost(right);
  return Boolean(leftHost && rightHost && leftHost === rightHost);
}

function canonicalHost(value) {
  return shortHost(value).toLowerCase().replace(/^www\./, '');
}

function hydroSourceLabel(ref) {
  const host = shortHost(programmingRefBaseUrl(ref));
  const domain = ref?.domainName || ref?.domainId || 'system';
  return [host, domain && domain !== 'system' ? domain : 'system'].filter(Boolean).join(' / ');
}

function parseHydroLanguages(value) {
  return String(value || '')
    .split(/[,，、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function exportQuestions(questionIds) {
  try {
    await api('/exports', {
      method: 'POST',
      body: {
        type: 'question_bank',
        format: questionExportOptions.format,
        questionIds,
        includeAnswers: questionExportOptions.includeAnswers,
        includeAnalysis: questionExportOptions.includeAnalysis,
      },
    });
    ElMessage.success('题目导出任务已加入队列，可到导出中心下载');
  } catch (error) {
    ElMessage.error(error.message || '题目导出失败');
  }
}

async function confirmQuestionExport() {
  await exportQuestions(pendingExportQuestionIds.value);
  questionExportVisible.value = false;
}

function closeEditor() {
  editorVisible.value = false;
  resetForm();
}

async function openPracticeQuestion(row) {
  try {
    practiceDetail.value = await api(`/questions/${row.id}`);
    clearPracticeAnswer();
    practiceHydroAccountId.value =
      practiceDetail.value?.type === 'programming' ? defaultHydroAccountId(practiceDetail.value) : '';
    practiceVisible.value = true;
  } catch (error) {
    ElMessage.error(error.message);
  }
}

function editQuestionFromPractice() {
  const detail = practiceDetail.value;
  practiceVisible.value = false;
  if (detail) {
    editMode.value = true;
    editQuestion(detail);
  }
}

async function checkPracticeAnswer() {
  if (!practiceDetail.value) return;
  if (practiceDetail.value.type === 'programming') {
    await submitPracticeProgrammingAnswer();
    return;
  }
  try {
    practiceResult.value = await api(`/questions/${practiceDetail.value.id}/check-answer`, {
      method: 'POST',
      body: payloadForPracticeAnswer(),
    });
  } catch (error) {
    ElMessage.error(error.message);
  }
}

async function submitPracticeProgrammingAnswer() {
  if (!practiceDetail.value) return;
  if (!String(practiceAnswer.code ?? '').trim()) {
    ElMessage.warning('请先填写代码');
    return;
  }
  if (!practiceHydroAccountId.value) {
    ElMessage.warning('请选择当前题目来源站点下的提交账号');
    return;
  }
  practiceProgrammingSubmitLoading.value = true;
  try {
    const response = await api(`/hydro/questions/${practiceDetail.value.id}/submit-code`, {
      method: 'POST',
      body: {
        language: practiceAnswer.language || languageOptionsFor(practiceDetail.value)[0],
        code: practiceAnswer.code,
        accountId: practiceHydroAccountId.value,
      },
    });
    practiceProgrammingResult.value = response;
    ElMessage.success(response.message || '代码已提交到 Hydro');
  } catch (error) {
    ElMessage.error(error.message || 'Hydro 提交失败');
  } finally {
    practiceProgrammingSubmitLoading.value = false;
  }
}

function openHydroProblem(question) {
  const url = question?.programmingRef?.externalProblemUrl;
  if (!url) {
    ElMessage.warning('该题尚未配置 Hydro 链接');
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

function isSplitPracticeQuestion(type) {
  return Boolean(type) && !objectiveQuestionTypes.has(type);
}

function emptyPracticeAnswer(question = null) {
  return {
    selectedOptionIds: [],
    blanks: blankAnswerList(question),
    text: '',
    code: '',
    language: languageOptionsFor(question)[0] || 'cc.cc17o2',
  };
}

function clearPracticeAnswer() {
  Object.assign(practiceAnswer, emptyPracticeAnswer(practiceDetail.value));
  practiceResult.value = null;
  practiceProgrammingResult.value = null;
}

function payloadForPracticeAnswer() {
  if (practiceAnswer.selectedOptionIds.filter(Boolean).length) {
    return { selectedOptionIds: practiceAnswer.selectedOptionIds.filter(Boolean) };
  }
  if (practiceAnswer.blanks.some((blank) => String(blank.value ?? '').trim())) {
    return { blanks: practiceAnswer.blanks };
  }
  if (String(practiceAnswer.text ?? '').trim()) {
    return { text: practiceAnswer.text };
  }
  if (String(practiceAnswer.code ?? '').trim()) {
    return {
      text: practiceAnswer.code,
      code: practiceAnswer.code,
      language: practiceAnswer.language || 'cc.cc17o2',
    };
  }
  return {};
}

function blankCountFor(question) {
  const explicit = Number(question?.blankCount);
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);
  const answerBlanks = question?.answer?.blanks;
  if (Array.isArray(answerBlanks) && answerBlanks.length) return answerBlanks.length;
  return Math.max(1, countBlankMarkers(question?.content));
}

function blankAnswerList(question, existing = []) {
  const source = Array.isArray(existing) ? existing : [];
  const count = Math.max(blankCountFor(question), ...source.map((blank) => Number(blank?.index) || 0), 1);
  return Array.from({ length: count }, (_, index) => {
    const blankIndex = index + 1;
    const current = source.find((blank) => Number(blank?.index) === blankIndex);
    return { index: blankIndex, value: current?.value ?? '' };
  });
}

function countBlankMarkers(content) {
  const matches = String(content || '').match(/_{3,}|\(\s*\)|（\s*）|\[\s*\]/g);
  return matches?.length || 1;
}

function resetForm() {
  editingId.value = '';
  Object.assign(form, baseForm(), { courseId: courses.value[0]?.id ?? '' });
  blankAnswerRows.value = emptyFillBlankRows();
  answerReference.value = '';
  loadFormKnowledgeTree();
}

async function changeStatus(row, status) {
  try {
    if (editMode.value) {
      await ElMessageBox.confirm(
        `风险操作提示：将“${row.title}”设置为${statusLabel(status)}会影响题库可见性和后续组卷，已生成试卷快照不会自动同步。`,
        '确认状态变更',
        {
          type: 'warning',
          confirmButtonText: `设置为${statusLabel(status)}`,
          cancelButtonText: '取消',
        },
      );
    }
    if (status === 'published') {
      await api(`/questions/${row.id}/publish`, { method: 'POST' });
    } else {
      await api(`/questions/${row.id}`, { method: 'PATCH', body: { status } });
    }
    ElMessage.success(`已设置为${statusLabel(status)}`);
    await load();
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.message);
    }
  }
}

async function removeQuestion(row) {
  try {
    const impact = await api(`/questions/${row.id}/delete-impact`);
    const references = impact.references || {};
    const resources = impact.resources || [];
    const risks = impact.risks || [];
    const relatedPaperNames = (impact.relatedPapers || []).slice(0, 5).map((paper) => paper.name).join('、');
    const resourceReferenceCount = resources.reduce((sum, item) => sum + Number(item.referenceCount || 0), 0);
    const resourceLocations = resources
      .flatMap((item) => item.locations || [])
      .slice(0, 3)
      .join('；');
    const lines = [
      `试卷引用：${references.paperCount || 0} 份 / ${references.paperQuestionCount || 0} 个位置`,
      ...(relatedPaperNames ? [`关联试卷：${relatedPaperNames}${impact.relatedPapers.length > 5 ? ' 等' : ''}`] : []),
      `关联考试：${references.examCount || 0} 场，其中进行中或已安排 ${references.activeExamCount || 0} 场`,
      `试卷快照：${references.paperInstanceCount || 0} 份`,
      `答题记录：${references.answerRecordCount || 0} 条，错题记录：${references.wrongQuestionCount || 0} 条`,
      `资源引用：${resources.length} 个资源 / ${resourceReferenceCount} 处引用${resources.some((item) => !item.managed) ? '（含未纳管资源）' : ''}`,
      ...(resourceLocations ? [`资源位置：${resourceLocations}`] : []),
      ...risks,
    ];
    await ElMessageBox.confirm(
      `确认删除题目“${row.title}”？\n\n${lines.join('\n')}\n\n删除后题目会归档，并从上述试卷中同步移除；历史答卷和已生成的考试快照仍会保留。`,
      '删除题目风险确认',
      {
        type: 'warning',
        confirmButtonText: '确认删除',
        cancelButtonText: '取消',
      },
    );
    const result = await api(`/questions/${row.id}`, { method: 'DELETE' });
    ElMessage.success(result.message || '已删除');
    if (editingId.value === row.id) resetForm();
    await load();
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.message ?? '已取消');
    }
  }
}

async function resolveTagIds(tagNames = []) {
  const names = [...new Set(tagNames.map((name) => String(name).trim()).filter(Boolean))];
  const ids = [];

  for (const [index, name] of names.entries()) {
    const existing = tags.value.find((tag) => tag.name === name);
    if (existing) {
      ids.push(existing.id);
      continue;
    }

    const created = await api('/tags', {
      method: 'POST',
      body: {
        name,
        code: makeTagCode(name, index),
        type: 'QUESTION',
      },
    });
    ids.push(created.id);
    tags.value.unshift(created);
  }

  return ids;
}

function makeTagCode(name, index) {
  const ascii = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
  return `q_${ascii || 'tag'}_${Date.now()}_${index}`;
}

function isChoiceType(type) {
  return ['single_choice', 'multiple_choice', 'true_false'].includes(type);
}

function typeLabel(value) {
  return typeOptions.find((item) => item.value === value)?.label ?? value ?? '';
}

function statusLabel(value) {
  return statusOptions.find((item) => item.value === value)?.label ?? value ?? '';
}

function statusTagType(value) {
  const map = {
    draft: 'info',
    pending_review: 'warning',
    published: 'success',
    disabled: 'danger',
  };
  return map[value] ?? 'info';
}

function formatDateTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function convertKnowledgeTree(items) {
  return items.map((item) => ({
    label: `${item.sortOrder ? `${item.sortOrder}. ` : ''}${item.name}`,
    value: item.id,
    children: convertKnowledgeTree(item.children ?? []),
  }));
}

onMounted(async () => {
  await Promise.all([loadCourses(), loadTags(), loadHydroPlatforms(), loadHydroAccounts()]);
  await load();
});
</script>
