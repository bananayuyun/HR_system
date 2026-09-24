<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref } from 'vue';
import { api } from '../api';
import DialogFrame from './DialogFrame.vue';
import FieldControl from './FieldControl.vue';

const props = defineProps({ db: { type: Object, default: () => ({}) } });
const emit = defineEmits(['close', 'saved']);
const form = reactive({ req: '', source: 'Boss 直聘', workRegion: '', workplace: '' });
const rows = ref([]),
  error = ref(''),
  busy = ref(false),
  progress = ref(''),
  activeIndex = ref(-1),
  previewPanel = ref(null);
const attempted = ref(false);
let readVersion = 0;
const sources = ['Boss 直聘', '内部推荐', '猎聘', '其它'];
const requests = computed(() => (props.db.reqs || []).filter((row) => row.status === '招聘中'));
const requestOptions = computed(() =>
  requests.value.map((row) => ({
    value: row.id,
    label: `${row.name} / ${(props.db.orgs || []).find((org) => org.id === row.dept)?.name || row.department || row.dept || '—'}`,
  })),
);
const selectedRequest = computed(() => requests.value.find((row) => row.id === form.req));
const regionOptions = computed(() => activeDictionary('workRegion'));
const workplaceOptions = computed(() => activeDictionary('workplace'));
const ready = computed(() => Boolean(form.source));
const savedCount = computed(() => rows.value.filter((row) => row.status === 'saved').length);
const remaining = computed(() => rows.value.filter((row) => row.status !== 'saved'));
const hasPending = computed(() => remaining.value.length > 0);
const hasResult = computed(
  () => attempted.value && !remaining.value.length && rows.value.length > 0,
);
const active = computed(() => rows.value[activeIndex.value]);

