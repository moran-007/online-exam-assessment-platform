<template>
  <section class="panel library-table-panel ai-summary-preset-panel">
    <div class="section-head">
      <div>
        <h2>AI 总结预设（管理员）</h2>
        <span class="muted">与模型配置并列管理；调整提示词会生成新版本，历史总结仍保留原版本</span>
      </div>
      <div class="toolbar">
        <el-tag effect="plain">{{ activeCount }} 个生效中</el-tag>
        <el-button @click="load">刷新</el-button>
      </div>
    </div>
    <el-table v-loading="loading" :data="presets" height="100%" class="question-list-table">
      <el-table-column label="用途" width="150">
        <template #default="{ row }">{{ typeLabel(row.summaryType) }}</template>
      </el-table-column>
      <el-table-column prop="code" label="预设代码" min-width="150" />
      <el-table-column label="版本" width="90">
        <template #default="{ row }">v{{ row.version }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? '已启用' : '历史版本' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="systemPrompt" label="系统提示词" min-width="340" show-overflow-tooltip />
      <el-table-column prop="changeReason" label="变更原因" min-width="180" show-overflow-tooltip>
        <template #default="{ row }">{{ row.changeReason || '初始版本' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="openEdit(row)">基于此版本编辑</el-button>
          <el-button
            v-if="!row.enabled"
            size="small"
            type="primary"
            link
            :loading="activatingId === row.id"
            @click="activate(row)"
          >
            启用
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="`编辑总结预设 · ${editing ? typeLabel(editing.summaryType) : ''}`" width="760px" destroy-on-close>
      <el-alert
        title="保存会创建新版本；输出结构与证据引用规则由系统固定维护，不会被本次编辑覆盖。"
        type="info"
        :closable="false"
        show-icon
      />
      <el-form label-position="top" class="ai-summary-preset-form">
        <el-form-item label="系统提示词">
          <el-input v-model="form.systemPrompt" type="textarea" :rows="12" maxlength="12000" show-word-limit />
        </el-form-item>
        <el-form-item label="变更原因">
          <el-input v-model="form.changeReason" maxlength="300" show-word-limit placeholder="例如：加强薄弱知识点与下一步行动建议" />
        </el-form-item>
        <el-form-item label="生效方式">
          <el-switch v-model="form.activate" active-text="保存后立即启用" inactive-text="仅保存为待启用版本" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">创建新版本</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { useAiSummaryPresets } from '../composables/useAiSummaryPresets';

const {
  activate, activatingId, activeCount, dialogVisible, editing, form, load, loading,
  openEdit, presets, save, saving, typeLabel,
} = useAiSummaryPresets();
</script>

<style scoped>
.ai-summary-preset-panel { height: 100%; min-height: 0; box-shadow: none; border: 0; padding: 0; }
.ai-summary-preset-form { margin-top: 16px; }
</style>
