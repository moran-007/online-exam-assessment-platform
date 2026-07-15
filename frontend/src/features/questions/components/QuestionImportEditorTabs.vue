<template>
<el-tabs v-model="importMode" class="import-tabs" @tab-change="handleImportModeChange">
      <el-tab-pane label="单题导入" name="single">
        <el-form :model="singleForm" label-width="88px">
          <div class="single-meta-grid">
            <el-form-item label="题型">
              <el-select v-model="singleForm.type" filterable style="width: 100%" @change="handleSingleTypeChange">
                <el-option v-for="type in typeOptions" :key="type.value" :label="type.label" :value="type.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="标题" class="single-title-item">
              <el-input v-model="singleForm.title" placeholder="请输入题目标题" />
            </el-form-item>
            <el-form-item label="难度">
              <div class="inline-control">
                <el-rate v-model="singleForm.difficulty" :max="5" />
                <span class="muted">1-5</span>
              </div>
            </el-form-item>
            <el-form-item label="分值">
              <el-input-number v-model="singleForm.defaultScore" :min="0" :step="1" />
            </el-form-item>
          </div>
          <el-alert
            v-if="singlePreviewError"
            :title="singlePreviewError"
            type="warning"
            show-icon
            :closable="false"
            class="question-entry-guide"
          />
          <el-alert
            v-else
            :title="singleEntryTip.title"
            :description="singleEntryTip.description"
            type="info"
            show-icon
            :closable="false"
            class="question-entry-guide"
          />

          <template v-if="singleForm.type === 'programming'">
            <el-form-item label="Hydro题目">
              <div class="hydro-inline-field">
                <el-input
                  v-model="singleForm.programmingRef.externalProblemId"
                  placeholder="输入题号或题目地址，例如 P1000 / https://tarjanoj.com/d/shiyan/p/B2002"
                  @change="handleSingleHydroProblemInputChange"
                  @blur="handleSingleHydroProblemInputChange"
                />
                <el-button :icon="Refresh" :loading="singleHydroPulling" :disabled="!canPullSingleHydroProblem" @click="pullSingleHydroProblem">
                  拉取
                </el-button>
                <el-button :icon="Link" :disabled="!singleHydroProblemUrl" @click="openSingleHydroProblem">打开</el-button>
              </div>
            </el-form-item>
            <el-form-item label="站点">
              <el-select
                v-model="singleForm.programmingRef.platformBaseUrl"
                filterable
                allow-create
                default-first-option
                placeholder="选择平台站点"
                style="width: 100%"
                @change="handleSingleHydroSiteChange"
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
                <el-input v-model="singleForm.programmingRef.domainId" placeholder="默认 system；其他域填写域 ID" />
                <el-input v-model="singleForm.programmingRef.domainName" placeholder="域名称/备注，可选" />
              </div>
            </el-form-item>
            <el-form-item label="录入账号">
              <div class="hydro-inline-field">
                <el-select
                  v-model="singleForm.programmingRef.accountId"
                  clearable
                  filterable
                  placeholder="同站点账号自动匹配，可手动切换"
                  @change="handleSingleHydroAccountChange"
                >
                  <el-option
                    v-for="account in hydroAccountOptions"
                    :key="account.id"
                    :label="account.label"
                    :value="account.id"
                  />
                </el-select>
                <el-tag v-if="singleHydroBindingLabel" type="info">{{ singleHydroBindingLabel }}</el-tag>
              </div>
            </el-form-item>
            <el-form-item label="测评语言">
              <el-input v-model="singleForm.programmingRef.languagesText" placeholder="cc.cc17o2, py.py3, java" />
            </el-form-item>
          </template>
          <el-form-item :label="singleForm.type === 'material' ? '大题说明' : '题干'">
            <div style="width: 100%">
              <div class="toolbar" style="margin-bottom: 8px">
                <el-button size="small" :icon="DocumentAdd" @click="insertCodeBlock(singleForm, 'content')">
                  代码块
                </el-button>
                <el-button
                  v-if="singleForm.type === 'fill_blank'"
                  size="small"
                  :icon="Plus"
                  @click="insertSingleBlankMarker"
                >
                  插入空位
                </el-button>
                <el-dropdown trigger="click" @command="insertFormatSnippet">
                  <el-button size="small">插入格式</el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="math-inline">行内数学公式</el-dropdown-item>
                      <el-dropdown-item command="math-block">数学公式块</el-dropdown-item>
                      <el-dropdown-item command="chem-inline">化学式</el-dropdown-item>
                      <el-dropdown-item command="chem-equation">化学方程式</el-dropdown-item>
                      <el-dropdown-item command="symbols">常用特殊符号</el-dropdown-item>
                      <el-dropdown-item command="table">Markdown 表格</el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
                <el-button size="small" :icon="DocumentCopy" @click="loadSingleTemplate">加载模板</el-button>
              </div>
              <el-input
                v-model="singleForm.content"
                type="textarea"
                :rows="8"
                resize="vertical"
                :placeholder="singleForm.type === 'material' ? '填写材料正文、阅读背景或多问简答题的统一说明，支持 Markdown 和代码块' : '支持 Markdown 和代码块'"
                @focus="setImageInsertTarget(singleForm, 'content')"
                @paste="handleImagePaste($event, singleForm, 'content')"
              />
            </div>
          </el-form-item>

          <template v-if="isSingleChoice">
            <el-form-item label="选项">
              <div class="choice-editor">
                <div class="toolbar">
                  <el-button v-if="singleForm.type !== 'true_false'" size="small" :icon="Plus" @click="addSingleOption">
                    增加选项
                  </el-button>
                  <span class="muted">单选/判断只允许一个正确项，多选至少两个正确项。</span>
                </div>
                <div v-for="(option, index) in singleForm.options" :key="option.optionKey" class="option-editor">
                  <el-radio
                    v-if="singleForm.type === 'single_choice' || singleForm.type === 'true_false'"
                    v-model="correctChoiceKey"
                    :label="option.optionKey"
                  />
                  <el-checkbox v-else v-model="option.isCorrect" />
                  <el-tag>{{ option.optionKey }}</el-tag>
                  <div class="option-content">
                    <el-input
                      v-model="option.content"
                      type="textarea"
                      :rows="2"
                      resize="vertical"
                      @focus="setImageInsertTarget(option, 'content')"
                      @paste="handleImagePaste($event, option, 'content')"
                    />
                    <MarkdownRenderer v-if="option.content" :source="option.content" />
                  </div>
                  <el-button
                    v-if="singleForm.type !== 'true_false'"
                    size="small"
                    plain
                    :icon="Delete"
                    :disabled="singleForm.options.length <= 2"
                    @click="removeSingleOption(index)"
                  >
                    删除
                  </el-button>
                </div>
              </div>
            </el-form-item>
          </template>
          <el-form-item v-else-if="singleForm.type === 'fill_blank'" label="答案">
            <div class="fill-blank-answer-editor">
              <div class="toolbar">
                <el-button size="small" :icon="Plus" @click="addBlankAnswerRow">增加空位</el-button>
                <el-button size="small" :icon="DocumentAdd" @click="insertSingleBlankMarker">插入题干空位</el-button>
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
          <el-form-item v-else-if="singleForm.type === 'material'" label="子题">
            <div class="material-child-editor">
              <div class="material-child-editor-head">
                <div>
                  <strong>子题结构</strong>
                  <p class="mini-muted">左侧只保留题号和标题；新增或修改子题会打开弹窗，右侧预览实时展示完整题干、选项和分值。</p>
                </div>
                <el-tag type="info">当前 {{ singleForm.children.length }} 道 · {{ singleMaterialScore }} 分</el-tag>
              </div>

              <div class="material-child-builder">
                <aside class="material-child-list">
                  <button
                    v-for="(child, index) in singleForm.children"
                    :key="child.localId"
                    type="button"
                    :class="['material-child-list-item', selectedMaterialChildIndex === index ? 'active' : '']"
                    @click="editSingleMaterialChild(index)"
                  >
                    <span class="material-child-index">第 {{ Number(index) + 1 }} 题</span>
                    <strong>{{ child.title || `${typeLabel(child.type)}小题` }}</strong>
                    <small>{{ typeLabel(child.type) }} · {{ child.score }} 分</small>
                  </button>
                  <el-empty v-if="!singleForm.children.length" description="还没有子题" />
                </aside>

                <div class="material-child-actions">
                  <el-alert
                    type="info"
                    :closable="false"
                    title="材料正文写在上方“大题说明”；每道小题在弹窗里独立设置题干、答案、解析和分值。"
                  />
                  <div class="toolbar">
                    <el-button plain :icon="Plus" @click="openMaterialChildDialog('short_answer')">增加简答小题</el-button>
                    <el-button plain :icon="Plus" @click="openMaterialChildDialog('fill_blank')">增加填空小题</el-button>
                    <el-button plain :icon="Plus" @click="openMaterialChildDialog('single_choice')">增加选择小题</el-button>
                  </div>
                  <div v-if="selectedMaterialChild" class="selected-material-child-summary">
                    <span class="mini-muted">当前选中</span>
                    <strong>{{ selectedMaterialChild.title || `第 ${selectedMaterialChildIndex + 1} 题` }}</strong>
                    <span>{{ typeLabel(selectedMaterialChild.type) }} · {{ selectedMaterialChild.score }} 分</span>
                    <el-button size="small" :icon="Edit" @click="editSingleMaterialChild(selectedMaterialChildIndex)">编辑</el-button>
                  </div>
                </div>
              </div>
            </div>
          </el-form-item>
          <el-form-item v-else label="参考答案">
            <div class="subjective-answer-editor">
              <el-alert
                v-if="singleForm.type === 'short_answer'"
                type="info"
                :closable="false"
                show-icon
                title="单问简答题只对应一个作答框；如果是 1、2、3 多个小问，请改为大题/组合题并按小题独立给分。"
              />
              <div v-if="singleForm.type === 'short_answer'" class="toolbar compact-toolbar">
                <el-button plain :icon="Plus" @click="convertShortAnswerToMaterial">
                  改为多问组合题
                </el-button>
              </div>
              <div v-if="isTextAnswerType(singleForm.type)" class="subjective-answer-settings">
                <span>学生作答框行数</span>
                <el-input-number v-model="singleForm.answerRows" :min="2" :max="24" :step="1" size="small" />
                <span class="mini-muted">用于考试/练习作答框高度；不影响评分。</span>
              </div>
              <el-input v-model="answerReference" type="textarea" :rows="referenceAnswerRows" resize="vertical" />
            </div>
          </el-form-item>
          <el-form-item label="解析">
            <el-input
              v-model="singleForm.analysis"
              type="textarea"
              :rows="3"
              resize="vertical"
              @focus="setImageInsertTarget(singleForm, 'analysis')"
              @paste="handleImagePaste($event, singleForm, 'analysis')"
            />
          </el-form-item>
          <el-form-item label="操作">
            <div class="toolbar">
              <el-button
                :icon="Refresh"
                :loading="singleDuplicateChecking"
                :disabled="Boolean(singlePreviewError)"
                @click="runSingleDuplicateCheck()"
              >
                重复检测
              </el-button>
              <el-button type="primary" :icon="Upload" :loading="singleSaving" @click="importSingle">导入单题</el-button>
              <el-button :icon="Refresh" @click="resetSingleForm">清空</el-button>
            </div>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <el-tab-pane label="批量导入" name="batch">
        <el-form label-width="88px">
          <el-form-item label="操作">
            <div class="toolbar">
              <el-button :icon="DocumentCopy" @click="loadBatchTemplate">加载模板</el-button>
              <el-dropdown trigger="click" @command="insertFormatSnippet">
                <el-button>插入格式</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="math-inline">行内数学公式</el-dropdown-item>
                    <el-dropdown-item command="math-block">数学公式块</el-dropdown-item>
                    <el-dropdown-item command="chem-inline">化学式</el-dropdown-item>
                    <el-dropdown-item command="chem-equation">化学方程式</el-dropdown-item>
                    <el-dropdown-item command="symbols">常用特殊符号</el-dropdown-item>
                    <el-dropdown-item command="table">Markdown 表格</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
              <el-button :icon="View" @click="previewBatch">解析预览</el-button>
              <el-button :icon="Refresh" :loading="duplicateChecking" :disabled="!batchPreview.length" @click="runDuplicateCheck()">
                重复检测
              </el-button>
              <el-button type="primary" :icon="Upload" :loading="importing" @click="importBatch">批量导入</el-button>
            </div>
          </el-form-item>

          <el-alert
            v-if="batchErrorSummary"
            :title="batchErrorSummary"
            type="error"
            show-icon
            :closable="false"
            class="batch-alert"
          />

          <el-form-item label="内容">
            <el-input
              v-model="batchText"
              type="textarea"
              :rows="18"
              resize="vertical"
              placeholder="按模板粘贴题目内容，支持 Markdown 代码块；多题之间用单独一行 --- 分隔"
              @input="handleBatchTemplateInput"
              @focus="setBatchInsertTarget('batchText')"
              @paste="handleBatchImagePaste($event, 'batchText')"
            />
          </el-form-item>
          <el-form-item label="答案">
            <el-input
              v-model="batchAnswerText"
              type="textarea"
              :rows="8"
              resize="vertical"
              placeholder="每行一个答案，例如：1. B；填空题：3. 第1空：print；第2空：range；第3空：len"
              @input="handleBatchTemplateInput"
            />
          </el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useQuestionImportPageContext } from '../composables/questionImportPageContext';
import MarkdownRenderer from '../../../components/MarkdownRenderer.vue';

export default defineComponent({
  components: { MarkdownRenderer },
  setup: useQuestionImportPageContext,
});
</script>
