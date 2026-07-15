<template>
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
          <img v-if="asset.isImage && asset.previewUrl" :src="asset.previewUrl" :alt="asset.displayName ?? asset.filename" />
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

    <QuestionAssetReport
      :report="assetReport"
      :cleanup-loading="assetCleanupLoading"
      @cleanup="cleanupQuestionAssetOrphans"
    />
  </div>
</el-drawer>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useQuestionImportPageContext } from '../composables/questionImportPageContext';
import QuestionAssetReport from './QuestionAssetReport.vue';

export default defineComponent({
  components: { QuestionAssetReport },
  setup: useQuestionImportPageContext,
});
</script>
