<template>
  <div class="page import-page">
    <div class="page-head">
      <h1 class="page-title">题目导入</h1>
      <div class="toolbar">
        <el-button :icon="Back" @click="router.push('/questions')">返回题库</el-button>
        <el-upload
          :key="portableUploadKey"
          ref="portableUploadRef"
          accept=".zip,.json,.csv,.md,.txt"
          :auto-upload="false"
          :show-file-list="false"
          :on-change="handlePortableImportChange"
        >
          <el-button :icon="Upload">导入题目文件</el-button>
        </el-upload>
        <el-button :icon="Refresh" @click="loadBaseData">刷新基础数据</el-button>
      </div>
    </div>

    <section class="panel import-shared-panel">
      <el-form label-width="72px" class="import-shared-form">
        <el-form-item label="课程">
          <el-select v-model="sharedCourseId" filterable style="width: 100%" @change="handleSharedCourseChange">
            <el-option v-for="course in courses" :key="course.id" :label="course.name" :value="course.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="知识点">
          <el-tree-select
            v-model="sharedKnowledgePointIds"
            :data="knowledgeTreeOptions"
            multiple
            check-strictly
            collapse-tags
            collapse-tags-tooltip
            clearable
            filterable
            placeholder="可选择所属知识点"
            style="width: 100%"
            @change="refreshPreview"
          />
        </el-form-item>
        <el-form-item :label="importMode === 'batch' ? '批次标签' : '标签'">
          <el-select
            v-model="sharedTagNames"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="输入或选择标签"
            style="width: 100%"
            @change="refreshPreview"
          >
            <el-option v-for="tag in tags" :key="tag.id" :label="tag.name" :value="tag.name" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="importMode === 'batch' || singleForm.type === 'fill_blank'" label="填空规则" class="compact-form-item">
          <div class="inline-control">
            <el-checkbox v-model="blankCaseSensitive">区分大小写</el-checkbox>
            <el-checkbox v-model="blankSpaceSensitive">区分首尾空格</el-checkbox>
          </div>
        </el-form-item>
        <el-form-item label="发布" class="compact-form-item">
          <el-checkbox v-model="publishAfterImport">导入后立即发布</el-checkbox>
        </el-form-item>
        <el-form-item label="附件" class="compact-form-item">
          <div class="asset-toolbar">
            <el-upload
              :key="assetUploadKey"
              ref="assetUploadRef"
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.zip"
              multiple
              :auto-upload="false"
              :show-file-list="false"
              :on-change="handleAssetUploadChange"
            >
              <el-button :icon="Upload" :loading="uploadingAsset">上传附件</el-button>
            </el-upload>
            <el-button :type="uploadedAssets.length ? 'primary' : 'default'" plain @click="assetDrawerVisible = true">
              附件区（{{ uploadedAssets.length }}）
            </el-button>
          </div>
        </el-form-item>
      </el-form>
    </section>

    <div class="import-layout">
      <section class="panel import-editor">
        <el-tabs v-model="importMode" class="import-tabs" @tab-change="handleImportModeChange">
          <el-tab-pane label="单题导入" name="single">
            <el-form :model="singleForm" label-width="88px">
              <div class="single-meta-grid">
                <el-form-item label="题型">
                  <el-select v-model="singleForm.type" filterable style="width: 100%" @change="resetSingleOptions">
                    <el-option v-for="type in typeOptions" :key="type.value" :label="type.label" :value="type.value" />
                  </el-select>
                </el-form-item>
                <el-form-item label="标题">
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
              <template v-if="singleForm.type === 'programming'">
                <el-form-item label="Hydro题目">
                  <div class="hydro-inline-field">
                    <el-input v-model="singleForm.programmingRef.externalProblemId" placeholder="输入 Hydro 题号或题名，例如 P1000" />
                    <el-button :icon="Refresh" :loading="singleHydroPulling" :disabled="!canPullSingleHydroProblem" @click="pullSingleHydroProblem">
                      拉取
                    </el-button>
                    <el-button :icon="Link" :disabled="!singleHydroProblemUrl" @click="openSingleHydroProblem">打开</el-button>
                  </div>
                </el-form-item>
                <el-form-item label="Hydro链接">
                  <el-input v-model="singleForm.programmingRef.externalProblemUrl" placeholder="留空则按 Hydro 站点自动生成" />
                </el-form-item>
                <el-form-item label="Hydro站点">
                  <el-input v-model="singleForm.programmingRef.platformBaseUrl" placeholder="例如 https://oj.example.com" />
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
                      placeholder="选择用于拉取题目的外部账号"
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
              <el-form-item label="题干">
                <div style="width: 100%">
                  <div class="toolbar" style="margin-bottom: 8px">
                    <el-button size="small" :icon="DocumentAdd" @click="insertCodeBlock(singleForm, 'content')">
                      代码块
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
                    placeholder="支持 Markdown 和代码块"
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
                <el-input v-model="blankAnswers" placeholder="多个可接受答案用英文逗号分隔" />
              </el-form-item>
              <el-form-item v-else label="参考答案">
                <el-input v-model="answerReference" type="textarea" :rows="3" resize="vertical" />
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
                  placeholder="每行一个答案，例如：1. B 或 2. A,B；也支持 标题：答案"
                  @input="handleBatchTemplateInput"
                />
              </el-form-item>
            </el-form>
          </el-tab-pane>
        </el-tabs>
      </section>

      <section class="panel import-preview">
        <template v-if="importMode === 'single'">
          <div class="paper-preview-head">
            <div>
              <h2>单题预览</h2>
              <span class="muted">{{ typeLabel(singlePreviewQuestion.type) }} · {{ singlePreviewQuestion.defaultScore }} 分</span>
            </div>
            <div class="toolbar">
              <el-tag :type="singlePreviewError ? 'danger' : 'success'">
                {{ singlePreviewError ? '需修正' : '可导入' }}
              </el-tag>
              <el-tag v-if="singleConflictStatus && singleConflictStatus !== 'ok'" :type="conflictTagType(singleConflictStatus)" effect="plain">
                {{ conflictLabel(singleConflictStatus) }}
              </el-tag>
              <el-tag type="info">实时预览</el-tag>
            </div>
          </div>

          <el-alert
            v-if="singlePreviewError"
            :title="singlePreviewError"
            type="warning"
            show-icon
            :closable="false"
            class="batch-alert"
          />
          <el-alert
            v-else-if="singleConflictMessage"
            :title="singleConflictMessage"
            :type="singleConflictStatus === 'conflict' ? 'error' : 'warning'"
            show-icon
            :closable="false"
            class="batch-alert"
          />

          <div class="question-import-detail">
            <div class="paper-question-meta">
              <el-tag>{{ typeLabel(singlePreviewQuestion.type) }}</el-tag>
              <el-tag type="info">{{ singlePreviewQuestion.defaultScore }} 分</el-tag>
              <el-tag v-for="name in singlePreviewQuestion.knowledgePointNames || []" :key="name" type="success" effect="plain">
                {{ name }}
              </el-tag>
              <el-tag v-for="tag in singlePreviewQuestion.tagNames || []" :key="tag" effect="plain">{{ tag }}</el-tag>
            </div>
            <h3>{{ singlePreviewQuestion.title || '未命名题目' }}</h3>
            <MarkdownRenderer :source="singlePreviewQuestion.content || ''" />
            <div v-if="singlePreviewQuestion.options?.length" class="paper-option-list">
              <div
                v-for="option in singlePreviewQuestion.options"
                :key="option.optionKey"
                :class="['paper-option', option.isCorrect ? 'correct' : '']"
              >
                <strong>{{ option.optionKey }}.</strong>
                <MarkdownRenderer :source="option.content" />
                <span v-if="option.isCorrect" class="answer-mark success">正确答案</span>
              </div>
            </div>
            <div v-if="singlePreviewQuestion.analysis" class="paper-analysis">
              <strong>解析</strong>
              <MarkdownRenderer :source="singlePreviewQuestion.analysis" />
            </div>
          </div>
        </template>

        <template v-else>
          <div class="paper-preview-head">
            <div>
              <h2>解析结果</h2>
              <span class="muted">{{ importableBatchCount }} / {{ batchPreview.length }} 道可导入</span>
            </div>
            <div class="toolbar">
              <el-tag :type="batchErrorSummary ? 'danger' : 'success'">{{ batchErrorSummary ? '需修正' : '格式可用' }}</el-tag>
              <el-tag type="info">实时预览</el-tag>
            </div>
          </div>

          <el-table
            v-if="batchPreview.length"
            :data="batchPreview"
            height="280"
            highlight-current-row
            :row-class-name="batchRowClass"
            @current-change="selectPreview"
          >
            <el-table-column label="#" width="56">
              <template #default="{ row }">{{ row.number }}</template>
            </el-table-column>
            <el-table-column prop="title" label="标题" min-width="220" />
            <el-table-column label="题型" width="110">
              <template #default="{ row }">{{ typeLabel(row.type) }}</template>
            </el-table-column>
            <el-table-column label="标签" min-width="180">
              <template #default="{ row }">
                <el-tag v-for="tag in row.tagNames || []" :key="tag" size="small" effect="plain">{{ tag }}</el-tag>
                <span v-if="!(row.tagNames || []).length" class="muted">-</span>
              </template>
            </el-table-column>
            <el-table-column label="知识点" min-width="180">
              <template #default="{ row }">
                <el-tag v-for="name in row.knowledgePointNames || []" :key="name" size="small" type="success" effect="plain">
                  {{ name }}
                </el-tag>
                <span v-if="!(row.knowledgePointNames || []).length" class="muted">-</span>
              </template>
            </el-table-column>
            <el-table-column prop="answerText" label="答案" width="120" />
            <el-table-column label="状态" min-width="180">
              <template #default="{ row }">
                <el-tag :type="row.valid === false ? 'danger' : row.statusText?.includes('已导入') ? 'success' : 'info'">
                  {{ row.statusText }}
                </el-tag>
                <el-tag v-if="row.conflictStatus && row.conflictStatus !== 'ok'" :type="conflictTagType(row.conflictStatus)" effect="plain">
                  {{ conflictLabel(row.conflictStatus) }}
                </el-tag>
                <div v-if="row.conflictMessage" class="mini-muted">{{ row.conflictMessage }}</div>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="92" fixed="right">
              <template #default="{ row }">
                <el-button size="small" plain :icon="Delete" @click.stop="removeBatchPreviewRow(row)">移除</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-else description="粘贴题目内容后自动解析" />

          <div v-if="selectedBatchQuestion" class="question-import-detail">
            <div class="paper-question-meta">
              <el-tag>{{ typeLabel(selectedBatchQuestion.type) }}</el-tag>
              <el-tag type="info">{{ selectedBatchQuestion.defaultScore }} 分</el-tag>
              <el-tag v-for="name in selectedBatchQuestion.knowledgePointNames || []" :key="name" type="success" effect="plain">
                {{ name }}
              </el-tag>
              <el-tag v-for="tag in selectedBatchQuestion.tagNames || []" :key="tag" effect="plain">{{ tag }}</el-tag>
              <span
                v-if="!(selectedBatchQuestion.knowledgePointNames || []).length && !(selectedBatchQuestion.tagNames || []).length"
                class="muted"
              >
                无知识点/标签
              </span>
            </div>
            <h3>{{ selectedBatchQuestion.number }}. {{ selectedBatchQuestion.title }}</h3>
            <MarkdownRenderer :source="selectedBatchQuestion.content || ''" />
            <div v-if="selectedBatchQuestion.options?.length" class="paper-option-list">
              <div
                v-for="option in selectedBatchQuestion.options"
                :key="option.optionKey"
                :class="['paper-option', option.isCorrect ? 'correct' : '']"
              >
                <strong>{{ option.optionKey }}.</strong>
                <MarkdownRenderer :source="option.content" />
                <span v-if="option.isCorrect" class="answer-mark success">正确答案</span>
              </div>
            </div>
            <div v-if="selectedBatchQuestion.analysis" class="paper-analysis">
              <strong>解析</strong>
              <MarkdownRenderer :source="selectedBatchQuestion.analysis" />
            </div>
          </div>
        </template>
      </section>
    </div>

    <el-drawer v-model="assetDrawerVisible" title="题目附件" size="420px" class="asset-drawer">
      <div class="asset-drawer-body">
        <div class="asset-toolbar">
          <el-upload
            :key="assetUploadKey"
            ref="assetDrawerUploadRef"
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.zip"
            multiple
            :auto-upload="false"
            :show-file-list="false"
            :on-change="handleAssetUploadChange"
          >
            <el-button :icon="Upload" :loading="uploadingAsset">继续上传</el-button>
          </el-upload>
          <el-tag type="info">{{ uploadedAssets.length }} 个附件</el-tag>
          <el-button :icon="View" :loading="assetReportLoading" @click="loadQuestionAssetReport">资源检查</el-button>
        </div>

        <div v-if="uploadedAssets.length" class="uploaded-asset-list">
          <div v-for="asset in uploadedAssets" :key="asset.url" class="uploaded-asset-item">
            <div class="asset-preview">
              <img v-if="asset.isImage" :src="asset.url" :alt="asset.displayName" />
              <div v-else class="asset-file-icon">{{ fileExt(asset) }}</div>
            </div>
            <div class="asset-main">
              <el-input v-model="asset.displayName" size="small" placeholder="附件引用名" @blur="renameAsset(asset)" />
              <small>{{ asset.filename }} · {{ formatFileSize(asset.size) }}</small>
              <div v-if="asset.isImage" class="asset-layout-controls">
                <el-select v-model="asset.align" size="small" placeholder="对齐">
                  <el-option label="居中" value="center" />
                  <el-option label="左对齐" value="left" />
                  <el-option label="右对齐" value="right" />
                </el-select>
                <el-input-number v-model="asset.width" size="small" :min="20" :max="100" :step="5" controls-position="right" />
                <span class="mini-muted">%</span>
              </div>
            </div>
            <div class="asset-actions">
              <el-button size="small" @click="insertUploadedAsset(asset)">插入</el-button>
              <el-button size="small" plain :icon="Delete" @click="removeUploadedAsset(asset)" />
            </div>
          </div>
        </div>
        <el-empty v-else description="暂未上传附件" />

        <div class="asset-maintenance">
          <div class="asset-maintenance-head">
            <div>
              <strong>资源维护</strong>
              <p class="mini-muted">扫描题目、试卷快照和作答实例中的附件引用。</p>
            </div>
            <el-button
              size="small"
              type="danger"
              plain
              :disabled="!assetReport?.orphanCount"
              :loading="assetCleanupLoading"
              @click="cleanupQuestionAssetOrphans"
            >
              清理孤立附件
            </el-button>
          </div>
          <div v-if="assetReport" class="asset-stat-grid">
            <div>
              <b>{{ assetReport.total }}</b>
              <span>总附件</span>
            </div>
            <div>
              <b>{{ assetReport.referencedCount }}</b>
              <span>已引用</span>
            </div>
            <div>
              <b>{{ assetReport.orphanCount }}</b>
              <span>孤立</span>
            </div>
          </div>
          <div v-if="assetReportPreview.length" class="asset-report-list">
            <div v-for="asset in assetReportPreview" :key="asset.url" class="asset-report-item">
              <span class="asset-report-name">{{ asset.displayName || asset.filename }}</span>
              <el-tag size="small" :type="asset.referenced ? 'success' : 'warning'">
                {{ asset.referenced ? `${asset.referenceCount || 0} 处引用` : '孤立' }}
              </el-tag>
              <small>{{ formatAssetKind(asset.kind) }} · {{ formatFileSize(asset.size) }}</small>
              <small v-if="asset.locations?.length" class="asset-reference-locations">
                {{ asset.locations.slice(0, 3).join('；') }}
              </small>
            </div>
          </div>
          <el-empty v-else-if="assetReport" description="没有题目附件" />
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Back, Delete, DocumentAdd, DocumentCopy, Link, Plus, Refresh, Upload, View } from '@element-plus/icons-vue';
import { api, buildQuery } from '../api';
import MarkdownRenderer from '../components/MarkdownRenderer.vue';

