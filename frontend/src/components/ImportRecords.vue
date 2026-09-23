<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api';
import DialogFrame from './DialogFrame.vue';
import Icon from './Icon.vue';

const props = defineProps({ type: { type: String, required: true } });
const emit = defineEmits(['close']);
const records = ref([]),
  detail = ref(null),
  busy = ref(false),
  error = ref('');
const page = ref(1),
  total = ref(0),
  size = 20;
async function load(next = page.value) {
  busy.value = true;
  error.value = '';
  try {
    const result = await api(`/imports/${props.type}/logs?page=${next}&size=${size}`);
    records.value = result.items || [];
    total.value = Number(result.total || 0);
    page.value = result.page || next;
    detail.value = null;
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
async function open(record) {
  busy.value = true;
  error.value = '';
  try {
    detail.value = await api(`/imports/${props.type}/logs/${record.id}`);
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
function time(value) {
  return String(value || '—')
    .replace('T', ' ')
    .slice(0, 19);
}
function result(row) {
  const action =
    { ADDED: '新增', UPDATED: '更新', SKIPPED: '跳过', ERROR: '不导入', FAILED: '不导入' }[
      row.action
    ] ||
    row.action ||
    '—';
  return [action, ...(row.errors || []), ...(row.warnings || [])].filter(Boolean).join('；');
}
onMounted(() => load());
</script>

<template>
  <DialogFrame
    :title="detail ? '导入明细' : '导入记录'"
    wide
    :busy="busy"
    :error="error"
    @close="emit('close')"
  >
    <template v-if="detail">
      <p>{{ detail.fileName }} · {{ time(detail.createdAt) }}</p>
      <table class="tbl">
        <thead
          ><tr><th>行号</th><th>数据</th><th>处理结果</th></tr></thead
        >
        <tbody>
          <tr v-for="(row, i) in detail.rows || []" :key="i">
            <td>{{ row.index ?? i + 1 }}</td
            ><td>{{ row.label || row.entityId || '—' }}</td
            ><td style="white-space: normal">{{ result(row) }}</td>
          </tr>
          <tr v-if="!detail.rows?.length"><td colspan="3" class="v-empty">暂无导入明细</td></tr>
        </tbody>
      </table>
    </template>
    <template v-else>
      <table class="tbl">
        <thead
          ><tr
            ><th>文件名</th><th>导入时间</th><th>新增</th><th>更新</th><th>跳过</th
            ><th>操作</th></tr
          ></thead
        >
        <tbody>
          <tr v-for="record in records" :key="record.id">
            <td>{{ record.fileName }}</td
            ><td>{{ time(record.createdAt) }}</td
            ><td>{{ record.added || 0 }}</td
            ><td>{{ record.updated || 0 }}</td
            ><td>{{ record.skipped || 0 }}</td>
            <td><button class="v-link" @click="open(record)">查看明细</button></td>
          </tr>
          <tr v-if="!records.length"
            ><td colspan="6" class="v-empty">{{
              busy ? '正在加载导入记录…' : '暂无导入记录'
            }}</td></tr
          >
        </tbody>
      </table>
      <div v-if="total > size" class="pager">
        <span>共 {{ total }} 条记录</span>
        <button aria-label="导入记录上一页" :disabled="busy || page <= 1" @click="load(page - 1)"
          ><Icon name="e744"
        /></button>
        <button class="current">{{ page }}</button>
        <button
          aria-label="导入记录下一页"
          :disabled="busy || page * size >= total"
          @click="load(page + 1)"
          ><Icon name="e743"
        /></button>
      </div>
    </template>
    <template #footer>
      <button v-if="detail" class="btn" :disabled="busy" @click="detail = null">返回记录</button>
      <button class="btn" :disabled="busy" @click="emit('close')">关闭</button>
    </template>
  </DialogFrame>
</template>
