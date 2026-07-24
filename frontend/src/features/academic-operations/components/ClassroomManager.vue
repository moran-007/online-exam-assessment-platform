<template>
  <el-dialog v-model="visible" title="教室管理" width="520px" destroy-on-close>
    <div class="classroom-add">
      <el-input v-model="newName" maxlength="128" placeholder="输入教室名称，例如 A301" @keyup.enter="addRoom" />
      <el-button type="primary" @click="addRoom">增加教室</el-button>
    </div>
    <el-empty v-if="!classrooms.length" description="暂无教室，请先增加" :image-size="72" />
    <div v-else class="classroom-list">
      <div v-for="room in classrooms" :key="room" class="classroom-row">
        <el-input v-if="editing === room" v-model="editingName" maxlength="128" @keyup.enter="saveRename(room)" />
        <strong v-else>{{ room }}</strong>
        <div>
          <el-button v-if="editing === room" link type="primary" @click="saveRename(room)">保存</el-button>
          <el-button v-else link type="primary" @click="startRename(room)">重命名</el-button>
          <el-button link type="danger" @click="removeRoom(room)">减少</el-button>
        </div>
      </div>
    </div>
    <template #footer><el-button @click="visible = false">完成</el-button></template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useClassroomCatalog } from '../composables/useClassroomCatalog';

const visible = defineModel<boolean>({ default: false });
const { classrooms, add, rename, remove } = useClassroomCatalog();
const newName = ref('');
const editing = ref('');
const editingName = ref('');

function addRoom() {
  if (!add(newName.value)) return ElMessage.warning('教室名称不能为空或已存在');
  newName.value = '';
}
function startRename(room: string) {
  editing.value = room;
  editingName.value = room;
}
function saveRename(room: string) {
  if (!rename(room, editingName.value)) return ElMessage.warning('教室名称不能为空或已存在');
  editing.value = '';
}
async function removeRoom(room: string) {
  await ElMessageBox.confirm(`确认减少教室“${room}”？已有课次中的教室名称不会被清除。`, '减少教室', { type: 'warning' });
  remove(room);
}
</script>

<style scoped>
.classroom-add, .classroom-row { display: flex; align-items: center; gap: 12px; }
.classroom-list { display: grid; gap: 8px; margin-top: 18px; }
.classroom-row { justify-content: space-between; min-height: 44px; padding: 6px 10px; border: 1px solid var(--el-border-color-lighter); border-radius: 7px; }
.classroom-row .el-input { flex: 1; }
</style>