const router = useRouter();
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

const formatSnippets = {
  'math-inline': '$a^2 + b^2 = c^2$',
  'math-block': ['$$', 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}', '$$'].join('\n'),
  'chem-inline': '@chem{H2SO4}',
  'chem-equation': '@chem{2H2 + O2 -> 2H2O}',
  symbols: '≤ ≥ ≠ ≈ ± × ÷ √ ∑ ∞ ° ℃ → ← ↔ ∴ ∵ α β γ Δ Ω',
  table: ['| 项目 | 内容 |', '| --- | --- |', '| 条件 | $x > 0$ |', '| 结论 | @chem{CO2} |'].join('\n'),
};

const courses = ref([]);
const tags = ref([]);
const knowledgeTree = ref([]);
const importMode = ref('single');
const sharedCourseId = ref('');
const sharedKnowledgePointIds = ref([]);
const sharedTagNames = ref([]);
const publishAfterImport = ref(true);
const singleForm = reactive(baseSingleForm());
const blankAnswers = ref('print');
const blankCaseSensitive = ref(false);
const blankSpaceSensitive = ref(false);
const answerReference = ref('');
const singleSaving = ref(false);
const singleHydroPulling = ref(false);
const singleDuplicateChecking = ref(false);
const singleConflictResult = ref(null);
let singleDuplicateTimer = null;
let lastSingleDuplicateKey = '';
const batchText = ref('');
const batchAnswerText = ref('');
const batchPreview = ref([]);
const batchErrorSummary = ref('');
const structuredBatchQuestions = ref([]);
const removedBatchRowKeys = ref(new Set());
const selectedPreviewIndex = ref(0);
const importing = ref(false);
const duplicateChecking = ref(false);
const uploadedAssets = ref([]);
const uploadingAsset = ref(false);
const assetDrawerVisible = ref(false);
const assetInsertTarget = ref(null);
const hydroAccounts = ref([]);
const portableUploadRef = ref(null);
const portableUploadKey = ref(0);
const assetUploadRef = ref(null);
const assetDrawerUploadRef = ref(null);
const assetUploadKey = ref(0);
const assetReport = ref(null);
const assetReportLoading = ref(false);
const assetCleanupLoading = ref(false);

