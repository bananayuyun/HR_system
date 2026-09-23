<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { api } from '../api';
import DialogFrame from './DialogFrame.vue';
import FieldControl from './FieldControl.vue';
import metadata from '../config/prototype-metadata.json';

const props = defineProps({
  type: { type: String, required: true },
  employeeId: [String, Number],
  db: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['close', 'saved']);
const config = computed(() => metadata.importConfig[props.type]);
const fields = computed(() => config.value?.fields || []);
const fileName = ref(''),
  fileHash = ref(''),
  sheetName = ref('');
const headers = ref([]),
  rawRows = ref([]),
  sourceLines = ref([]),
  mapping = ref({});
const mode = ref('skip'),
  preview = ref(null),
  result = ref(null),
  error = ref('');
const busy = ref(false),
  busyLabel = ref(''),
  dictionaryRows = ref(0);
let readVersion = 0;
const step = computed(() => (result.value ? 3 : rawRows.value.length ? 2 : 1));
const mappedCount = computed(() => Object.values(mapping.value).filter(isMappedColumn).length);
const report = computed(() => result.value || preview.value);
const reportRows = computed(() => report.value?.rows || []);
const writable = computed(
  () => Number(preview.value?.added || 0) + Number(preview.value?.updated || 0),
);
const hasPending = computed(() => rawRows.value.length > 0 && !result.value);
const columnOptions = computed(() => [
  { value: '-1', label: '不导入' },
  ...headers.value.map((label, value) => ({
    value: String(value),
    label: `${value + 1}. ${label || '（空表头）'}`,
  })),
]);

function normalizeHeader(value) {
  return String(value ?? '')
    .trim()
    .replace(/[\s*＊]/g, '')
    .toUpperCase();
}
function isMappedColumn(value) {
  return /^\d+$/.test(String(value)) && Number(value) < headers.value.length;
}
function cellText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (Array.isArray(value.richText))
      return value.richText.map((part) => part.text || '').join('');
    if ('result' in value) return cellText(value.result);
    if ('text' in value) return String(value.text);
    return '';
  }
  return String(value).trim();
}
function parseCsv(text) {
  const rows = [];
  let row = [],
    cell = '',
    quoted = false;
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delimiter = firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (quoted || cell === '') quoted = !quoted;
      else cell += char;
    } else if (char === delimiter && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (quoted) throw new Error('CSV 文件存在未闭合的引号，请检查文件内容。');
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
function decodeCsv(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(bytes).replace(/^\uFEFF/, '');
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder('utf-16be').decode(bytes).replace(/^\uFEFF/, '');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('gb18030').decode(bytes).replace(/^\uFEFF/, '');
  }
}
async function createWorkbook() {
  const excel = await import('exceljs');
  const Workbook = excel.default?.Workbook || excel.Workbook;
  return new Workbook();
}
function dictionaryValues(key) {
  const collection =
    props.db.baseSettings?.[key] ||
    props.db.dictionary?.[key] ||
    props.db.dictionaries?.[key] ||
    [];
  return Array.isArray(collection)
    ? collection
        .map((item) => (typeof item === 'string' ? item : item.name || item.itemName))
        .filter(Boolean)
    : [];
}
function isDictionaryRow(row, currentHeaders) {
  if (props.type !== 'emps') return false;
  const byTitle = Object.fromEntries(
    currentHeaders.map((title, index) => [normalizeHeader(title), row[index]]),
  );
  if (cellText(byTitle['工号']) || cellText(byTitle['姓名'])) return false;
  const options = {
    合同归属: dictionaryValues('contractCompany'),
    工作片区: dictionaryValues('workRegion'),
    工作所在地: dictionaryValues('workplace'),
    部门: (props.db.orgs || []).map((org) => org.name),
    组别: (props.db.orgs || []).map((org) => org.name),
    职位: (props.db.jobs || []).map((job) => job.name),
    户籍类型: ['城镇', '农业'],
  };
  const populated = row
    .map((value, index) => [normalizeHeader(currentHeaders[index]), cellText(value)])
    .filter(([, value]) => value);
  return (
    populated.length > 0 &&
    populated.every(
      ([title, value]) =>
        options[title]?.includes(value) ||
        (options[title] && ['(空白)', '（空白）'].includes(value)),
    )
  );
}
function acceptSheet(rows, offset = 0) {
  let headerIndex =
    props.type === 'emps'
      ? rows.findIndex(
          (row) =>
            row.some((value) => normalizeHeader(value) === '工号') &&
            row.some((value) => normalizeHeader(value) === '姓名'),
        )
      : rows.findIndex((row) => row.some((value) => cellText(value)));
  if (headerIndex < 0)
    throw new Error(
      props.type === 'emps' ? '未找到包含“工号、姓名”的表头。' : '表格没有可识别的表头。',
    );
  const nextHeaders = rows[headerIndex].map(cellText),
    nextRows = [],
    nextLines = [];
  let ignored = 0;
  rows.slice(headerIndex + 1).forEach((row, index) => {
    const values = row.map(cellText);
    if (!values.some(Boolean)) return;
    if (isDictionaryRow(values, nextHeaders)) {
      ignored++;
      return;
    }
    nextRows.push(values);
    nextLines.push(offset + headerIndex + index + 2);
  });
  if (!nextRows.length) throw new Error('未发现可导入的数据行。');
  if (nextRows.length > 2000) throw new Error('单次最多导入 2,000 条记录，请拆分后导入。');
  headers.value = nextHeaders;
  rawRows.value = nextRows;
  sourceLines.value = nextLines;
  dictionaryRows.value = ignored;
  mapping.value = Object.fromEntries(
    fields.value.map(([key, label, , aliases = []]) => [
      key,
      String(
        nextHeaders.findIndex((title) =>
          [label, ...aliases].some((alias) => normalizeHeader(alias) === normalizeHeader(title)),
        ),
      ),
    ]),
  );
}
function invalidate() {
  preview.value = null;
  result.value = null;
  error.value = '';
}
async function chooseFile(event) {
  const file = event.target.files?.[0];
  if (!file || busy.value) return;
  const version = ++readVersion;
  error.value = '';
  preview.value = null;
  result.value = null;
  rawRows.value = [];
  headers.value = [];
  fileHash.value = '';
  if (!config.value) {
    error.value = '不支持的导入类型。';
    return;
  }
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
    error.value = '请选择 Excel（.xlsx / .xls）或 CSV 文件。';
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    error.value = '文件不能超过 20 MB。';
    return;
  }
  if (!file.size) {
    error.value = '文件为空，请重新选择。';
    return;
  }
  busy.value = true;
  busyLabel.value = '正在读取文件…';
  fileName.value = file.name;
  try {
    const buffer = await file.arrayBuffer();
    if (!globalThis.crypto?.subtle)
      throw new Error('当前连接无法计算文件校验值，请使用 HTTPS 或本机 localhost 地址访问。');
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    let rows,
      sourceOffset = 0;
    if (/\.csv$/i.test(file.name)) {
      rows = parseCsv(decodeCsv(buffer));
      sheetName.value = 'CSV';
    } else if (/\.xls$/i.test(file.name)) {
      const form = new FormData();
      form.append('file', file);
      const parsed = await api(`/imports/${props.type}/parse`, { method: 'POST', body: form });
      if (!Array.isArray(parsed?.headers) || !Array.isArray(parsed?.rows))
        throw new Error('服务器未返回有效的表格内容。');
      rows = [parsed.headers, ...parsed.rows];
      sheetName.value = parsed.sheetName || '工作表';
      sourceOffset = Math.max(0, Number(parsed.headerRow || 1) - 1);
    } else {
      const workbook = await createWorkbook();
      await workbook.xlsx.load(buffer);
      const worksheet =
        props.type === 'emps'
          ? workbook.getWorksheet('文档花名册') || workbook.worksheets[0]
          : workbook.worksheets[0];
      if (!worksheet) throw new Error('Excel 中没有工作表。');
      if (worksheet.rowCount > 100000) throw new Error('工作表范围过大，请清除多余空白行后重试。');
      rows = [];
      worksheet.eachRow({ includeEmpty: true }, (row) =>
        rows.push(
          Array.from({ length: Math.max(row.cellCount, worksheet.columnCount) }, (_, index) =>
            cellText(row.getCell(index + 1).value),
          ),
        ),
      );
      sheetName.value = worksheet.name;
    }
    if (version !== readVersion) return;
    acceptSheet(rows, sourceOffset);
    fileHash.value = hash;
  } catch (cause) {
    if (version === readVersion)
      error.value = cause.message || '文件读取失败，请确认格式正确且未加密。';
  } finally {
    if (version === readVersion) {
      busy.value = false;
      busyLabel.value = '';
    }
    event.target.value = '';
  }
  if (version === readVersion && props.type === 'emps' && rawRows.value.length && !error.value)
    await validate();
}
function mappedRows() {
  return rawRows.value.map((row) => {
    const values = {};
    for (const [key] of fields.value) {
      const column = mapping.value[key];
      if (!isMappedColumn(column)) continue;
      const value = cellText(row[column]);
      // Omit blank cells so an update cannot clear an existing value.
      if (value !== '') values[key] = value;
    }
    return values;
  });
}
function requestBody(validateOnly) {
  const body = {
    fileName: fileName.value,
    fileHash: fileHash.value,
    rows: mappedRows(),
    mode: mode.value,
    validateOnly,
  };
  if (props.employeeId !== undefined && props.employeeId !== null)
    body.employeeId = props.employeeId;
  return body;
}
function normalizeReport(response) {
  if (!response || typeof response !== 'object' || !Array.isArray(response.rows))
    throw new Error('服务器未返回逐行校验结果，请重试。');
  const original = mappedRows();
  return {
    ...response,
    rows: response.rows.map((row, index) => ({
      ...row,
      index: Number(row.index || index + 1),
      errors: row.errors || [],
      warnings: row.warnings || [],
      data: row.data || original[index] || {},
    })),
  };
}
async function validate() {
  if (busy.value || !rawRows.value.length) return;
  error.value = '';
  result.value = null;
  preview.value = null;
  const missing = fields.value.filter(
    ([key, , required]) => required && !isMappedColumn(mapping.value[key]),
  );
  if (missing.length) {
    error.value = `请映射必填列：${missing.map(([, label]) => label).join('、')}`;
    return;
  }
  if (!fileHash.value) {
    error.value = '文件校验值缺失，请重新选择文件。';
    return;
  }
  if (props.type === 'timeline' && !props.employeeId) {
    error.value = '请从员工档案中导入成长记录。';
    return;
  }
  const version = readVersion;
  busy.value = true;
  busyLabel.value = '正在校验数据…';
  try {
    const response = await api(`/imports/${props.type}`, {
      method: 'POST',
      body: requestBody(true),
    });
    if (version === readVersion) preview.value = normalizeReport(response);
  } catch (cause) {
    if (version === readVersion) error.value = cause.message || '校验失败，请重试。';
  } finally {
    if (version === readVersion) {
      busy.value = false;
      busyLabel.value = '';
    }
  }
}
async function commit() {
  if (busy.value || !preview.value || !writable.value) return;
  const version = readVersion;
  error.value = '';
  busy.value = true;
  busyLabel.value = '正在写入数据库…';
  try {
    const response = await api(`/imports/${props.type}`, {
      method: 'POST',
      body: requestBody(false),
    });
    if (version === readVersion) result.value = normalizeReport(response);
  } catch (cause) {
    if (version === readVersion)
      error.value = cause.message || '导入失败，请重试。';
  } finally {
    if (version === readVersion) {
      busy.value = false;
      busyLabel.value = '';
    }
  }
}
async function downloadTemplate() {
  if (busy.value || !config.value) return;
  error.value = '';
  busy.value = true;
  busyLabel.value = '正在生成模板…';
  try {
    const workbook = await createWorkbook();
    const sheet = workbook.addWorksheet(props.type === 'emps' ? '文档花名册' : '数据');
    sheet.addRow(fields.value.map(([, label]) => label));
    sheet.columns.forEach((column) => {
      column.width = 22;
    });
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    const blob = new Blob([await workbook.xlsx.writeBuffer()], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob),
      anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${config.value.title}模板.xlsx`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (cause) {
    error.value = cause.message || '模板生成失败，请重试。';
  } finally {
    busy.value = false;
    busyLabel.value = '';
  }
}
function originalLine(row) {
  return sourceLines.value[row.index - 1] || row.index + 1;
}
function messageFor(row) {
  return [...row.errors, ...row.warnings].join('；') || '通过';
}
function resultMessage(value) {
  const count = Number(value?.added || 0) + Number(value?.updated || 0);
  return `${count ? '导入完成' : '本次没有写入记录'}：新增 ${value?.added || 0} 条，更新 ${value?.updated || 0} 条，跳过 ${value?.skipped || 0} 条，错误 ${value?.errorCount || 0} 条。`;
}
function frameClose() {
  if (result.value) emit('saved', resultMessage(result.value));
  else emit('close');
}
watch(
  () => [props.type, props.employeeId],
  () => {
    readVersion++;
    rawRows.value = [];
    headers.value = [];
    fileName.value = '';
    fileHash.value = '';
    preview.value = null;
    result.value = null;
    error.value = '';
    mode.value = 'skip';
    busy.value = false;
    busyLabel.value = '';
  },
);
onBeforeUnmount(() => {
  readVersion++;
});
</script>

<template>
  <DialogFrame
    :title="config?.title || '导入数据'"
    wide
    :busy="busy"
    :error="error"
    :dirty="hasPending"
    @close="frameClose"
  >
    <div class="v-steps" aria-label="导入进度">
      <component :is="step === 1 ? 'b' : 'span'">1 选择表格</component><span>→</span>
      <component :is="step === 2 ? 'b' : 'span'">2 字段映射与核对</component><span>→</span>
      <component :is="step === 3 ? 'b' : 'span'">3 导入结果</component>
    </div>
    <template v-if="!result">
      <div class="v-hint"
        >{{
          type === 'emps'
            ? '按公司内部花名册的 58 列自动匹配；按工号新增或更新。工作片区与工作所在地分别保存，部门和组别匹配已有组织。'
            : type === 'reqs'
              ? '导入已有招聘需求表格，维护需求、岗位及面试负责人。'
              : '使用模板整理数据后导入。'
        }}
        支持 Excel（.xlsx / .xls）和 CSV，单次最多 2,000 行。数据经服务端校验后写入数据库。</div
      >
      <label class="v-file-box"
        >上传 {{ config?.title.replace('导入', '') || '数据' }} 文件
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          :disabled="busy"
          aria-label="上传导入文件"
          @change="chooseFile"
        />
        <span class="v-muted">文件不超过 20 MB；先核对校验结果，再确认导入。</span>
      </label>
      <div class="v-drawer-actions"
        ><button class="btn" :disabled="busy" @click="downloadTemplate">下载导入模板</button></div
      >
      <p v-if="busy" class="v-muted" role="status">{{ busyLabel }}</p>
      <section v-if="rawRows.length" id="import-content">
        <p class="v-muted"
          >{{ fileName }} · {{ sheetName }} · {{ rawRows.length }} 条记录<span v-if="dictionaryRows"
            >；已忽略 {{ dictionaryRows }} 行选项清单</span
          >。空白可选字段不覆盖已有内容。</p
        >
        <div v-if="type === 'emps'" class="v-hint"
          >工号、姓名、部门缺失，表内工号重复，日期或手机号无效的行不会导入。职级、职位未匹配和基础信息未预置会标橙色提示；合法记录仍可确认导入。</div
        >
        <details class="roster-import-mapping" :open="type !== 'emps'">
          <summary>字段匹配：已识别 {{ mappedCount }} / {{ fields.length }} 列 · 展开调整</summary>
          <table class="v-mini-table"
            ><thead
              ><tr><th>系统字段</th><th>表格列</th></tr></thead
            >
            <tbody
              ><tr v-for="[key, label, required] in fields" :key="key"
                ><td><span v-if="required" class="import-required">* </span>{{ label }}</td
                ><td
                  ><FieldControl
                    v-model="mapping[key]"
                    type="select"
                    :label="`匹配${label}`"
                    :options="columnOptions"
                    :disabled="busy"
                    @change="invalidate" /></td></tr
            ></tbody>
          </table>
        </details>
        <div v-if="type !== 'timeline'" class="v-filter import-mode"
          ><label>已存在的数据：</label
          ><FieldControl
            v-model="mode"
            type="select"
            label="已存在的数据处理方式"
            :disabled="busy"
            :options="[
              { value: 'skip', label: '跳过重复记录' },
              { value: 'update', label: '按唯一编码更新已有记录' },
            ]"
            @change="invalidate"
        /></div>
      </section>
    </template>
    <section v-if="report" id="import-preview" aria-live="polite">
      <h4 class="sec-h">{{ result ? '导入结果' : type === 'emps' ? '导入核对' : '校验结果' }}</h4>
      <div
        class="v-hint"
        :class="{
          'import-result-error':
            result &&
            !Number(result.added) &&
            !Number(result.updated) &&
            Number(result.errorCount),
        }"
      >
        <template v-if="result"
          >{{ resultMessage(result)
          }}<span v-if="Number(result.errorCount)"
            >请根据下方逐行说明修正错误，重新上传修正后的文件。</span
          ></template
        >
        <template v-else
          >共 {{ rawRows.length }} 行；新增 {{ preview.added || 0 }}，更新
          {{ preview.updated || 0 }}，跳过 {{ preview.skipped || 0 }}，错误
          {{ preview.errorCount || 0 }}。{{
            writable
              ? '核对无误后点击确认导入；服务端将再次校验并写入合法记录。'
              : '本次没有可写入的记录。'
          }}</template
        >
      </div>
      <div v-if="reportRows.length" class="import-preview-table">
        <table class="v-mini-table"
          ><thead
            ><tr
              ><th>原表行</th><th>{{ type === 'emps' ? '工号 / 姓名' : '名称 / 记录' }}</th
              ><template v-if="type === 'emps'"
                ><th>部门 / 组别 / 职位</th><th>片区 / 所在地</th></template
              ><th>处理</th><th>核对说明</th></tr
            ></thead
          >
          <tbody
            ><tr v-for="row in reportRows" :key="row.index"
              ><td>{{ originalLine(row) }}</td
              ><td
                >{{ row.data.id || row.data.code || row.data.date || '—' }}<br />{{
                  row.data.name || row.data.title || row.data.type || ''
                }}</td
              ><template v-if="type === 'emps'"
                ><td
                  >{{ row.data.department || row.data.pendingDepartment || '—' }} /
                  {{ row.data.group || row.data.pendingGroup || '直属部门' }}<br />{{
                    row.data.pendingJob || row.data.job || '—'
                  }}</td
                ><td
                  >{{ row.data.workRegion || row.data.location || '待补充' }} /
                  {{ row.data.workplace || '待补充' }}</td
                ></template
              ><td>{{ row.action }}</td
              ><td
                :class="
                  row.errors.length
                    ? 'import-required'
                    : row.warnings.length
                      ? 'import-warning'
                      : ''
                "
                >{{ messageFor(row) }}</td
              ></tr
            ></tbody
          >
        </table>
      </div>
    </section>
    <template #footer="{ requestClose }">
      <button class="btn" :disabled="busy" @click="requestClose">{{
        result ? '完成' : '取消'
      }}</button>
      <template v-if="!result"
        ><button class="btn" :disabled="busy || !rawRows.length" @click="validate">{{
          busy && busyLabel.includes('校验') ? '校验中…' : '校验数据'
        }}</button
        ><button
          class="btn pri-btn"
          :disabled="busy || !preview || !writable"
          @click="commit"
          >{{ busy && busyLabel.includes('写入') ? '正在导入…' : '确认导入' }}</button
        ></template
      >
    </template>
  </DialogFrame>
</template>

<style scoped>
.import-preview-table {
  max-height: 360px;
  overflow: auto;
}
.import-required {
  color: #d40000;
}
.import-warning {
  color: #ed6a0c;
}
.import-mode > .w3-control {
  width: 260px;
}
.import-result-error {
  border-left-color: #d40000;
  color: #d40000;
}
.roster-import-mapping {
  margin-bottom: 16px;
}
.roster-import-mapping summary {
  cursor: pointer;
  color: #1555d4;
  margin-bottom: 12px;
}
.roster-import-mapping td:last-child {
  min-width: 260px;
}
.import-preview-table td {
  white-space: normal;
  overflow-wrap: anywhere;
}
</style>