function activeDictionary(key) {
  return (props.db.baseSettings?.[key] || [])
    .filter(
      (item) => typeof item === 'string' || !['停用', 'DISABLED', 'INACTIVE'].includes(item.status),
    )
    .map((item) => (typeof item === 'string' ? item : item.name));
}
function requestChanged() {
  form.workRegion = selectedRequest.value?.workRegion || selectedRequest.value?.location || '';
  form.workplace = selectedRequest.value?.workplace || '';
  error.value = '';
  attempted.value = false;
}
function cleanGuessedName(name) {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/简历|个人|求职|_|\d/g, '')
    .trim();
}
function releaseRows() {
  for (const row of rows.value) if (row.url) URL.revokeObjectURL(row.url);
}
function fileIssue(file) {
  if (!/\.(pdf|docx|png|jpe?g|webp)$/i.test(file.name))
    return '仅支持 PDF、Word（.docx）和图片；旧版 .doc 请先转换。';
  if (!file.size) return '文件为空。';
  if (file.size > 20 * 1024 * 1024) return '文件超过 20 MB。';
  return '';
}
async function readFiles(event) {
  if (busy.value || savedCount.value) return;
  const files = [...(event.target.files || [])];
  if (!files.length) return;
  error.value = '';
  if (files.length > 30) {
    error.value = '单次最多录入 30 份简历。';
    event.target.value = '';
    return;
  }
  const invalid = files
    .map((file) => ({ name: file.name, message: fileIssue(file) }))
    .filter((item) => item.message);
  if (invalid.length) {
    error.value = invalid.map((item) => `${item.name}：${item.message}`).join('\n');
    event.target.value = '';
    return;
  }
  const version = ++readVersion;
  releaseRows();
  rows.value = [];
  activeIndex.value = -1;
  attempted.value = false;
  busy.value = true;
  rows.value = files.map((file) => ({
    file,
    name: cleanGuessedName(file.name),
    phone: '',
    email: '',
    raw: '',
    issue: '',
    url: URL.createObjectURL(file),
    status: 'parsing',
    failure: '',
    candidateId: '',
  }));
  try {
    for (let index = 0; index < rows.value.length; index++) {
      if (version !== readVersion) return;
      const row = rows.value[index];
      progress.value = `正在读取第 ${index + 1} / ${files.length} 份简历…`;
      try {
        const body = new FormData();
        body.append('file', row.file);
        const result = await api('/resumes/parse', { method: 'POST', body });
        if (version !== readVersion) return;
        if (!result || typeof result !== 'object') throw new Error('服务器未返回有效的解析结果。');
        row.raw = String(result.raw || '').slice(0, 200000);
        row.name = String(result.name || row.name).trim();
        row.phone = String(result.phone || '').trim();
        row.email = String(result.email || '').trim();
        row.issue =
          result.issue || (result.parsed && row.raw ? '' : '未提取到可用文本，请人工核对原文件。');
      } catch (cause) {
        if (version !== readVersion) return;
        row.issue = `文本读取未完成：${cause.message || '请人工核对原文件。'}`;
        if ([401, 403].includes(cause.status)) {
          error.value = cause.message;
          break;
        }
      } finally {
        if (version === readVersion) row.status = 'pending';
      }
    }
  } finally {
    if (version === readVersion) {
      busy.value = false;
      progress.value = '';
      for (const row of rows.value)
        if (row.status === 'parsing') {
          row.status = 'pending';
          row.issue = '尚未解析，请人工核对原文件。';
        }
    }
    event.target.value = '';
  }
}
async function showPreview(index) {
  activeIndex.value = index;
  await nextTick();
  previewPanel.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function validate() {
  if (!ready.value) return '请选择简历来源。';
  if (!rows.value.length) return '请先选择并核对简历文件。';
  const phones = new Set();
  for (let index = 0; index < rows.value.length; index++) {
    const row = rows.value[index];
    row.name = row.name.trim();
    row.phone = row.phone.trim();
    if (!row.name) return `第 ${index + 1} 行：姓名不能为空或仅包含空格。`;
    if (!/^1\d{10}$/.test(row.phone)) return `第 ${index + 1} 行：请填写 11 位手机号。`;
    if (phones.has(row.phone)) return `第 ${index + 1} 行：本批次手机号重复，避免重复录入。`;
    phones.add(row.phone);
    if (
      row.status !== 'saved' &&
      (props.db.candidates || []).some(
        (candidate) => candidate.req === form.req && candidate.phone === row.phone,
      )
    )
      return `第 ${index + 1} 行：同一招聘需求下已有该手机号，避免重复录入。`;
  }
  return '';
}
function candidateData(row) {
  const data = {
    source: form.source,
    name: row.name,
    phone: row.phone,
    email: row.email,
    education: '待核对',
    years: 0,
    notes: row.raw.slice(0, 20000) || '请查看原始简历并补充候选人信息。',
  };
  if (form.req) data.req = form.req;
  if (form.workRegion) data.workRegion = form.workRegion;
  if (form.workplace) data.workplace = form.workplace;
  const company = selectedRequest.value?.contractCompany || selectedRequest.value?.company;
  if (company) data.contractCompany = company;
  return data;
}
async function commit() {
  if (busy.value || !remaining.value.length) return;
  error.value = validate();
  if (error.value) return;
  const version = readVersion;
  busy.value = true;
  attempted.value = true;
  const pending = [...remaining.value];
  try {
    for (let index = 0; index < pending.length; index++) {
      const row = pending[index];
      if (version !== readVersion) return;
      progress.value = `正在录入第 ${index + 1} / ${pending.length} 份简历…`;
      row.failure = '';
      row.status = 'saving';
      try {
        const body = new FormData();
        body.append('file', row.file);
        body.append('data', JSON.stringify(candidateData(row)));
        const created = await api('/resumes', { method: 'POST', body });
        if (version !== readVersion) return;
        if (!created?.id) throw new Error('服务器未返回候选人编号，请先检查简历库后再重试。');
        row.candidateId = created.id;
        row.status = 'saved';
      } catch (cause) {
        if (version !== readVersion) return;
        row.status = 'failed';
        row.failure = cause.message || '录入失败，请检查后重试。';
        if ([401, 403].includes(cause.status)) {
          error.value = cause.message;
          break;
        }
      }
    }
  } finally {
    if (version === readVersion) {
      busy.value = false;
      progress.value = '';
    }
  }
}
function outcome() {
  return `已录入 ${savedCount.value} 份简历并保存原附件，${form.req ? '进入 HR 筛选' : '可在简历库中预览并稍后关联需求'}${remaining.value.length ? `；另有 ${remaining.value.length} 份尚未录入` : ''}。`;
}
function finish() {
  if (savedCount.value) emit('saved', outcome());
  else emit('close');
}
onBeforeUnmount(() => {
  readVersion++;
  releaseRows();
});
</script>

<template>
  <DialogFrame
    title="批量录入简历"
    wide
    :busy="busy"
    :error="error"
    :dirty="hasPending"
    :leave-message="
      '当前仍有简历尚未录入，确定放弃更改吗？' +
      (savedCount ? '已录入的 ' + savedCount + ' 份简历及附件将保留。' : '')
    "
    @close="finish"
  >
    <form id="resume-form" @submit.prevent="commit">
      <div class="v-form">
        <div class="v-field"
          ><label for="field-resume-req">关联招聘需求（可稍后关联）</label
          ><FieldControl
            v-model="form.req"
            name="resume-req"
            label="关联招聘需求"
            type="select"
            :options="requestOptions"
            :disabled="busy || savedCount > 0"
            @change="requestChanged"
        /></div>
        <div class="v-field"
          ><label for="field-resume-source"><i>*</i>简历来源</label
          ><FieldControl
            v-model="form.source"
            name="resume-source"
            label="简历来源"
            type="select"
            :options="sources"
            required
            :disabled="busy || savedCount > 0"
        /></div>
        <div class="v-field"
          ><label for="field-resume-region">工作片区</label
          ><FieldControl
            v-model="form.workRegion"
            name="resume-region"
            label="工作片区"
            type="select"
            :options="regionOptions"
            :disabled="busy || savedCount > 0"
        /></div>
        <div class="v-field"
          ><label for="field-resume-workplace">工作所在地</label
          ><FieldControl
            v-model="form.workplace"
            name="resume-workplace"
            label="工作所在地"
            type="select"
            :options="workplaceOptions"
            :disabled="busy || savedCount > 0"
        /></div>
      </div>
      <label
        class="v-file-box resume-files"
        :class="{ 'resume-files-disabled': busy || savedCount > 0 }"
        >选择已收集的简历
        <input
          type="file"
          accept=".pdf,.docx,.png,.jpg,.jpeg,.webp"
          multiple
          :disabled="busy || savedCount > 0"
          aria-label="批量选择简历文件"
          @change="readFiles"
        />
        <span class="v-muted"
          >可一次选择多个 PDF、Word（.docx）或图片，每个文件不超过 20 MB，单次最多 30 份。旧版 .doc
          请先转换为 .docx。</span
        >
      </label>
      <div class="v-hint"
        >可以先上传简历，再关联招聘需求。文本提取仅辅助核对，扫描 PDF
        与图片需人工填写。姓名、联系方式需核对后再录入，不自动评分；确认录入后保存原始附件。</div
      >
      <p v-if="busy" class="v-muted" role="status">{{ progress }}</p>
      <div v-if="attempted && !busy" class="v-hint" role="status"
        >{{ outcome()
        }}<span v-if="remaining.length"
          >请根据逐份说明修正后重试，已成功录入的记录不会再次提交。</span
        ></div
      >
      <section v-if="rows.length" id="resume-preview">
        <h4 class="sec-h">核对 {{ rows.length }} 份简历</h4>
        <table class="v-mini-table"
          ><thead
            ><tr
              ><th>文件</th><th>姓名（必填）</th><th>手机号（必填）</th><th>读取情况</th></tr
            ></thead
          >
          <tbody
            ><tr v-for="(row, index) in rows" :key="index"
              ><td
                >{{ row.file.name }}<br /><button
                  type="button"
                  class="v-link"
                  @click="showPreview(index)"
                  >预览</button
                ></td
              ><td
                ><input
                  v-model="row.name"
                  class="inp"
                  :aria-label="`第${index + 1}份简历姓名`"
                  required
                  :disabled="busy || row.status === 'saved'" /></td
              ><td
                ><input
                  v-model="row.phone"
                  class="inp"
                  type="tel"
                  maxlength="11"
                  :aria-label="`第${index + 1}份简历手机号`"
                  required
                  :disabled="busy || row.status === 'saved'" /></td
              ><td
                ><span v-if="row.status === 'saved'" class="resume-success"
                  >已录入 {{ row.candidateId }}，原附件已保存</span
                ><span v-else-if="row.status === 'saving'">正在录入…</span
                ><span v-else-if="row.status === 'parsing'">正在读取…</span
                ><span v-else-if="row.failure" class="resume-error">{{ row.failure }}</span
                ><span v-else>{{
                  row.issue || (row.raw ? '已读取文本，请核对' : '待人工核对')
                }}</span></td
              ></tr
            ></tbody
          >
        </table>
        <div v-if="active" id="batch-inline-preview" ref="previewPanel">
          <h4 class="sec-h">{{ active.file.name }}</h4>
          <object
            v-if="/\.pdf$/i.test(active.file.name)"
            class="v-preview"
            type="application/pdf"
            :data="active.url"
            ><p>浏览器不支持 PDF 内嵌预览，请下载原文件查看。</p></object
          >
          <img
            v-else-if="/\.(png|jpe?g|webp)$/i.test(active.file.name)"
            class="v-preview"
            :src="active.url"
            :alt="active.file.name"
          />
          <template v-else
            ><div v-if="active.raw" class="v-document">{{ active.raw }}</div
            ><div v-else class="v-hint">Word 文本暂不可预览，请下载原文件查看。</div
            ><p class="v-muted">Word 文本预览，原始排版请下载文件查看。</p></template
          >
          <a class="v-link" :href="active.url" :download="active.file.name">下载原文件</a>
        </div>
      </section>
    </form>
    <template #footer="{ requestClose }"
      ><button class="btn" :disabled="busy" @click="requestClose">{{
        hasResult ? '完成' : '取消'
      }}</button
      ><button
        v-if="!hasResult"
        class="btn pri-btn"
        :disabled="busy || !rows.length || !ready"
        @click="commit"
        >{{
          busy && attempted ? '正在录入…' : attempted ? '重试未成功项' : form.req ? '确认录入待筛选' : '确认录入简历库'
        }}</button
      ></template
    >
  </DialogFrame>
</template>

<style scoped>
.resume-files {
  margin-top: 20px;
}
.resume-files-disabled {
  opacity: 0.6;
}
.resume-error {
  color: #d40000;
}
.resume-success {
  color: #07843f;
}
.v-mini-table td:first-child {
  max-width: 260px;
  overflow-wrap: anywhere;
}
.v-mini-table td:nth-child(2),
.v-mini-table td:nth-child(3) {
  min-width: 140px;
}
.v-mini-table td:last-child {
  max-width: 280px;
  overflow-wrap: anywhere;
}
button.v-link {
  background: none;
  border: 0;
  padding: 0;
  color: #1555d4;
  cursor: pointer;
  font: inherit;
}
.v-preview {
  display: block;
  margin-bottom: 12px;
}
</style>
