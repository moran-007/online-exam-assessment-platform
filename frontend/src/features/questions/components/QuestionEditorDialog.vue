<template>
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
                    <el-tag>第 {{ Number(index) + 1 }} 空</el-tag>
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
                  <el-alert type="info" :closable="false" title="当前仅支持单层组合；材料/组合题本身不计分，总分由子题分值相加。" />
                  <div v-for="(child, index) in form.children" :key="`${child.questionId}-${index}`" class="material-child-row">
                    <el-tag>{{ Number(index) + 1 }}</el-tag>
                    <el-select v-model="child.questionId" filterable placeholder="选择已发布子题" style="flex: 1">
                      <el-option
                        v-for="candidate in materialCandidates"
                        :key="candidate.id"
                        :label="`${candidate.title}（${typeLabel(candidate.type)}）`"
                        :value="candidate.id"
                        :disabled="isMaterialCandidateDisabled(candidate.id, index)"
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
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useQuestionPageContext } from '../composables/questionPageContext';
import MarkdownRenderer from '../../../components/MarkdownRenderer.vue';

export default defineComponent({
  components: { MarkdownRenderer },
  setup: useQuestionPageContext,
});
</script>
