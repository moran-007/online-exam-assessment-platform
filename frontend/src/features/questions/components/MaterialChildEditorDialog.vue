<template>
<el-dialog
  v-model="materialChildDialogVisible"
  :title="materialChildDialogTitle"
  width="860px"
  class="material-child-dialog"
  destroy-on-close
>
  <el-form label-width="96px">
    <div class="material-child-dialog-grid">
      <el-form-item label="题型">
        <el-select v-model="materialChildDraft.type" filterable style="width: 100%" @change="resetMaterialInlineChild(materialChildDraft)">
          <el-option
            v-for="type in materialChildTypeOptions"
            :key="type.value"
            :label="type.label"
            :value="type.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="分值">
        <el-input-number v-model="materialChildDraft.score" :min="0.01" :precision="2" :step="1" style="width: 100%" />
      </el-form-item>
      <el-form-item label="难度">
        <div class="inline-control">
          <el-rate v-model="materialChildDraft.difficulty" :max="5" />
        </div>
      </el-form-item>
      <el-form-item v-if="isTextAnswerType(materialChildDraft.type)" label="作答行数">
        <el-input-number v-model="materialChildDraft.answerRows" :min="2" :max="24" :step="1" style="width: 100%" />
      </el-form-item>
    </div>

    <el-form-item label="子题标题">
      <el-input v-model="materialChildDraft.title" placeholder="例如：第 1 问 / 根据材料判断输出结果" />
    </el-form-item>

    <el-form-item label="子题题干">
      <div style="width: 100%">
        <div class="toolbar compact-toolbar">
          <el-button size="small" :icon="DocumentAdd" @click="insertCodeBlock(materialChildDraft, 'content')">代码块</el-button>
          <el-button v-if="materialChildDraft.type === 'fill_blank'" size="small" :icon="Plus" @click="insertMaterialChildBlankMarker(materialChildDraft)">
            插入空位
          </el-button>
          <span class="mini-muted">这里只写小题问题，材料正文写在上方“大题说明”。</span>
        </div>
        <el-input
          v-model="materialChildDraft.content"
          type="textarea"
          :rows="5"
          resize="vertical"
          placeholder="子题题干，支持 Markdown 和代码块"
          @focus="setImageInsertTarget(materialChildDraft, 'content')"
          @paste="handleImagePaste($event, materialChildDraft, 'content')"
        />
      </div>
    </el-form-item>

    <el-form-item v-if="isChoiceType(materialChildDraft.type)" label="选项">
      <div class="choice-editor material-child-choice-editor">
        <div class="toolbar compact-toolbar">
          <el-button v-if="materialChildDraft.type !== 'true_false'" size="small" :icon="Plus" @click="addMaterialChildOption(materialChildDraft)">
            增加选项
          </el-button>
          <span class="mini-muted">单选/判断选一个正确项，多选至少两个正确项。</span>
        </div>
        <div v-for="(option, optionIndex) in materialChildDraft.options" :key="option.optionKey" class="option-editor">
          <el-radio
            v-if="materialChildDraft.type === 'single_choice' || materialChildDraft.type === 'true_false'"
            :model-value="materialChildCorrectChoiceKey(materialChildDraft)"
            :label="option.optionKey"
            @update:model-value="setMaterialChildCorrectChoice(materialChildDraft, $event)"
          />
          <el-checkbox v-else v-model="option.isCorrect" />
          <el-tag>{{ option.optionKey }}</el-tag>
          <div class="option-content">
            <el-input v-model="option.content" type="textarea" :rows="2" resize="vertical" />
            <MarkdownRenderer v-if="option.content" :source="option.content" />
          </div>
          <el-button
            v-if="materialChildDraft.type !== 'true_false'"
            size="small"
            plain
            :icon="Delete"
            :disabled="materialChildDraft.options.length <= 2"
            @click="removeMaterialChildOption(materialChildDraft, optionIndex)"
          >
            删除
          </el-button>
        </div>
      </div>
    </el-form-item>

    <el-form-item v-else-if="materialChildDraft.type === 'fill_blank'" label="答案">
      <div class="fill-blank-answer-editor material-child-fill-blank-editor">
        <div class="toolbar compact-toolbar">
          <el-button size="small" :icon="Plus" @click="addMaterialChildBlankAnswerRow(materialChildDraft)">增加空位</el-button>
          <el-button size="small" :icon="DocumentAdd" @click="insertMaterialChildBlankMarker(materialChildDraft)">插入题干空位</el-button>
          <span class="mini-muted">与普通填空题一致：题干中的 ____ 对应学生看到的填空横线。</span>
        </div>
        <div v-for="(blank, blankIndex) in materialChildDraft.blankRows" :key="blankIndex" class="blank-answer-row">
          <el-tag>第 {{ Number(blankIndex) + 1 }} 空</el-tag>
          <el-input v-model="blank.answerText" placeholder="正确答案；多个答案用逗号分隔" />
          <el-button
            size="small"
            plain
            :icon="Delete"
            :disabled="materialChildDraft.blankRows.length <= 1"
            @click="removeMaterialChildBlankAnswerRow(materialChildDraft, blankIndex)"
          >
            删除
          </el-button>
        </div>
      </div>
    </el-form-item>

    <el-form-item v-else label="参考答案">
      <el-input
        v-model="materialChildDraft.answerText"
        type="textarea"
        :rows="draftAnswerEditorRows"
        resize="vertical"
        placeholder="参考答案或评分说明"
      />
    </el-form-item>

    <el-form-item label="解析">
      <el-input
        v-model="materialChildDraft.analysis"
        type="textarea"
        :rows="2"
        resize="vertical"
        placeholder="子题解析，可选"
        @focus="setImageInsertTarget(materialChildDraft, 'analysis')"
        @paste="handleImagePaste($event, materialChildDraft, 'analysis')"
      />
    </el-form-item>
  </el-form>
  <template #footer>
    <div class="dialog-footer">
      <el-button @click="materialChildDialogVisible = false">取消</el-button>
      <el-button
        v-if="materialEditingChildIndex >= 0 && singleForm.children.length > 1"
        type="danger"
        plain
        :icon="Delete"
        @click="deleteMaterialChildFromDialog"
      >
        删除子题
      </el-button>
      <el-button type="primary" @click="saveMaterialChildDraft">保存子题</el-button>
    </div>
  </template>
</el-dialog>
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