const knowledgeTreeOptions = computed(() => convertKnowledgeTree(knowledgeTree.value));
const selectedKnowledgeNames = computed(() => {
  const map = new Map(flattenKnowledgeTree(knowledgeTree.value).map((item) => [item.id, item.name]));
  return sharedKnowledgePointIds.value.map((id) => map.get(id)).filter(isMeaningfulName);
});
const isSingleChoice = computed(() => isChoiceType(singleForm.type));
const validCount = computed(() => batchPreview.value.filter((row) => row.valid !== false).length);
const importableBatchCount = computed(
  () => batchPreview.value.filter((row) => row.valid !== false && !shouldSkipBatchRow(row)).length,
);
const selectedBatchQuestion = computed(() => batchPreview.value[selectedPreviewIndex.value] ?? batchPreview.value[0]);
const singlePreviewQuestion = computed(() => buildSinglePreview());
const singleHydroProblemUrl = computed(() => {
  const explicit = singleForm.programmingRef.externalProblemUrl?.trim();
  const problemId = singleForm.programmingRef.externalProblemId?.trim();
  if (explicit) return explicit;
  const baseUrl = normalizeBaseUrl(singleForm.programmingRef.platformBaseUrl || 'https://oj.example.com');
  const domainId = singleForm.programmingRef.domainId?.trim();
  const domainPrefix = domainId && domainId !== 'system' ? `/d/${encodeURIComponent(domainId)}` : '';
  return problemId ? `${baseUrl}${domainPrefix}/p/${encodeURIComponent(problemId)}` : '';
});
const hydroAccountOptions = computed(() =>
  hydroAccounts.value.map((account) => ({
    ...account,
    label: `${account.loginUsername || account.hydroUsername} · ${account.platformName || 'Hydro'} · ${shortHost(account.platformBaseUrl)} · ${account.ownerName || account.ownerUsername || account.studentName || '账号'}`,
  })),
);
const selectedSingleHydroAccount = computed(() =>
  hydroAccounts.value.find((account) => account.id === singleForm.programmingRef.accountId) ?? null,
);
const singleHydroBindingLabel = computed(() => {
  const parts = [
    singleForm.programmingRef.platformBaseUrl,
    `域 ${formatHydroDomainLabel(singleForm.programmingRef)}`,
    singleForm.programmingRef.accountLabel || selectedSingleHydroAccount.value?.loginUsername,
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
const canPullSingleHydroProblem = computed(() =>
  Boolean(singleForm.programmingRef.externalProblemId?.trim() || singleForm.programmingRef.externalProblemUrl?.trim()),
);
const singlePreviewError = computed(() => {
  try {
    validatePayload(singlePreviewQuestion.value, '当前题目');
    return '';
  } catch (error) {
    return error.message;
  }
});
const singleConflictStatus = computed(() => singleConflictResult.value?.status ?? '');
const singleConflictMessage = computed(() => {
  const result = singleConflictResult.value;
  if (!result || result.status === 'ok') return '';
  const prefix = result.status === 'conflict' ? '检测到冲突' : result.status === 'duplicate' ? '检测到重复' : '检测到相似题';
  return `${prefix}：${result.message}`;
});
const assetReportPreview = computed(() => (assetReport.value?.items ?? []).slice(0, 10));
const correctChoiceKey = computed({
  get() {
    return singleForm.options.find((option) => option.isCorrect)?.optionKey ?? '';
  },
  set(value) {
    singleForm.options.forEach((option) => {
      option.isCorrect = option.optionKey === value;
    });
  },
});

function baseSingleForm() {
  return {
    type: 'single_choice',
    title: '',
    content: '',
    difficulty: 1,
    defaultScore: 2,
    analysis: '',
    programmingRef: emptyProgrammingRef(),
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
    accountId: '',
    accountLabel: '',
    languagesText: 'cc.cc17o2, py.py3',
    timeLimit: null,
    memoryLimit: null,
    judgeConfig: null,
  };
}

async function loadBaseData() {
  const [coursePage, tagPage] = await Promise.all([
    api('/courses?pageSize=100'),
    api('/tags?pageSize=100&type=QUESTION'),
  ]);
  courses.value = coursePage.items;
  tags.value = tagPage.items;
  sharedCourseId.value = sharedCourseId.value || courses.value[0]?.id || '';
  await loadKnowledgeTree();
  await loadHydroAccounts();
  refreshPreview();
}

async function loadHydroAccounts() {
  try {
    const data = await api('/hydro/accounts?pageSize=100&platformCode=hydro');
    hydroAccounts.value = data.items ?? [];
  } catch {
    hydroAccounts.value = [];
  }
}

function handleSingleHydroAccountChange(accountId) {
  const account = hydroAccounts.value.find((item) => item.id === accountId);
  if (!account) {
    singleForm.programmingRef.accountLabel = '';
    return;
  }
  singleForm.programmingRef.platformBaseUrl = account.platformBaseUrl || singleForm.programmingRef.platformBaseUrl;
  singleForm.programmingRef.accountLabel = `${account.loginUsername || account.hydroUsername}@${shortHost(account.platformBaseUrl)}`;
}

async function handleSharedCourseChange() {
  sharedKnowledgePointIds.value = [];
  await loadKnowledgeTree();
  refreshPreview();
}

async function loadKnowledgeTree() {
  knowledgeTree.value = sharedCourseId.value ? await api(`/knowledge-points/tree?courseId=${sharedCourseId.value}`) : [];
}

function buildSinglePreview() {
  const options = isChoiceType(singleForm.type)
    ? singleForm.options.map((option, index) => ({
        optionKey: option.optionKey,
        content: option.content,
        isCorrect: Boolean(option.isCorrect),
        sortOrder: index + 1,
      }))
    : [];

  const payload = {
    valid: true,
    number: 1,
    courseId: sharedCourseId.value,
    knowledgePointIds: [...sharedKnowledgePointIds.value],
    knowledgePointNames: [...selectedKnowledgeNames.value],
    type: singleForm.type,
    title: singleForm.title,
    tagNames: [...sharedTagNames.value],
    content: singleForm.content,
    difficulty: Number(singleForm.difficulty),
    defaultScore: Number(singleForm.defaultScore),
    analysis: singleForm.analysis,
    options,
    answerText: getSingleAnswerText(),
    statusText: '待导入',
  };

  if (singleForm.type === 'programming') {
    payload.programmingRef = buildSingleProgrammingRefPayload();
  }

  if (singleForm.type === 'fill_blank') {
    payload.answer = buildBlankAnswer(blankAnswers.value, payload.defaultScore);
  } else if (!isChoiceType(singleForm.type) && answerReference.value.trim()) {
    payload.answer = { reference: answerReference.value.trim() };
  }

  return payload;
}

async function importSingle() {
  singleSaving.value = true;
  try {
    const { tagNames, knowledgePointNames, answerText, number, statusText, valid, ...payload } = buildSinglePreview();
    validatePayload(payload, '当前题目');
    const duplicateResult = await runSingleDuplicateCheck({ silent: true });
    if (duplicateResult && duplicateResult.status !== 'ok') {
      const title = duplicateResult.status === 'conflict' ? '检测到题目冲突' : '检测到相似或重复题目';
      try {
        await ElMessageBox.confirm(`${singleConflictMessage.value || duplicateResult.message}，仍然导入吗？`, title, {
          type: duplicateResult.status === 'conflict' ? 'error' : 'warning',
          confirmButtonText: '仍然导入',
          cancelButtonText: '取消',
        });
      } catch {
        return;
      }
    }
    payload.tagIds = await resolveTagIds(tagNames);
    const created = await api('/questions', { method: 'POST', body: payload });
    if (publishAfterImport.value) {
      await api(`/questions/${created.id}/publish`, { method: 'POST' });
    }
    ElMessage.success(publishAfterImport.value ? '单题已导入并发布' : '单题已导入');
  } catch (error) {
    ElMessage.error(error.message);
  } finally {
    singleSaving.value = false;
  }
}

async function runSingleDuplicateCheck(options = {}) {
  if (singlePreviewError.value) {
    if (!options.silent) ElMessage.error(singlePreviewError.value);
    return null;
  }

  const payload = buildDuplicateCheckPayload(singlePreviewQuestion.value);
  const currentKey = JSON.stringify(payload);
  if (options.silent && currentKey === lastSingleDuplicateKey && singleConflictResult.value) {
    return singleConflictResult.value;
  }

  singleDuplicateChecking.value = true;
  try {
    const result = await api('/questions/duplicate-check', {
      method: 'POST',
      body: { questions: [payload] },
    });
    const item = result.items?.[0] ?? { status: 'ok', message: '未发现重复或冲突', matches: [] };
    singleConflictResult.value = item;
    lastSingleDuplicateKey = currentKey;
    if (!options.silent) {
      if (item.status === 'ok') {
        ElMessage.success('未发现重复或冲突');
      } else {
        ElMessage.warning(`${conflictLabel(item.status)}：${item.message}`);
      }
    }
    return item;
  } catch (error) {
    if (!options.silent) {
      ElMessage.error(error.message || '重复检测失败');
    }
    return null;
  } finally {
    singleDuplicateChecking.value = false;
  }
}

function scheduleSingleDuplicateCheck() {
  if (singleDuplicateTimer) {
    clearTimeout(singleDuplicateTimer);
    singleDuplicateTimer = null;
  }
  singleConflictResult.value = null;
  lastSingleDuplicateKey = '';
  if (importMode.value !== 'single' || singlePreviewError.value) return;
  singleDuplicateTimer = setTimeout(() => {
    runSingleDuplicateCheck({ silent: true });
  }, 600);
}

function resetSingleOptions() {
  if (singleForm.type === 'true_false') {
    singleForm.options = [
      { optionKey: 'A', content: '正确', isCorrect: true, sortOrder: 1 },
      { optionKey: 'B', content: '错误', isCorrect: false, sortOrder: 2 },
    ];
    return;
  }

  if (isChoiceType(singleForm.type)) {
    singleForm.options = baseSingleForm().options.map((option) => ({ ...option }));
    return;
  }

  singleForm.options = [];
}

function addSingleOption() {
  singleForm.options.push({
    optionKey: optionKeyForIndex(singleForm.options.length),
    content: '',
    isCorrect: false,
    sortOrder: singleForm.options.length + 1,
  });
}

function removeSingleOption(index) {
  singleForm.options.splice(index, 1);
  renumberSingleOptions();
  if ((singleForm.type === 'single_choice' || singleForm.type === 'true_false') && !singleForm.options.some((option) => option.isCorrect)) {
    singleForm.options[0].isCorrect = true;
  }
}

function renumberSingleOptions() {
  singleForm.options.forEach((option, index) => {
    option.optionKey = optionKeyForIndex(index);
    option.sortOrder = index + 1;
  });
}

function resetSingleForm() {
  Object.assign(singleForm, baseSingleForm());
  blankAnswers.value = 'print';
  blankCaseSensitive.value = false;
  blankSpaceSensitive.value = false;
  answerReference.value = '';
  setImageInsertTarget(singleForm, 'content');
}

function loadSingleTemplate() {
  Object.assign(singleForm, {
    type: 'single_choice',
    title: '单题示例：Markdown 公式与代码',
    content: [
      '阅读代码，输出结果是什么？题干可包含数学公式 $a^2 + b^2 = c^2$、化学式 @chem{H2SO4}。',
      '',
      '$$',
      'S = \\pi\\,r^2',
      '$$',
      '',
      '```python',
      'print(2 + 5)',
      '```',
    ].join('\n'),
    difficulty: 1,
    defaultScore: 2,
    analysis: '`2 + 5` 的结果是 `7`。化学方程式示例：@chem{2H2 + O2 -> 2H2O}。',
    options: [
      { optionKey: 'A', content: '`5`', isCorrect: false, sortOrder: 1 },
      { optionKey: 'B', content: '`7`', isCorrect: true, sortOrder: 2 },
      { optionKey: 'C', content: '`25`', isCorrect: false, sortOrder: 3 },
      { optionKey: 'D', content: '`None`', isCorrect: false, sortOrder: 4 },
    ],
  });
}

function refreshPreview() {
  if (importMode.value !== 'batch') return;

  try {
    if (structuredBatchQuestions.value.length) {
      const rows = structuredBatchQuestions.value.map((question, index) => withBatchRowKey(buildPortablePreviewRow(question, index)));
      batchPreview.value = filterRemovedBatchRows(rows);
      batchErrorSummary.value = rows.some((row) => row.valid === false) ? formatBatchErrors(
        rows
          .filter((row) => row.valid === false)
          .map((row) => ({ number: row.number, title: row.title, message: row.errorMessage })),
      ) : '';
      if (selectedPreviewIndex.value >= batchPreview.value.length) {
        selectedPreviewIndex.value = 0;
      }
      return;
    }

    const result = parseBatchResult(batchText.value, batchAnswerText.value);
    batchPreview.value = filterRemovedBatchRows(
      result.rows.map((row) =>
        withBatchRowKey({
          ...row,
          knowledgePointIds: mergeIds(sharedKnowledgePointIds.value, row.knowledgePointIds),
          knowledgePointNames: mergeTags(selectedKnowledgeNames.value, row.knowledgePointNames),
          tagNames: mergeTags(sharedTagNames.value, row.tagNames),
        }),
      ),
    );
    batchErrorSummary.value = result.errors.length ? formatBatchErrors(result.errors) : '';
    if (selectedPreviewIndex.value >= batchPreview.value.length) {
      selectedPreviewIndex.value = 0;
    }
  } catch (error) {
    batchPreview.value = [];
    batchErrorSummary.value = batchText.value.trim() ? error.message : '';
  }
}

function handleBatchTemplateInput() {
  structuredBatchQuestions.value = [];
  removedBatchRowKeys.value = new Set();
  refreshPreview();
}

function handleImportModeChange() {
  if (importMode.value === 'batch') {
    setBatchInsertTarget('batchText');
  } else {
    setImageInsertTarget(singleForm, 'content');
  }
  refreshPreview();
}

async function previewBatch() {
  refreshPreview();
  if (batchErrorSummary.value) {
    ElMessage.error('存在格式问题，请查看解析结果');
  } else {
    await runDuplicateCheck({ silent: true });
    ElMessage.success(`解析到 ${batchPreview.value.length} 道题`);
  }
}

async function importBatch() {
  importMode.value = 'batch';
  refreshPreview();
  if (!batchPreview.value.length) {
    ElMessage.error('请先粘贴题目内容');
    return;
  }
  if (batchPreview.value.some((row) => row.valid === false)) {
    ElMessage.error('批量录入格式未通过，请先修正错误');
    return;
  }
  await runDuplicateCheck({ silent: true });
  const skippedRows = batchPreview.value.filter(shouldSkipBatchRow);
  const importRows = batchPreview.value.filter((row) => row.valid !== false && !shouldSkipBatchRow(row));
  if (skippedRows.length) {
    skippedRows.forEach((row) => {
      row.statusText = row.conflictStatus === 'conflict' ? '已跳过：题目冲突' : '已跳过：重复题目';
    });
    ElMessage.warning(`已跳过 ${skippedRows.length} 道重复/冲突题，其余题目继续导入`);
  } else if (batchPreview.value.some((row) => row.conflictStatus === 'similar')) {
    ElMessage.warning('检测到相似题目，已在解析结果中标注；相似题默认继续导入');
  }
  if (!importRows.length) {
    ElMessage.warning('没有可导入题目，请移除重复/冲突项或修改内容后重试');
    return;
  }

  importing.value = true;
  let successCount = 0;
  try {
    for (const question of importRows) {
      const index = batchPreview.value.indexOf(question);
      const {
        answerText,
        number,
        statusText,
        valid,
        tagNames,
        knowledgePointNames,
        conflictStatus,
        conflictMessage,
        conflictMatches,
        batchKey,
        ...payload
      } = question;
      try {
        payload.tagIds = await resolveTagIds(tagNames);
        const created = await api('/questions', { method: 'POST', body: payload });
        if (publishAfterImport.value) {
          await api(`/questions/${created.id}/publish`, { method: 'POST' });
        }
        if (index >= 0) batchPreview.value[index].statusText = publishAfterImport.value ? '已导入并发布' : '已导入';
        successCount += 1;
      } catch (error) {
        if (index >= 0) {
          batchPreview.value[index].valid = false;
          batchPreview.value[index].statusText = error.message;
        }
      }
    }
  } finally {
    importing.value = false;
  }

  ElMessage.success(`成功导入 ${successCount} / ${importRows.length} 道题，跳过 ${skippedRows.length} 道重复/冲突题`);
}

async function runDuplicateCheck(options = {}) {
  if (!batchPreview.value.length || batchPreview.value.some((row) => row.valid === false)) return null;
  duplicateChecking.value = true;
  try {
    const payloads = batchPreview.value.map((row) => buildDuplicateCheckPayload(row));
    const result = await api('/questions/duplicate-check', {
      method: 'POST',
      body: { questions: payloads },
    });
    for (const item of result.items ?? []) {
      const row = batchPreview.value[item.index];
      if (!row) continue;
      row.conflictStatus = item.status;
      row.conflictMessage = item.status === 'ok' ? '' : item.message;
      row.conflictMatches = item.matches ?? [];
    }
    const conflictCount = result.conflictCount ?? 0;
    const warningCount = (result.duplicateCount ?? 0) + (result.similarCount ?? 0);
    if (!options.silent) {
      if (conflictCount) {
        ElMessage.warning(`发现 ${conflictCount} 道冲突题，请检查后再导入`);
      } else if (warningCount) {
        ElMessage.warning(`发现 ${warningCount} 道重复或相似题`);
      } else {
        ElMessage.success('未发现重复或冲突');
      }
    }
    return result;
  } catch (error) {
    if (!options.silent) {
      ElMessage.error(error.message || '重复检测失败');
    }
    return null;
  } finally {
    duplicateChecking.value = false;
  }
}

function buildDuplicateCheckPayload(row) {
  return {
    courseId: row.courseId,
    type: row.type,
    title: row.title,
    content: row.content,
    difficulty: row.difficulty,
    defaultScore: row.defaultScore,
    analysis: row.analysis,
    allowOptionShuffle: row.allowOptionShuffle,
    knowledgePointIds: row.knowledgePointIds ?? [],
    options: row.options ?? [],
    answer: row.answer,
    scoringRule: row.scoringRule,
  };
}

function shouldSkipBatchRow(row) {
  return ['duplicate', 'conflict'].includes(row.conflictStatus);
}

function makeBatchRowKey(row) {
  return [
    String(row.number || '').trim(),
    String(row.title || '').trim(),
    String(row.type || '').trim(),
    String(row.content || '').trim(),
    JSON.stringify(row.options ?? []),
    JSON.stringify(row.answer ?? null),
  ].join('|');
}

function withBatchRowKey(row) {
  return {
    ...row,
    batchKey: row.batchKey || makeBatchRowKey(row),
  };
}

function filterRemovedBatchRows(rows) {
  const removed = removedBatchRowKeys.value;
  return rows.filter((row) => !removed.has(row.batchKey || makeBatchRowKey(row)));
}

function removeBatchPreviewRow(row) {
  const key = row.batchKey || makeBatchRowKey(row);
  removedBatchRowKeys.value = new Set([...removedBatchRowKeys.value, key]);
  batchPreview.value = batchPreview.value.filter((item) => item !== row);
  if (selectedPreviewIndex.value >= batchPreview.value.length) {
    selectedPreviewIndex.value = Math.max(0, batchPreview.value.length - 1);
  }
  ElMessage.success('已从本次导入预览中移除');
}

function conflictLabel(status) {
  const labels = { conflict: '冲突', duplicate: '重复', similar: '相似' };
  return labels[status] || status;
}

function conflictTagType(status) {
  if (status === 'conflict') return 'danger';
  if (status === 'duplicate') return 'warning';
  return 'info';
}

function selectPreview(row) {
  const index = batchPreview.value.indexOf(row);
  if (index >= 0) selectedPreviewIndex.value = index;
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

function splitQuestionBlocks(text) {
  const blocks = [];
  let current = [];
  let inCode = false;
  let inMath = false;

  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const fenceCount = (line.match(/```/g) ?? []).length;
    const trimmed = line.trim();
    if (!inCode && (trimmed === '$$' || trimmed === '\\[' || trimmed === '\\]')) {
      inMath = !inMath;
    }
    if (!inCode && !inMath && trimmed === '---') {
      const block = current.join('\n').trim();
      if (block) blocks.push(block);
      current = [];
      continue;
    }
    current.push(line);
    if (fenceCount % 2 === 1) inCode = !inCode;
  }

  const last = current.join('\n').trim();
  if (last) blocks.push(last);
  return blocks;
}

function parseBatchResult(text, answerText = '') {
  const blocks = splitQuestionBlocks(text);
  if (!blocks.length) throw new Error('请先粘贴题目模板内容');
  const answerConfig = parseAnswerConfig(answerText);
  const rows = blocks.map((block, index) => {
    const number = index + 1;
    try {
      return parseQuestionBlock(block, number, answerConfig);
    } catch (error) {
      return {
        valid: false,
        number,
        title: extractField(block, '标题') || `第 ${number} 题`,
        type: normalizeType(extractField(block, '题型') || ''),
        defaultScore: extractField(block, '分值') || '',
        answerText: '',
        tagNames: parseTagNames(extractField(block, '标签')),
        statusText: `格式错误：${error.message}`,
        errorMessage: error.message,
      };
    }
  });

  return {
    rows,
    errors: rows
      .filter((row) => row.valid === false)
      .map((row) => ({ number: row.number, title: row.title, message: row.errorMessage })),
  };
}

function parseAnswerConfig(text) {
  const byIndex = new Map();
  const byTitle = new Map();

  for (const rawLine of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const indexMatch = line.match(/^(\d+)[\.\、:：]\s*(.+)$/);
    if (indexMatch) {
      byIndex.set(Number(indexMatch[1]), indexMatch[2].trim());
      continue;
    }

    const titleMatch = line.match(/^(.+?)[:：]\s*(.+)$/);
    if (titleMatch) {
      byTitle.set(titleMatch[1].trim(), titleMatch[2].trim());
    }
  }

  return { byIndex, byTitle };
}

function parseQuestionBlock(block, number, answerConfig) {
  const fields = {};
  const sections = { content: [], options: [], analysis: [] };
  const fieldMap = {
    标题: 'title',
    题型: 'type',
    难度: 'difficulty',
    分值: 'defaultScore',
    标签: 'tags',
    知识点: 'knowledgePoints',
    答案: 'answer',
    hydro题目: 'hydroProblem',
    hydro题号: 'hydroProblem',
    hydroproblem: 'hydroProblem',
    hydroproblemid: 'hydroProblem',
    hydroproblemname: 'hydroProblem',
    externalproblemid: 'hydroProblem',
    hydro链接: 'hydroUrl',
    hydro地址: 'hydroUrl',
    hydroproblemurl: 'hydroUrl',
    externalproblemurl: 'hydroUrl',
    hydro语言: 'hydroLanguages',
    hydrolanguages: 'hydroLanguages',
  };
  const sectionMap = { 题干: 'content', 选项: 'options', 解析: 'analysis' };
  let currentSection = '';

  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    const fieldMatch = trimmed.match(/^(标题|题型|难度|分值|标签|知识点|答案|Hydro\s*题目|Hydro\s*题号|hydroProblem|hydroProblemId|hydroProblemName|externalProblemId|Hydro\s*链接|Hydro\s*地址|hydroProblemUrl|externalProblemUrl|Hydro\s*语言|hydroLanguages)[:：]\s*(.*)$/i);
    if (!currentSection && fieldMatch) {
      const fieldKey = fieldMatch[1].replace(/\s+/g, '').toLowerCase();
      fields[fieldMap[fieldKey] ?? fieldMap[fieldMatch[1]]] = fieldMatch[2].trim();
      continue;
    }

    const sectionMatch = trimmed.match(/^(题干|选项|解析)[:：]\s*(.*)$/);
    if (sectionMatch) {
      currentSection = sectionMap[sectionMatch[1]];
      if (sectionMatch[2]) sections[currentSection].push(sectionMatch[2]);
      continue;
    }

    if (currentSection) {
      sections[currentSection].push(line);
    }
  }

  const type = normalizeType(fields.type || '单选题');
  const defaultScore = Number(fields.defaultScore || 2);
  const difficulty = Number(fields.difficulty || 1);
  const title = fields.title || `未命名题目 ${number}`;
  const answerText = answerConfig.byIndex.get(number) ?? answerConfig.byTitle.get(title) ?? fields.answer ?? '';
  const answerKeys = parseAnswerKeys(answerText);
  const knowledgePointNames = parseTagNames(fields.knowledgePoints);
  const payload = {
    valid: true,
    number,
    courseId: sharedCourseId.value,
    knowledgePointIds: resolveKnowledgePointIdsByName(knowledgePointNames),
    knowledgePointNames,
    type,
    title,
    tagNames: parseTagNames(fields.tags),
    content: sections.content.join('\n').trim(),
    difficulty: Number.isFinite(difficulty) ? difficulty : 1,
    defaultScore: Number.isFinite(defaultScore) ? defaultScore : 2,
    analysis: sections.analysis.join('\n').trim(),
    options: [],
  };

  if (isChoiceType(type)) {
    payload.options = parseOptions(sections.options.join('\n'), answerKeys, type);
  }

  if (type === 'programming') {
    payload.programmingRef = buildProgrammingRefFromValues({
      externalProblemId: fields.hydroProblem,
      externalProblemUrl: fields.hydroUrl,
      languagesText: fields.hydroLanguages,
    });
  }

  if (type === 'fill_blank') {
    payload.answer = buildBlankAnswer(answerText, payload.defaultScore);
  } else if (!isChoiceType(type) && answerText) {
    payload.answer = { reference: answerText };
  }

  validatePayload(payload, `第 ${number} 题`);
  return {
    ...payload,
    answerText: answerText || payload.options.filter((option) => option.isCorrect).map((option) => option.optionKey).join(','),
    statusText: '待导入',
  };
}

function parseOptions(text, answerKeys, type) {
  if (type === 'true_false' && !text.trim()) {
    const truthy = answerKeys.includes('A') || answerKeys.includes('正确') || answerKeys.includes('TRUE');
    return [
      { optionKey: 'A', content: '正确', isCorrect: truthy || !answerKeys.length, sortOrder: 1 },
      { optionKey: 'B', content: '错误', isCorrect: !truthy && answerKeys.length > 0, sortOrder: 2 },
    ];
  }

  const options = [];
  let current = null;
  let inCode = false;

  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const match = !inCode ? line.match(/^\s*([A-Z])[\.\、:：]\s*(.*)$/i) : null;
    if (match) {
      if (current) options.push(current);
      current = { optionKey: match[1].toUpperCase(), contentLines: [match[2]] };
    } else if (current) {
      current.contentLines.push(line);
    }

    const fenceCount = (line.match(/```/g) ?? []).length;
    if (fenceCount % 2 === 1) inCode = !inCode;
  }
  if (current) options.push(current);

  return options.map((option, index) => ({
    optionKey: option.optionKey || optionKeyForIndex(index),
    content: option.contentLines.join('\n').trim(),
    isCorrect: answerKeys.includes(option.optionKey),
    sortOrder: index + 1,
  }));
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
}

function loadBatchTemplate() {
  structuredBatchQuestions.value = [];
  removedBatchRowKeys.value = new Set();
  batchText.value = [
    '标题：批量示例：Python 输出',
    '题型：单选题',
    '难度：1',
    '分值：2',
    '标签：Python,代码阅读',
    '知识点：变量与表达式',
    '题干：',
    '阅读代码，输出结果是什么？题干可包含数学公式 $a^2 + b^2 = c^2$ 和化学式 @chem{CO2}。',
    '',
    '$$',
    'f(x)=x^2+2x+1',
    '$$',
    '',
    '```python',
    'print(1 + 2)',
    '```',
    '选项：',
    'A. `1`',
    'B. `3`',
    'C. `12`',
    'D. `None`',
    '解析：',
    '表达式 `1 + 2` 的结果是 `3`。常用特殊符号：≤ ≥ ≠ ± × ÷ √ ∑ ∞。',
    '---',
    '标题：批量示例：可变容器',
    '题型：多选题',
    '难度：2',
    '分值：4',
    '标签：Python,数据结构',
    '知识点：列表,字典',
    '题干：',
    'Python 中哪些是常见可变容器？',
    '选项：',
    'A. list',
    'B. dict',
    'C. int',
    'D. str',
    'E. set',
    '解析：',
    '`list`、`dict` 和 `set` 可以原地修改。',
  ].join('\n');
  batchAnswerText.value = ['1. B', '2. A,B,E'].join('\n');
  refreshPreview();
}

function insertCodeBlock(target, field) {
  target[field] = `${target[field] || ''}\n\`\`\`python\nprint("hello")\n\`\`\`\n`;
  setImageInsertTarget(target, field);
}

function insertFormatSnippet(command) {
  const snippet = formatSnippets[command];
  if (!snippet) return;
  insertMarkdownSnippet(snippet);
}

function insertMarkdownSnippet(markdown) {
  if (!assetInsertTarget.value) {
    if (importMode.value === 'batch') {
      setBatchInsertTarget('batchText');
    } else {
      setImageInsertTarget(singleForm, 'content');
    }
  }

  if (assetInsertTarget.value?.type === 'object') {
    appendMarkdownToObject(assetInsertTarget.value.target, assetInsertTarget.value.field, markdown);
  } else if (assetInsertTarget.value?.field === 'batchAnswerText') {
    batchAnswerText.value = appendMarkdownText(batchAnswerText.value, markdown);
  } else if (assetInsertTarget.value?.field === 'singleContent') {
    singleForm.content = appendMarkdownText(singleForm.content, markdown);
  } else {
    batchText.value = appendMarkdownText(batchText.value, markdown);
  }

  refreshPreview();
}

function setImageInsertTarget(target, field) {
  assetInsertTarget.value = { type: 'object', target, field };
}

function setBatchInsertTarget(field) {
  assetInsertTarget.value = { type: 'batch', field };
}

async function handleAssetUploadChange(uploadFile) {
  const file = uploadFile?.raw;
  if (!file) return;
  try {
    await uploadAssetFile(file);
    assetDrawerVisible.value = true;
  } finally {
    assetUploadRef.value?.clearFiles?.();
    assetDrawerUploadRef.value?.clearFiles?.();
    assetUploadKey.value += 1;
  }
}

async function handlePortableImportChange(uploadFile) {
  const file = uploadFile?.raw;
  if (!file) return;

  try {
    const name = String(file.name || '').toLowerCase();
    if (name.endsWith('.zip')) {
      await loadQuestionZipPackage(file);
    } else if (name.endsWith('.json')) {
      const rows = portableQuestionsFromJson(JSON.parse(await file.text()));
      applyPortableQuestions(rows, 'JSON');
    } else if (name.endsWith('.csv')) {
      const rows = parseCsvRows(await file.text());
      ensurePortableCsvRows(rows);
      const questions = rows.map(normalizePortableQuestion);
      applyPortableQuestions(questions, 'CSV');
    } else {
      structuredBatchQuestions.value = [];
      removedBatchRowKeys.value = new Set();
      batchText.value = await file.text();
      batchAnswerText.value = '';
      importMode.value = 'batch';
      refreshPreview();
      ElMessage.success('已载入模板文本，请检查解析结果');
    }
  } catch (error) {
    ElMessage.error(error.message || '题目文件导入失败');
  } finally {
    portableUploadRef.value?.clearFiles?.();
    portableUploadKey.value += 1;
  }
}

async function loadQuestionZipPackage(file) {
  const entries = parseStoredZip(await file.arrayBuffer());
  const assetUrlMap = await uploadZipAssets(entries);
  const templateEntry = entries.get('questions-template.md');
  const answerEntry = entries.get('answers.txt');
  const jsonEntry = entries.get('questions.json');

  if (jsonEntry) {
    const rows = portableQuestionsFromJson(JSON.parse(decodeText(jsonEntry.data))).map((row) =>
      rewritePortableQuestionAssets(row, assetUrlMap),
    );
    applyPortableQuestions(rows, '题目压缩包');
    return;
  }

  if (templateEntry) {
    structuredBatchQuestions.value = [];
    removedBatchRowKeys.value = new Set();
    batchText.value = rewritePortableAssetPaths(decodeText(templateEntry.data), assetUrlMap);
    batchAnswerText.value = answerEntry ? decodeText(answerEntry.data) : '';
    importMode.value = 'batch';
    refreshPreview();
    ElMessage.success('题目压缩包已载入，可预览后批量导入');
    return;
  }

  throw new Error('压缩包内缺少 questions-template.md 或 questions.json');
}

async function uploadZipAssets(entries) {
  const assetUrlMap = new Map();
  const assetEntries = [...entries.values()].filter((entry) => entry.name.startsWith('assets/') && !entry.name.endsWith('/'));
  for (const entry of assetEntries) {
    const filename = entry.name.split('/').pop() || 'asset';
    const blob = new Blob([entry.data], { type: mimeByFilename(filename) });
    const uploadFile = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    const asset = await uploadAssetFile(uploadFile, { silent: true });
    assetUrlMap.set(entry.name, asset.url);
  }
  if (assetEntries.length) {
    ElMessage.success(`已恢复 ${assetEntries.length} 个题目附件`);
  }
  return assetUrlMap;
}

function applyPortableQuestions(rows, sourceLabel) {
  const questions = rows.filter(Boolean);
  if (!questions.length) throw new Error(`${sourceLabel} 中没有可导入的题目`);
  structuredBatchQuestions.value = questions;
  removedBatchRowKeys.value = new Set();
  const { template, answers } = portableQuestionsToBatch(questions);
  batchText.value = template;
  batchAnswerText.value = answers;
  importMode.value = 'batch';
  refreshPreview();
  ElMessage.success(`已从 ${sourceLabel} 解析 ${questions.length} 道题，请检查后导入`);
}

function ensurePortableCsvRows(rows) {
  if (!rows.length) return;
  const headers = new Set(Object.keys(rows[0] ?? {}));
  const legacyPaperColumns = ['no', 'section', 'title', 'type', 'score', 'content', 'answer', 'analysis'].every((key) =>
    headers.has(key),
  );
  const hasTransferFields = ['contentMarkdown', 'optionsJson', 'answerJson', 'scoringRuleJson'].some((key) => headers.has(key));
  if (legacyPaperColumns && !hasTransferFields) {
    throw new Error(
      '这是旧版试卷文档 CSV，只包含阅读展示字段，缺少可回导字段：contentMarkdown、optionsJson、answerJson、scoringRuleJson、tagNames、knowledgePointNames。请用新版“CSV/JSON 迁移导出”重新导出。',
    );
  }
}

function buildPortablePreviewRow(question, index) {
  const number = index + 1;
  const knowledgePointNames = mergeTags(selectedKnowledgeNames.value, question.knowledgePointNames);
  const payload = {
    valid: true,
    number,
    courseId: sharedCourseId.value || question.courseId,
    knowledgePointIds: mergeIds(sharedKnowledgePointIds.value, resolveKnowledgePointIdsByName(knowledgePointNames)),
    knowledgePointNames,
    type: normalizeType(question.type || 'single_choice'),
    title: question.title,
    tagNames: mergeTags(sharedTagNames.value, question.tagNames),
    content: question.content,
    difficulty: Number(question.difficulty) || 1,
    defaultScore: Number(question.defaultScore ?? question.score) || 2,
    analysis: question.analysis ?? '',
    options: question.options ?? [],
    answer: question.answer,
    scoringRule: question.scoringRule,
    programmingRef: normalizeProgrammingRef(question.programmingRef),
    allowOptionShuffle: question.allowOptionShuffle,
    answerText: portableAnswerForImport(question),
    statusText: '待导入',
  };

  try {
    validatePayload(payload, `第 ${number} 题`);
    return payload;
  } catch (error) {
    return {
      ...payload,
      valid: false,
      statusText: `格式错误：${error.message}`,
      errorMessage: error.message,
    };
  }
}

async function handleImagePaste(event, target, field) {
  const file = extractImageFromClipboard(event);
  if (!file) return;

  event.preventDefault();
  setImageInsertTarget(target, field);
  const asset = await uploadAssetFile(file);
  insertUploadedAsset(asset);
}

async function handleBatchImagePaste(event, field) {
  const file = extractImageFromClipboard(event);
  if (!file) return;

  event.preventDefault();
  setBatchInsertTarget(field);
  const asset = await uploadAssetFile(file);
  insertUploadedAsset(asset);
}

function extractImageFromClipboard(event) {
  const items = [...(event.clipboardData?.items ?? [])];
  return items.find((item) => item.type?.startsWith('image/'))?.getAsFile() ?? null;
}

async function uploadAssetFile(file, options = {}) {
  uploadingAsset.value = true;
  try {
    const formData = new FormData();
    formData.append('file', file);
    const asset = await api('/uploads/question-assets', { method: 'POST', body: formData });
    const normalized = normalizeUploadedAsset(asset);
    uploadedAssets.value = [normalized, ...uploadedAssets.value.filter((item) => item.url !== normalized.url)].slice(0, 24);
    if (!options.silent) {
      ElMessage.success(normalized.isImage ? '图片已上传' : '附件已上传');
    }
    return normalized;
  } finally {
    uploadingAsset.value = false;
  }
}

function insertUploadedAsset(asset) {
  const markdown = assetMarkdown(asset);
  if (!markdown) return;

  if (!assetInsertTarget.value) {
    setBatchInsertTarget(importMode.value === 'batch' ? 'batchText' : 'singleContent');
  }

  if (assetInsertTarget.value?.type === 'object') {
    appendMarkdownToObject(assetInsertTarget.value.target, assetInsertTarget.value.field, markdown);
  } else if (assetInsertTarget.value?.field === 'batchAnswerText') {
    batchAnswerText.value = appendMarkdownText(batchAnswerText.value, markdown);
  } else if (assetInsertTarget.value?.field === 'singleContent') {
    singleForm.content = appendMarkdownText(singleForm.content, markdown);
  } else {
    batchText.value = appendMarkdownText(batchText.value, markdown);
  }

  refreshPreview();
}

async function renameAsset(asset) {
  const nextName = String(asset.displayName || '').trim();
  if (!nextName) {
    asset.displayName = asset.savedDisplayName || asset.filename;
    return;
  }
  if (nextName === asset.savedDisplayName) return;

  const oldUrl = asset.url;
  const oldMarkdown = assetMarkdown(asset);
  try {
    const renamed = normalizeUploadedAsset(
      await api(`/uploads/question-assets/${encodeURIComponent(asset.filename)}`, {
        method: 'PATCH',
        body: { displayName: nextName },
      }),
    );
    Object.assign(asset, renamed);
    replaceAssetReferences(oldUrl, asset.url, oldMarkdown, assetMarkdown(asset));
    ElMessage.success('附件已重命名');
  } catch (error) {
    asset.displayName = asset.savedDisplayName || asset.displayName;
    ElMessage.error(error.message);
  }
}

async function removeUploadedAsset(asset) {
  try {
    await api(`/uploads/question-assets/${encodeURIComponent(asset.filename)}`, { method: 'DELETE' });
    uploadedAssets.value = uploadedAssets.value.filter((item) => item.url !== asset.url);
    removeAssetReferences(asset.url);
    ElMessage.success('附件已删除');
    refreshPreview();
  } catch (error) {
    ElMessage.error(error.message);
  }
}

async function loadQuestionAssetReport() {
  assetReportLoading.value = true;
  try {
    assetReport.value = await api('/uploads/question-assets/report');
    ElMessage.success('资源检查完成');
  } catch (error) {
    ElMessage.error(error.message || '资源检查失败');
  } finally {
    assetReportLoading.value = false;
  }
}

async function cleanupQuestionAssetOrphans() {
  if (!assetReport.value?.orphanCount) return;
  try {
    await ElMessageBox.confirm(
      `将删除 ${assetReport.value.orphanCount} 个未被题目、试卷快照或作答实例引用的本地题目附件。此操作不可恢复，是否继续？`,
      '清理孤立附件',
      { type: 'warning' },
    );
  } catch {
    return;
  }

  assetCleanupLoading.value = true;
  try {
    const result = await api('/uploads/question-assets/cleanup-orphans', { method: 'POST' });
    const deletedUrls = new Set((result.deleted ?? []).map((item) => item.url));
    if (deletedUrls.size) {
      uploadedAssets.value = uploadedAssets.value.filter((asset) => !deletedUrls.has(asset.url));
    }
    ElMessage.success(`已清理 ${result.deletedCount} 个孤立附件${result.failedCount ? `，${result.failedCount} 个失败` : ''}`);
    await loadQuestionAssetReport();
  } catch (error) {
    ElMessage.error(error.message || '清理失败');
  } finally {
    assetCleanupLoading.value = false;
  }
}

function normalizeUploadedAsset(asset) {
  const filename = asset?.filename || '附件';
  const displayName = asset?.displayName || filename.replace(/\.[^.]+$/, '') || filename;
  return {
    ...asset,
    displayName,
    savedDisplayName: displayName,
    isImage: Boolean(asset?.isImage) || /\.(png|jpe?g|gif|webp|svg)$/i.test(filename),
    align: asset?.align || 'center',
    width: Number(asset?.width) || 80,
  };
}

function formatAssetKind(kind) {
  const map = {
    image: '图片',
    pdf: 'PDF',
    word: '文档',
    sheet: '表格',
    archive: '压缩包',
    file: '文件',
  };
  return map[kind] || '文件';
}

function assetMarkdown(asset) {
  const url = asset?.url;
  if (!url) return asset?.markdown || '';
  const label = String(asset.displayName || asset.filename || '附件').trim() || '附件';
  return asset.isImage ? `![${label}](${assetImageUrl(asset)})` : `[${label}](${url})`;
}

function assetImageUrl(asset) {
  const url = new URL(asset.url, window.location.origin);
  url.searchParams.set('align', ['left', 'center', 'right'].includes(asset.align) ? asset.align : 'center');
  url.searchParams.set('w', String(clampImageWidth(asset.width)));
  return `${url.pathname}${url.search}${url.hash}`;
}

function clampImageWidth(value) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) return 80;
  return Math.min(100, Math.max(20, Math.round(nextValue)));
}

function parseStoredZip(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const entries = new Map();
  let offset = 0;

  while (offset + 30 <= bytes.length) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) {
      offset += 1;
      continue;
    }

    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const filenameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + filenameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (flags & 0x08) throw new Error('暂不支持带数据描述符的 ZIP，请使用系统导出的题目压缩包');
    if (method !== 0) throw new Error('暂不支持压缩加密 ZIP，请使用系统导出的题目压缩包');
    if (dataEnd > bytes.length) throw new Error('ZIP 文件不完整或已损坏');

    const name = decodeText(bytes.slice(nameStart, nameStart + filenameLength)).replace(/\\/g, '/');
    entries.set(name, { name, data: bytes.slice(dataStart, dataEnd) });
    offset = dataEnd;
  }

  if (!entries.size) throw new Error('未识别到可导入的 ZIP 内容');
  return entries;
}

