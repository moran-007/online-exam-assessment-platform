<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">外部账号</h1>
        <span class="muted">{{ isSuperAdmin ? '管理用户在 Hydro 等 OJ 平台的登录账号' : '管理自己在 Hydro 等 OJ 平台的登录账号' }}</span>
      </div>
      <div class="toolbar">
        <el-button :icon="Refresh" @click="load">刷新</el-button>
        <el-button type="primary" @click="openCreateDialog">新增账号</el-button>
      </div>
    </div>

    <div class="panel filter-panel">
      <el-form inline>
        <el-form-item label="关键字">
          <el-input v-model="filters.keyword" clearable placeholder="用户 / Hydro / 站点" @keyup.enter="loadAccounts" />
        </el-form-item>
        <el-form-item label="平台">
          <el-select v-model="filters.platformCode" clearable style="width: 180px">
            <el-option v-for="platform in selectablePlatforms" :key="platform.code" :label="platform.name" :value="platform.code" />
          </el-select>
        </el-form-item>
        <el-form-item label="站点">
          <el-input v-model="filters.platformBaseUrl" clearable placeholder="https://oj.example.com" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadAccounts">查询</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="panel">
      <div class="paper-preview-head">
        <div>
          <h2>我的账号</h2>
          <span class="muted">当前登录账号用于拉取外部题目和教师测试提交的 OJ 账号</span>
        </div>
        <div class="toolbar">
          <el-button @click="router.push('/profile')">个人中心维护</el-button>
          <el-button type="primary" :icon="Plus" @click="openCreateOwnDialog">新增我的账号</el-button>
        </div>
      </div>
      <el-table :data="myAccounts" size="small">
        <el-table-column label="平台" min-width="110">
          <template #default="{ row }">{{ row.platformName || row.platformCode }}</template>
        </el-table-column>
        <el-table-column prop="platformBaseUrl" label="站点" min-width="190" />
        <el-table-column prop="loginUsername" label="登录账号" min-width="140" />
        <el-table-column label="Hydro账号" min-width="160">
          <template #default="{ row }">
            <span>{{ row.hydroUsername }}</span>
            <div class="muted">{{ row.hydroUserId }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" min-width="150">
          <template #default="{ row }">
            <HydroLoginStatusTag :account="row" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEditDialog(row)">编辑</el-button>
            <el-button link type="primary" :loading="testingId === row.id" @click="testAccount(row)">检测</el-button>
            <el-button link :icon="Link" @click="openOj(row)">打开</el-button>
            <el-button link type="danger" :icon="Delete" @click="deleteAccount(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-if="isSuperAdmin" class="panel external-platform-panel">
      <div class="paper-preview-head">
        <div>
          <h2>接入平台</h2>
          <span class="muted">配置外部账号表单中的平台下拉选项</span>
        </div>
        <el-button type="primary" :icon="Plus" @click="openCreatePlatformDialog">新增平台</el-button>
      </div>
      <el-table :data="platforms" size="small">
        <el-table-column prop="name" label="平台名称" min-width="140" />
        <el-table-column prop="code" label="编码" width="120" />
        <el-table-column prop="baseUrl" label="站点" min-width="220" />
        <el-table-column prop="sortOrder" label="排序" width="80" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.enabled === false ? 'info' : 'success'">{{ row.enabled === false ? '停用' : '启用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :icon="Edit" @click="openEditPlatformDialog(row)">编辑</el-button>
            <el-button link type="danger" :icon="Delete" @click="deletePlatform(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="panel">
      <el-table v-loading="loading" :data="accounts">
        <el-table-column label="用户" min-width="170">
          <template #default="{ row }">
            <strong>{{ row.ownerName || row.studentName }}</strong>
            <div class="muted">{{ row.ownerUsername || row.username }}</div>
          </template>
        </el-table-column>
        <el-table-column label="平台" min-width="110">
          <template #default="{ row }">{{ row.platformName || row.platformCode }}</template>
        </el-table-column>
        <el-table-column prop="platformBaseUrl" label="站点" min-width="190" />
        <el-table-column prop="loginUsername" label="登录账号" min-width="140" />
        <el-table-column label="Hydro账号" min-width="160">
          <template #default="{ row }">
            <span>{{ row.hydroUsername }}</span>
            <div class="muted">{{ row.hydroUserId }}</div>
          </template>
        </el-table-column>
        <el-table-column label="密码" width="95">
          <template #default="{ row }">
            <el-tag :type="row.hasPassword ? 'success' : 'warning'">{{ row.hasPassword ? '已保存' : '未保存' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" min-width="160">
          <template #default="{ row }">
            <HydroLoginStatusTag :account="row" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEditDialog(row)">编辑</el-button>
            <el-button link type="primary" :loading="testingId === row.id" @click="testAccount(row)">检测</el-button>
            <el-button link :icon="Link" @click="openOj(row)">打开</el-button>
            <el-button link type="danger" :icon="Delete" @click="deleteAccount(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination-row">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          layout="total, sizes, prev, pager, next"
          :total="pagination.total"
          @current-change="loadAccounts"
          @size-change="loadAccounts"
        />
      </div>
    </div>

    <el-dialog v-model="dialogVisible" :title="accountForm.id ? '编辑外部账号' : '新增外部账号'" width="560px">
      <el-form label-width="112px">
        <el-form-item v-if="isSuperAdmin" label="所属用户">
          <el-select v-model="accountForm.studentId" filterable style="width: 100%">
            <el-option
              v-for="owner in owners"
              :key="owner.id"
              :label="`${owner.realName || owner.username}（${owner.username}）`"
              :value="owner.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="接入平台">
          <el-select v-model="accountForm.platformCode" style="width: 100%" @change="handlePlatformChange">
            <el-option
              v-for="platform in selectablePlatforms"
              :key="platform.code"
              :label="`${platform.name}（${platform.baseUrl}）`"
              :value="platform.code"
            />
          </el-select>
        </el-form-item>
        <el-form-item v-if="!isSuperAdmin" label="所属用户">
          <el-input :model-value="ownerLabel(currentUser)" disabled />
        </el-form-item>
        <el-form-item label="平台名称">
          <el-input v-model="accountForm.platformName" placeholder="例如：Tarjan OJ / 校内 Hydro" />
        </el-form-item>
        <el-form-item label="OJ站点">
          <el-input v-model="accountForm.platformBaseUrl" placeholder="https://oj.example.com" />
        </el-form-item>
        <el-form-item label="登录账号">
          <el-input v-model="accountForm.loginUsername" placeholder="Hydro 登录账号" />
        </el-form-item>
        <el-form-item label="登录密码">
          <el-input v-model="accountForm.loginPassword" type="password" show-password placeholder="留空保持原密码" />
        </el-form-item>
        <el-form-item label="Hydro用户名">
          <el-input v-model="accountForm.hydroUsername" />
        </el-form-item>
        <el-form-item label="Hydro UID">
          <el-input v-model="accountForm.hydroUserId" placeholder="不知道时可与用户名相同" />
        </el-form-item>
        <el-form-item label="启用状态">
          <el-segmented v-model="accountForm.bindStatus" :options="statusOptions" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveAccount">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="platformDialogVisible" :title="platformForm.id ? '编辑接入平台' : '新增接入平台'" width="520px">
      <el-form label-width="96px">
        <el-form-item label="平台名称">
          <el-input v-model="platformForm.name" placeholder="例如：Hydro / Tarjan OJ" />
        </el-form-item>
        <el-form-item label="平台编码">
          <el-input v-model="platformForm.code" placeholder="例如：hydro" />
        </el-form-item>
        <el-form-item label="OJ站点">
          <el-input v-model="platformForm.baseUrl" placeholder="https://oj.example.com" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="platformForm.sortOrder" :min="0" :step="1" />
        </el-form-item>
        <el-form-item label="启用状态">
          <el-segmented v-model="platformForm.enabled" :options="platformStatusOptions" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="platformDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="platformSaving" @click="savePlatform">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useExternalAccountPage } from '../composables/useExternalAccountPage';
import HydroLoginStatusTag from './HydroLoginStatusTag.vue';

export default defineComponent({
  name: 'ExternalAccountPage',
  components: { HydroLoginStatusTag },
  setup() {
    const context = useExternalAccountPage();
    return context;
  },
});
</script>

<style scoped>
.status-tag {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
  white-space: nowrap;
}
</style>
