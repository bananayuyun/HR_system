<script setup>
import { ref, nextTick, onMounted } from 'vue';
import { api } from '../api';
import DialogFrame from './DialogFrame.vue';
import FieldControl from './FieldControl.vue';
import Icon from './Icon.vue';
const props = defineProps({ schema: Array, value: Object, route: String, userId: String });
const emit = defineEmits(['close', 'apply']);
const draft = ref(
    JSON.parse(
      JSON.stringify(
        props.value || {
          mode: 'all',
          rules: [{ field: props.schema[0]?.key, op: 'contains', value: '' }],
        },
      ),
    ),
  ),
  active = ref(-1),
  error = ref(''),
  nameInput = ref();
const schemes = ref([]),
  busy = ref(false);
onMounted(async () => {
  try {
    const p = await api('/preferences/' + props.route);
    if (Array.isArray(p.schemes)) schemes.value = p.schemes;
  } catch (e) {
    error.value = e.message;
  }
});
const ops = [
  { value: 'contains', label: '包含' },
  { value: 'eq', label: '等于' },
  { value: 'ne', label: '不等于' },
  { value: 'not', label: '不包含' },
  { value: 'empty', label: '为空' },
  { value: 'notempty', label: '不为空' },
];
async function persist() {
  busy.value = true;
  try {
    await api('/preferences/' + props.route, { method: 'PUT', body: { schemes: schemes.value } });
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
function validate() {
  if (
    draft.value.rules.some(
      (r) => !['empty', 'notempty'].includes(r.op) && !String(r.value || '').trim(),
    )
  ) {
    error.value = '请填写筛选值';
    return false;
  }
  error.value = '';
  return true;
}
async function addScheme() {
  active.value = schemes.value.length;
  draft.value.name = '';
  error.value = '';
  await nextTick();
  nameInput.value?.focus();
}
function saveScheme() {
  const name = String(draft.value.name || '').trim();
  if (!name) {
    error.value = '请填写方案名称';
    return;
  }
  if (schemes.value.some((s, i) => i !== active.value && s.name === name)) {
    error.value = '方案名称已存在';
    return;
  }
  if (!validate()) return;
  schemes.value[active.value] = JSON.parse(JSON.stringify({ ...draft.value, name }));
  persist();
}
function removeScheme(i) {
  schemes.value.splice(i, 1);
  active.value = -1;
  persist();
}
function apply() {
  if (validate()) emit('apply', JSON.parse(JSON.stringify(draft.value)));
}
</script>
<template>
  <DialogFrame title="高级筛选" advanced :error="error" :busy="busy" @close="emit('close')">
    <div class="w3-advanced-body">
      <aside class="w-schemes"
        ><h4>筛选方案</h4
        ><button class="btn w-scheme-add" @click="addScheme"><Icon name="plus" /> 添加</button>
        <div v-for="(s, i) in schemes" :key="i" class="w3-scheme-row"
          ><button
            class="w-scheme"
            :class="{ on: active === i }"
            @click="
              draft = JSON.parse(JSON.stringify(s));
              active = i;
              error = '';
            "
            >{{ s.name }}</button
          ><button class="w-tool" :aria-label="'删除方案' + s.name" @click="removeScheme(i)"
            ><Icon name="close" /></button
        ></div>
      </aside>
      <div class="w-conditions"
        ><h4>筛选条件</h4>
        <label v-if="active >= 0" class="w3-scheme-name"
          >方案名称
          <input
            ref="nameInput"
            v-model="draft.name"
            class="inp"
            placeholder="请输入方案名称"
            maxlength="40"
        /></label>
        <div class="w-conditions-top"
          ><FieldControl
            v-model="draft.mode"
            type="select"
            :options="[
              { value: 'all', label: '全部条件' },
              { value: 'any', label: '任一条件' },
            ]"
            label="条件匹配方式"
            required
          /><span class="w3-spacer" /><button class="btn" :disabled="active < 0" @click="saveScheme"
            >保存方案</button
          ><button
            class="btn pri-btn"
            @click="draft.rules.push({ field: schema[0]?.key, op: 'contains', value: '' })"
            >新增条件</button
          ></div
        >
        <div class="w3-conditions-list"
          ><div v-for="(r, i) in draft.rules" :key="i" class="w-condition"
            ><span class="w-condition-number">{{ i + 1 }}</span
            ><FieldControl
              v-model="r.field"
              type="select"
              :options="schema.map((f) => ({ value: f.key, label: f.label }))"
              :label="'条件' + (i + 1) + '字段'"
              required /><FieldControl
              v-model="r.op"
              type="select"
              :options="ops"
              :label="'条件' + (i + 1) + '关系'"
              required /><input
              v-model="r.value"
              class="inp"
              placeholder="请输入筛选值"
              :aria-label="'筛选值 ' + (i + 1)"
              :disabled="['empty', 'notempty'].includes(r.op)" /><button
              class="w-tool"
              :aria-label="'删除条件 ' + (i + 1)"
              @click="draft.rules.splice(i, 1)"
              ><Icon name="close" /></button></div
        ></div>
      </div>
    </div>
    <template #footer><button class="btn pri-btn" @click="apply">应用方案</button></template>
  </DialogFrame>
</template>