function portableQuestionsFromJson(value) {
  if (Array.isArray(value)) return value.map(normalizePortableQuestion);
  if (Array.isArray(value?.questions)) return value.questions.map(normalizePortableQuestion);
  throw new Error('JSON 中缺少 questions 数组');
}

function normalizePortableQuestion(record) {
  const importPayload = normalizePortableJson(record?.importPayload);
  const source = importPayload && typeof importPayload === 'object' && !Array.isArray(importPayload)
    ? { ...importPayload }
    : { ...record };
  const tagNames = normalizeNameList(source.tagNames ?? record?.tagNames ?? record?.tags);
  const knowledgePointNames = normalizeNameList(source.knowledgePointNames ?? record?.knowledgePointNames ?? record?.knowledgePoints);
  const answer = normalizePortableJson(source.answerJson ?? source.answer ?? record?.answerJson ?? record?.answer);
  const options = applyPortableAnswerToOptions(
    normalizePortableOptions(source.optionsJson ?? source.options ?? record?.optionsJson ?? record?.options),
    answer,
  );
  const scoringRule = normalizePortableJson(source.scoringRuleJson ?? source.scoringRule ?? record?.scoringRuleJson ?? record?.scoringRule);
  const programmingRef = normalizeProgrammingRef(
    source.programmingRef ?? {
      externalProblemId: source.hydroProblemId ?? source.hydroProblemName ?? source.hydroProblem ?? source.externalProblemId,
      externalProblemUrl: source.hydroProblemUrl ?? source.hydroUrl ?? source.externalProblemUrl,
      languages: source.hydroLanguages ?? source.languages,
    },
  );

  return {
    type: normalizeType(source.type || record?.type || 'single_choice'),
    title: String(source.title || record?.title || '未命名题目').trim(),
    content: String(source.contentMarkdown ?? source.content ?? record?.contentMarkdown ?? record?.content ?? '').trim(),
    difficulty: Number(source.difficulty ?? record?.difficulty ?? 1) || 1,
    defaultScore: Number(source.defaultScore ?? source.score ?? record?.defaultScore ?? record?.score ?? 2) || 2,
    analysis: String(source.analysisMarkdown ?? source.analysis ?? record?.analysisMarkdown ?? record?.analysis ?? '').trim(),
    tagNames,
    knowledgePointNames,
    options,
    answer,
    scoringRule,
    programmingRef,
    allowOptionShuffle: normalizeBoolean(source.allowOptionShuffle ?? record?.allowOptionShuffle),
    courseId: source.courseId ?? record?.courseId,
    courseName: source.courseName ?? record?.courseName,
  };
}

