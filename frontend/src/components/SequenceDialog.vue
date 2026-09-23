<script setup>
import { computed, onMounted, ref } from 'vue';
import DialogFrame from './DialogFrame.vue';
import FieldControl from './FieldControl.vue';
import { api } from '../api';
import { db, refresh } from '../store';

const emit = defineEmits(['close']);
const items = ref([...db.sequences]),
  name = ref(''),
  oldName = ref('');
const busy = ref(false),
  error = ref(''),
  form = ref(null);
const renaming = computed(() => Boolean(oldName.value));
const dirty = computed(() =>
  renaming.value ? name.value !== oldName.value : Boolean(name.value.trim()),
);

async function read() {
  const result = await api('/settings/sequences');
  items.value = [...(result.items || [])];
  db.sequences = [...items.value];
}
onMounted(async () => {
  busy.value = true;
  try {
    await read();
  } catch (cause) {
    error.value = cause.message;
  } finally {
    busy.value = false;
  }
});

function rename(value) {
  oldName.value = value;
  name.value = value;
  error.value = '';
}
function close() {
  if (!renaming.value) return emit('close');
  oldName.value = '';
  name.value = '';
  error.value = '';
}
async function persist(body) {
  busy.value = true;
  error.value = '';
  try {
    await api('/settings/sequences', { method: 'PUT', body });
    // Read the canonical configuration and related records after the transaction.
    await read();
    await refresh();
    oldName.value = '';
    name.value = '';
  } catch (cause) {
    error.value = cause.message;
  } finally {
    busy.value = false;
  }
}
async function save() {
  if (busy.value || !form.value.reportValidity()) return;
  const value = name.value.trim();
  if (!value) {
    error.value = '请填写序列名称。';
    return;
  }
  if (items.value.includes(value) && value !== oldName.value) {
    error.value = '序列名称已存在。';
    return;
  }
  if (renaming.value) await persist({ rename: { from: oldName.value, to: value } });
  else await persist({ items: [...items.value, value] });
}
async function remove(value) {
  if (busy.value) return;
  if (
    db.grades.some((row) => row.sequence === value) ||
    db.jobs.some((row) => row.sequence === value)
  ) {
    error.value = '该序列已关联职级或岗位，请先调整关联关系。';
    return;
  }
  await persist({ items: items.value.filter((item) => item !== value) });
}
</script>

<template>
  <DialogFrame
    :key="renaming ? 'rename' : 'manage'"
    :title="renaming ? '重命名职务序列' : '管理职务序列'"
    narrow
    :busy="busy"
    :error="error"
    :dirty="dirty"
    @close="close"
  >
    <template v-if="!renaming">
      <div class="v-hint"
        >序列用于组织职级和岗位。修改名称后同步更新关联职级和岗位；已有职级的序列不能删除。</div
      >
      <div id="sequence-list"
        ><div v-for="item in items" :key="item" class="v-columns"
          ><span>{{ item }}</span
          ><button class="v-link" :disabled="busy" @click="rename(item)">重命名</button
          ><button class="v-link" :disabled="busy" @click="remove(item)">删除</button></div
        ></div
      >
    </template>
    <form
      id="edit-form"
      ref="form"
      :style="renaming ? undefined : { marginTop: '20px' }"
      @submit.prevent="save"
    >
      <div class="v-form"
        ><div class="v-field"
          ><label for="field-sequence-name"
            ><i>*</i>{{ renaming ? '序列名称' : '新增序列名称' }}</label
          ><FieldControl
            v-model="name"
            name="sequence-name"
            :label="renaming ? '序列名称' : '新增序列名称'"
            required
            :disabled="busy"
          /><span v-if="!renaming" class="help">例如：技术序列 T、销售序列 S</span></div
        ></div
      >
    </form>
    <template #footer="{ requestClose }"
      ><button class="btn" :disabled="busy" @click="requestClose">{{
        renaming ? '取消' : '关闭'
      }}</button
      ><button class="btn pri-btn" :disabled="busy" @click="save">确定</button></template
    >
  </DialogFrame>
</template>