function normalizePortableOptions(value) {
  const parsed = normalizePortableJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.map((option, index) => ({
    id: option.id ?? option.optionId,
    optionKey: String(option.optionKey ?? option.label ?? optionKeyForIndex(index)).trim() || optionKeyForIndex(index),
    content: String(option.content ?? option.contentMarkdown ?? '').trim(),
    isCorrect: option.isCorrect === true || option.isCorrect === 'true',
    sortOrder: Number(option.sortOrder ?? index + 1) || index + 1,
  }));
}

function normalizePortableJson(value) {
  if (value && typeof value === 'object') return value;
  const text = String(value ?? '').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function applyPortableAnswerToOptions(options, answer) {
  if (!Array.isArray(answer?.correctOptionIds) || !options.length) return options;
  const correctIds = new Set(answer.correctOptionIds.map((item) => String(item)));
  return options.map((option) => ({
    ...option,
    isCorrect: option.isCorrect || correctIds.has(String(option.id)) || correctIds.has(String(option.optionKey)),
  }));
}

function normalizeBoolean(value) {
  if (value === true || value === 'true' || value === '1' || value === 1) return true;
  if (value === false || value === 'false' || value === '0' || value === 0) return false;
  return undefined;
}

function normalizeNameList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item : item?.name))
      .map((name) => String(name ?? '').trim())
      .filter(isMeaningfulName);
  }
  return parseTagNames(value);
}

function rewritePortableQuestionAssets(question, assetUrlMap) {
  return {
    ...question,
    content: rewritePortableAssetPaths(question.content, assetUrlMap),
    analysis: rewritePortableAssetPaths(question.analysis, assetUrlMap),
    options: question.options.map((option) => ({
      ...option,
      content: rewritePortableAssetPaths(option.content, assetUrlMap),
    })),
  };
}

function rewritePortableAssetPaths(value, assetUrlMap) {
  let result = String(value ?? '');
  for (const [assetPath, url] of assetUrlMap.entries()) {
    result = result.split(assetPath).join(url);
  }
  return result;
}

function portableQuestionsToBatch(questions) {
  const blocks = [];
  const answers = [];
  questions.forEach((question, index) => {
    blocks.push(portableQuestionBlock(question));
    const answer = portableAnswerForImport(question);
    if (answer) answers.push(`${index + 1}. ${answer}`);
  });
  return {
    template: blocks.join('\n---\n'),
    answers: answers.join('\n'),
  };
}

function portableQuestionBlock(question) {
  const lines = [
    `标题：${question.title}`,
    `题型：${typeLabel(question.type)}`,
    `难度：${question.difficulty}`,
    `分值：${question.defaultScore}`,
  ];
  if (question.tagNames?.length) lines.push(`标签：${question.tagNames.join(',')}`);
  if (question.knowledgePointNames?.length) lines.push(`知识点：${question.knowledgePointNames.join(',')}`);
  if (question.type === 'programming' && question.programmingRef?.externalProblemId) {
    lines.push(`Hydro题目：${question.programmingRef.externalProblemId}`);
    if (question.programmingRef.externalProblemUrl) lines.push(`Hydro链接：${question.programmingRef.externalProblemUrl}`);
    if (question.programmingRef.languages?.length) lines.push(`Hydro语言：${question.programmingRef.languages.join(',')}`);
  }
  lines.push('题干：', question.content);
  if (isChoiceType(question.type)) {
    lines.push('选项：');
    for (const option of question.options) {
      const [firstLine, ...restLines] = String(option.content || '').split('\n');
      lines.push(`${option.optionKey}. ${firstLine ?? ''}`);
      lines.push(...restLines);
    }
  }
  if (question.analysis) lines.push('解析：', question.analysis);
  return lines.join('\n').trim();
}

function portableAnswerForImport(question) {
  if (isChoiceType(question.type)) {
    const correctKeys = question.options.filter((option) => option.isCorrect).map((option) => option.optionKey);
    if (correctKeys.length) return correctKeys.join(',');

    if (typeof question.answer === 'string') return question.answer;
    if (Array.isArray(question.answer?.correctOptionIds)) {
      return question.answer.correctOptionIds
        .map((id) => question.options.find((option) => option.id === id || option.optionKey === id)?.optionKey)
        .filter(Boolean)
        .join(',');
    }
  }

  if (question.type === 'fill_blank' && Array.isArray(question.answer?.blanks)) {
    return question.answer.blanks
      .flatMap((blank) => (Array.isArray(blank.answers) ? blank.answers : []))
      .map(String)
      .join(',');
  }

  if (typeof question.answer?.reference === 'string') return question.answer.reference;
  if (typeof question.answer === 'string') return question.answer;
  return '';
}

function parseCsvRows(text) {
  const rows = parseCsvTable(text);
  if (!rows.length) return [];
  const headers = rows[0].map((header) => String(header || '').replace(/^\uFEFF/, '').trim());
  return rows
    .slice(1)
    .filter((row) => row.some((cell) => String(cell ?? '').trim()))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}

function parseCsvTable(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const source = String(text ?? '').replace(/\r\n/g, '\n');

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

function decodeText(value) {
  return new TextDecoder('utf-8').decode(value);
}

function mimeByFilename(filename) {
  const extension = String(filename).split('.').pop()?.toLowerCase();
  const map = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
    json: 'application/json',
    csv: 'text/csv',
    txt: 'text/plain',
    md: 'text/markdown',
  };
  return map[extension] || 'application/octet-stream';
}

function appendMarkdownToObject(target, field, markdown) {
  target[field] = appendMarkdownText(target[field], markdown);
}

function appendMarkdownText(value, markdown) {
  const current = String(value || '').trimEnd();
  return `${current}${current ? '\n\n' : ''}${markdown}\n`;
}

function replaceAssetReferences(oldUrl, nextUrl, oldMarkdown, nextMarkdown) {
  const replaceValue = (value) => String(value || '').split(oldMarkdown).join(nextMarkdown).split(oldUrl).join(nextUrl);
  singleForm.content = replaceValue(singleForm.content);
  singleForm.analysis = replaceValue(singleForm.analysis);
  singleForm.options.forEach((option) => {
    option.content = replaceValue(option.content);
  });
  batchText.value = replaceValue(batchText.value);
  batchAnswerText.value = replaceValue(batchAnswerText.value);
  refreshPreview();
}

function removeAssetReferences(url) {
  const removeValue = (value) =>
    String(value || '')
      .split('\n')
      .filter((line) => !line.includes(url))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');
  singleForm.content = removeValue(singleForm.content);
  singleForm.analysis = removeValue(singleForm.analysis);
  singleForm.options.forEach((option) => {
    option.content = removeValue(option.content);
  });
  batchText.value = removeValue(batchText.value);
  batchAnswerText.value = removeValue(batchAnswerText.value);
}

function fileExt(asset) {
  const match = String(asset.filename || asset.url || '').match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toUpperCase().slice(0, 5) : 'FILE';
}

function formatFileSize(size) {
  const value = Number(size || 0);
  if (!value) return '未知大小';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

function getSingleAnswerText() {
  if (isChoiceType(singleForm.type)) {
    return singleForm.options.filter((option) => option.isCorrect).map((option) => option.optionKey).join(',');
  }
  if (singleForm.type === 'fill_blank') return blankAnswers.value;
  return answerReference.value;
}

function buildSingleProgrammingRefPayload() {
  return buildProgrammingRefFromValues({
    externalProblemId: singleForm.programmingRef.externalProblemId,
    externalProblemUrl: singleForm.programmingRef.externalProblemUrl,
    platformBaseUrl: singleForm.programmingRef.platformBaseUrl,
    domainId: singleForm.programmingRef.domainId,
    domainName: singleForm.programmingRef.domainName,
    accountId: singleForm.programmingRef.accountId,
    accountLabel: singleForm.programmingRef.accountLabel,
    languagesText: singleForm.programmingRef.languagesText,
    timeLimit: singleForm.programmingRef.timeLimit,
    memoryLimit: singleForm.programmingRef.memoryLimit,
    judgeConfig: singleForm.programmingRef.judgeConfig,
  });
}

function normalizeProgrammingRef(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const ref = buildProgrammingRefFromValues({
    externalProblemId: value.externalProblemId ?? value.hydroProblemId ?? value.hydroProblemName ?? value.hydroProblem,
    externalProblemUrl: value.externalProblemUrl ?? value.hydroProblemUrl ?? value.hydroUrl,
    platformBaseUrl: value.platformBaseUrl,
    domainId: value.domainId,
    domainName: value.domainName,
    accountId: value.accountId,
    accountLabel: value.accountLabel,
    languagesText: Array.isArray(value.languages) ? value.languages.join(',') : value.languages ?? value.hydroLanguages,
    timeLimit: value.timeLimit,
    memoryLimit: value.memoryLimit,
    judgeConfig: value.judgeConfig,
  });
  return ref?.externalProblemId ? ref : null;
}

function buildProgrammingRefFromValues({
  externalProblemId,
  externalProblemUrl,
  platformBaseUrl,
  domainId,
  domainName,
  accountId,
  accountLabel,
  languagesText,
  timeLimit,
  memoryLimit,
  judgeConfig,
}) {
  const problemId = String(externalProblemId ?? '').trim();
  if (!problemId) return null;
  const ref = {
    externalProblemId: problemId,
    externalProblemUrl: String(externalProblemUrl ?? '').trim() || undefined,
    platformBaseUrl: String(platformBaseUrl ?? '').trim() || undefined,
    domainId: String(domainId ?? '').trim() || undefined,
    domainName: String(domainName ?? '').trim() || undefined,
    accountId: accountId || undefined,
    accountLabel: String(accountLabel ?? '').trim() || undefined,
    languages: parseHydroLanguages(languagesText || 'cc.cc17o2, py.py3'),
  };
  if (timeLimit) ref.timeLimit = Number(timeLimit);
  if (memoryLimit) ref.memoryLimit = Number(memoryLimit);
  if (judgeConfig) ref.judgeConfig = judgeConfig;
  return ref;
}

async function pullSingleHydroProblem() {
  if (!canPullSingleHydroProblem.value) {
    ElMessage.warning('请先填写 Hydro 题号或链接');
    return;
  }

  singleHydroPulling.value = true;
  try {
    const pulled = await api(
      `/hydro/problems/pull${buildQuery({
        problemId: singleForm.programmingRef.externalProblemId.trim(),
        problemUrl: singleForm.programmingRef.externalProblemUrl.trim(),
        platformBaseUrl: singleForm.programmingRef.platformBaseUrl.trim(),
        domainId: singleForm.programmingRef.domainId.trim(),
        domainName: singleForm.programmingRef.domainName.trim(),
        accountId: singleForm.programmingRef.accountId,
      })}`,
    );
    applyPulledHydroProblem(singleForm, pulled);
    refreshPreview();
    scheduleSingleDuplicateCheck();
    ElMessage.success('Hydro 题目已拉取');
  } catch (error) {
    ElMessage.error(error.message || 'Hydro 题目拉取失败');
  } finally {
    singleHydroPulling.value = false;
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
  const pulledDomainId = ref.domainId || ref.judgeConfig?.domainId || target.programmingRef.domainId || 'system';
  target.programmingRef.domainId = pulledDomainId;
  target.programmingRef.domainName = ref.domainName || ref.judgeConfig?.domainName || pulledDomainId;
  target.programmingRef.accountId = ref.accountId || ref.judgeConfig?.accountId || target.programmingRef.accountId || '';
  target.programmingRef.accountLabel = ref.accountLabel || ref.judgeConfig?.accountLabel || target.programmingRef.accountLabel || '';
  target.programmingRef.languagesText = (ref.languages || pulled.languages || []).join(', ') || target.programmingRef.languagesText;
  target.programmingRef.timeLimit = ref.timeLimit ?? pulled.timeLimit ?? null;
  target.programmingRef.memoryLimit = ref.memoryLimit ?? pulled.memoryLimit ?? null;
  target.programmingRef.judgeConfig = ref.judgeConfig ?? null;
  resetSingleOptions();
}

function parseHydroLanguages(value) {
  return String(value || '')
    .split(/[,，、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function openSingleHydroProblem() {
  if (!singleHydroProblemUrl.value) return;
  window.open(singleHydroProblemUrl.value, '_blank', 'noopener,noreferrer');
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

function isChoiceType(type) {
  return ['single_choice', 'multiple_choice', 'true_false'].includes(type);
}

function normalizeType(value) {
  const key = String(value || '').trim().toLowerCase();
  const map = {
    单选: 'single_choice',
    单选题: 'single_choice',
    single: 'single_choice',
    single_choice: 'single_choice',
    多选: 'multiple_choice',
    多选题: 'multiple_choice',
    multiple: 'multiple_choice',
    multiple_choice: 'multiple_choice',
    判断: 'true_false',
    判断题: 'true_false',
    true_false: 'true_false',
    填空: 'fill_blank',
    填空题: 'fill_blank',
    fill_blank: 'fill_blank',
    简答: 'short_answer',
    简答题: 'short_answer',
    short_answer: 'short_answer',
    编程: 'programming',
    编程题: 'programming',
    programming: 'programming',
    材料: 'material',
    材料题: 'material',
    material: 'material',
    文件上传: 'file_upload',
    文件上传题: 'file_upload',
    file_upload: 'file_upload',
    scratch: 'scratch_project',
    scratch_project: 'scratch_project',
    arduino: 'arduino_project',
    arduino_project: 'arduino_project',
  };
  return map[key] ?? key;
}

function typeLabel(value) {
  return typeOptions.find((item) => item.value === value)?.label ?? value ?? '';
}

function parseAnswerKeys(value) {
  return String(value || '')
    .split(/[,，、|\s]+/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function isMeaningfulName(value) {
  const text = String(value ?? '').trim();
  return Boolean(text) && !['undefined', 'null', '-', '无'].includes(text.toLowerCase());
}

function parseTagNames(value) {
  return String(value || '')
    .split(/[,，、|/]+/)
    .map((item) => item.trim())
    .filter(isMeaningfulName);
}

function resolveKnowledgePointIdsByName(names = []) {
  if (!names.length) return [];
  const map = new Map(flattenKnowledgeTree(knowledgeTree.value).map((item) => [item.name, item.id]));
  return names.map((name) => map.get(name)).filter(Boolean);
}

function convertKnowledgeTree(items) {
  return items.map((item) => ({
    label: `${item.sortOrder ? `${item.sortOrder}. ` : ''}${item.name}`,
    value: item.id,
    children: convertKnowledgeTree(item.children ?? []),
  }));
}

function flattenKnowledgeTree(items) {
  return items.flatMap((item) => [item, ...flattenKnowledgeTree(item.children ?? [])]);
}

function mergeTags(...groups) {
  return [...new Set(groups.flat().map((name) => String(name).trim()).filter(isMeaningfulName))];
}

function mergeIds(...groups) {
  return [...new Set(groups.flat().filter(Boolean))];
}

function buildBlankAnswer(value, score) {
  const rawAnswers = String(value || '').split(/[,，|]/);
  const answers = rawAnswers
    .map((item) => (blankSpaceSensitive.value ? item : item.trim()))
    .filter((item) => item.length);

  return {
    blanks: [
      {
        index: 1,
        answers,
        ignoreCase: !blankCaseSensitive.value,
        trimSpace: !blankSpaceSensitive.value,
        score,
      },
    ],
  };
}

function optionKeyForIndex(index) {
  return index < 26 ? String.fromCharCode(65 + index) : `X${index + 1}`;
}

function extractField(block, label) {
  const match = block.match(new RegExp(`^${label}[:：]\\s*(.+)$`, 'm'));
  return match?.[1]?.trim() ?? '';
}

function formatBatchErrors(errors) {
  return errors.map((error) => `第 ${error.number} 题（${error.title}）：${error.message}`).join('；');
}

function batchRowClass({ row }) {
  if (row.valid === false) return 'batch-row-error';
  if (shouldSkipBatchRow(row)) return 'batch-row-skip';
  return '';
}

function makeTagCode(name, index) {
  const ascii = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
  return `q_${ascii || 'tag'}_${Date.now()}_${index}`;
}

watch(
  () => (importMode.value === 'single' ? JSON.stringify(buildDuplicateCheckPayload(singlePreviewQuestion.value)) : importMode.value),
  () => scheduleSingleDuplicateCheck(),
);

onBeforeUnmount(() => {
  if (singleDuplicateTimer) clearTimeout(singleDuplicateTimer);
});

onMounted(async () => {
  await loadBaseData();
  loadSingleTemplate();
  loadBatchTemplate();
  setImageInsertTarget(singleForm, 'content');
});
</script>

<style scoped>
.mini-muted {
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.4;
}

:deep(.batch-row-error) {
  --el-table-tr-bg-color: #fff2f0;
}

:deep(.batch-row-skip) {
  --el-table-tr-bg-color: #fff8e6;
}

.asset-maintenance {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.asset-maintenance-head {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
}

.asset-maintenance-head p {
  margin: 4px 0 0;
}

.asset-stat-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 12px 0;
}

.asset-stat-grid > div {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-light);
}

.asset-stat-grid b {
  display: block;
  color: var(--el-text-color-primary);
  font-size: 18px;
  line-height: 1.2;
}

.asset-stat-grid span {
  display: block;
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.asset-report-list {
  display: grid;
  gap: 8px;
}

.asset-report-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px 8px;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}

.asset-report-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-report-item small {
  grid-column: 1 / -1;
  color: var(--el-text-color-secondary);
}

.asset-reference-locations {
  overflow-wrap: anywhere;
}
</style>
