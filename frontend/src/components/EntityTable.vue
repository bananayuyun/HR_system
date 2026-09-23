<script setup>
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import Icon from './Icon.vue';
import FieldControl from './FieldControl.vue';
import { schemas } from '../config/schema';
import { api } from '../api';
import {
  deptName,
  jobName,
  empName,
  reqName,
  topDept,
  jobStaffed,
  jobRecruiting,
  reqArrived,
  capacity,
  lastInterview,
  db,
} from '../store';
const props = defineProps({
  route: String,
  rows: Array,
  selected: Set,
  editable: Boolean,
  isHr: Boolean,
  archived: Boolean,
  loading: Boolean,
  resetKey: String,
});
const emit = defineEmits(['action', 'select']);
const page = ref(1),
  size = ref(15),
  sort = ref(''),
  direction = ref(1),
  columnPopup = ref(false),
  importPopup = ref(false),
  importAnchor = ref({ left: '0px', top: '0px' }),
  columnDraft = ref([]),
  columnState = ref({}),
  table = ref(),
  fullscreen = ref(false),
  dragIndex = ref(-1);
const allColumns = computed(() => schemas[props.route] || []);
const defaults = computed(() =>
  [
    { key: '__select', label: '选择' },
    { key: '__index', label: '序号' },
    ...allColumns.value,
    { key: '__actions', label: '操作', pin: 'right' },
  ].map((c) => ({ ...c, show: true })),
);
const columns = computed(() =>
  (columnState.value[props.route] || defaults.value).filter((c) => c.show),
);
const resetConfirmation = ref(false),
  columnError = ref(''),
  anchor = ref({ right: '32px', top: '240px' });
async function loadPreferences() {
  const key = props.route;
  try {
    const pref = await api('/preferences/' + key);
    if (
      Array.isArray(pref.columns) &&
      pref.columns.length &&
      pref.columns.some((c) => c.show) &&
      pref.columns.every((c) => defaults.value.some((d) => d.key === c.key))
    )
      columnState.value[key] = pref.columns;
  } catch {
    /* Preferences are optional; data access errors are handled by the page. */
  }
}
function cell(row, key) {
  if (key === 'mainDept') return deptName(row.mainDept || topDept(row.dept)?.id);
  if (key === 'groupName') return row.dept === topDept(row.dept)?.id ? '—' : deptName(row.dept);
  if (key === 'dept')
    return props.route === 'jobs' && row.dept === topDept(row.dept)?.id
      ? '直属部门'
      : deptName(row.dept);
  if (key === 'parent') return row.parent ? deptName(row.parent) : '无上级组织';
  if (key === 'job') return jobName(row.job);
  if (key === 'req') return reqName(row.req);
  if (key === 'owner' && props.route === 'assets')
    return row.public === '是' ? '公共资产' : empName(row.owner);
  if (key === 'staffed') return row.staffed ?? jobStaffed(row);
  if (key === 'recruiting') return row.recruiting ?? (jobRecruiting(row) || '—');
  if (key === 'salary')
    return row.salaryMin && row.salaryMax
      ? `${Number(row.salaryMin)}–${Number(row.salaryMax)}K / 月`
      : '待补充';
  if (key === 'interviewer') return lastInterview(row)?.interviewer || '待安排';
  if (key === 'date') return lastInterview(row)?.date || '待安排';
  if (key === 'interviewStatus') return lastInterview(row)?.status || '待安排';
  if (key === 'screener') {
    const req = db.reqs.find((r) => r.id === row.req);
    if (props.route === 'screening')
      return props.isHr
        ? req?.owner || req?.ownerIds?.map(empName).join('、') || '待配置'
        : req?.screener || req?.screenerIds?.map(empName).join('、') || '待配置';
    return row.screener || req?.screener || '—';
  }
  if (key === 'location') return row.workRegion || row.location || '—';
  if (key === 'workRegion') return row.workRegion || '—';
  if (key === 'contractCompany' && props.route === 'offers') return row.contractCompany || '待确定';
  return row[key] ?? '—';
}
const sorted = computed(() =>
  sort.value
    ? [...props.rows].sort(
        (a, b) =>
          String(cell(a, sort.value)).localeCompare(String(cell(b, sort.value)), 'zh-CN', {
            numeric: true,
          }) * direction.value,
      )
    : props.rows,
);
const pages = computed(() => Math.max(1, Math.ceil(sorted.value.length / size.value)));
const currentRows = computed(() =>
  sorted.value.slice((page.value - 1) * size.value, page.value * size.value),
);
const numbers = computed(() => {
  let result = [],
    last = 0;
  for (let n = 1; n <= pages.value; n++)
    if (n === 1 || n === pages.value || Math.abs(n - page.value) < 2) {
      if (last && n - last > 1) result.push('…');
      result.push(n);
      last = n;
    }
  return result;
});
watch(
  () => props.route,
  () => {
    page.value = 1;
    sort.value = '';
    columnPopup.value = false;
    importPopup.value = false;
  },
);
watch(
  () => props.rows,
  () => {
    page.value = Math.min(page.value, pages.value);
  },
);
watch(size, () => (page.value = 1));
watch(
  () => props.resetKey,
  () => (page.value = 1),
);
const allSelected = computed(
  () => currentRows.value.length > 0 && currentRows.value.every((r) => props.selected.has(r.id)),
);
const partlySelected = computed(
  () => currentRows.value.some((r) => props.selected.has(r.id)) && !allSelected.value,
);
function selectAll() {
  const next = new Set(props.selected);
  currentRows.value.forEach((r) => (allSelected.value ? next.delete(r.id) : next.add(r.id)));
  emit('select', next);
}
function select(row) {
  const next = new Set(props.selected);
  next.has(row.id) ? next.delete(row.id) : next.add(row.id);
  emit('select', next);
}
function doSort(key) {
  if (sort.value === key) direction.value *= -1;
  else {
    sort.value = key;
    direction.value = 1;
  }
}
function action(name, row) {
  importPopup.value = false;
  emit('action', name, row);
}
function showImports(event) {
  const rect = event.currentTarget.getBoundingClientRect();
  importAnchor.value = {
    left: Math.max(8, Math.min(innerWidth - 208, rect.right - 200)) + 'px',
    top: rect.bottom + 8 + 'px',
  };
  columnPopup.value = false;
  importPopup.value = !importPopup.value;
}
function showColumns(event) {
  columnDraft.value = (columnState.value[props.route] || defaults.value).map((c) => ({ ...c }));
  columnError.value = '';
  const r = event.currentTarget.getBoundingClientRect();
  anchor.value = {
    right: Math.max(8, innerWidth - r.right) + 'px',
    top: Math.max(8, Math.min(innerHeight - 540, r.bottom + 8)) + 'px',
  };
  columnPopup.value = !columnPopup.value;
}
async function applyColumns() {
  if (!columnDraft.value.some((c) => c.show)) {
    columnError.value = '至少显示一列';
    return;
  }
  const ordered = [
    ...columnDraft.value.filter((c) => c.pin === 'left'),
    ...columnDraft.value.filter((c) => !c.pin),
    ...columnDraft.value.filter((c) => c.pin === 'right'),
  ].map((c) => ({ ...c }));
  try {
    await api('/preferences/' + props.route, { method: 'PUT', body: { columns: ordered } });
    columnState.value[props.route] = ordered;
    columnPopup.value = false;
    await nextTick();
    pinColumns();
  } catch (e) {
    columnError.value = e.message;
  }
}
function moveColumn(index, to) {
  if (to < 0 || to >= columnDraft.value.length) return;
  const value = columnDraft.value.splice(index, 1)[0];
  columnDraft.value.splice(to, 0, value);
}
function pinColumns() {
  if (!table.value) return;
  const widths = Object.fromEntries(
    [...table.value.tHead.rows[0].cells].map((c) => [
      c.dataset.listKey,
      c.getBoundingClientRect().width,
    ]),
  );
  for (const c of table.value.querySelectorAll('[data-list-key]')) {
    c.style.left = '';
    c.style.right = '';
    c.classList.remove('w3-pinned');
  }
  for (const side of ['left', 'right']) {
    let offset = 0;
    for (const c of side === 'left' ? columns.value : [...columns.value].reverse()) {
      if (c.pin !== side) continue;
      for (const cell of table.value.querySelectorAll('[data-list-key="' + c.key + '"]')) {
        cell.style[side] = offset + 'px';
        cell.classList.add('w3-pinned');
        cell.dataset.pinSide = side;
      }
      offset += widths[c.key] || 0;
    }
  }
}
function dismiss(event) {
  if (event.defaultPrevented) return;
  if (event.key === 'Escape') {
    if (resetConfirmation.value) resetConfirmation.value = false;
    else columnPopup.value = false;
    fullscreen.value = false;
    importPopup.value = false;
  } else if (
    event.type === 'pointerdown' &&
    !event.target.closest('.w-columns,.w-column-reset-mask,[aria-label="列设置"]')
  )
    columnPopup.value = false;
  if (event.type === 'pointerdown' && !event.target.closest('.import-menu,[aria-label="导入菜单"]'))
    importPopup.value = false;
}
onMounted(() => {
  loadPreferences();
  window.addEventListener('resize', pinColumns);
  window.addEventListener('keydown', dismiss);
  window.addEventListener('pointerdown', dismiss);
  nextTick(pinColumns);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', pinColumns);
  window.removeEventListener('keydown', dismiss);
  window.removeEventListener('pointerdown', dismiss);
});
watch(() => props.route, loadPreferences);
watch([columns, currentRows], () => nextTick(pinColumns));
const isBlue = (s) =>
  ['待 HR 筛选', '待部门筛选', '初试', '复试', '待入职', '招聘中', '启用', '试用'].includes(s);
const candidateCount = (r) => db.candidates.filter((c) => c.req === r.id).length;
const reqCapacity = (r) => {
  const j = db.jobs.find((j) => j.id === r.job);
  if (!j) return null;
  const limit = Number(j.headcount) || 0,
    staff = jobStaffed(j),
    leaving =
      r.type === '替补' ? db.emps.filter((e) => e.job === j.id && e.status === '待离职').length : 0,
    other = db.reqs
      .filter((q) => q.id !== r.id && q.job === j.id && ['招聘中', '暂停'].includes(q.status))
      .reduce((n, q) => n + Math.max(0, Number(q.count) - reqArrived(q)), 0),
    current = ['招聘中', '暂停'].includes(r.status)
      ? Math.max(0, Number(r.count) - reqArrived(r))
      : 0,
    available = Math.max(0, limit - staff - other + leaving);
  return {
    limit,
    staff,
    pending: other + current,
    available,
    projected: staff + other + current - leaving,
    over: Math.max(0, current - available),
  };
};
defineExpose({ cell, columns });
</script>
<template>
  <section
    class="v-table-host w-table-host"
    :class="{ 'w-fullscreen': fullscreen }"
    id="table-host"
  >
    <div class="w-toolbar">
      <template v-if="editable">
        <button
          v-if="!['pool', 'screening', 'interviews', 'offers'].includes(route)"
          class="btn pri-btn"
          @click="action('add')"
          >新增</button
        >
        <button
          v-if="isHr && ['roster', 'reqs', 'assets', 'grades'].includes(route) && !archived"
          class="btn"
          aria-label="导入菜单"
          :aria-expanded="importPopup"
          @click="showImports"
          >导入 <Icon name="down" />
        </button>
        <button v-if="route === 'pool'" class="btn pri-btn" @click="action('resumeImport')">
          <Icon name="plus" />批量录入简历</button
        >
      </template>
      <button
        v-if="route === 'screening'"
        class="btn"
        :disabled="!selected.size"
        @click="action('batchScreen')"
        >批量筛选</button
      >
      <button v-if="route === 'grades' && editable" class="btn" @click="action('sequences')"
        >管理职务序列</button
      >
      <button v-if="route === 'assets'" class="btn" @click="action('qrBatch')">导出二维码</button>
      <span class="v-current-count">{{
        selected.size ? '已选 ' + selected.size + ' 条' : ''
      }}</span>
      <div class="w-tools-right">
        <button
          v-if="route !== 'roster' || isHr"
          class="w-tool"
          title="导出当前筛选结果"
          aria-label="导出当前筛选结果"
          @click="action('export')"
        >
          <Icon name="export" />
        </button>
        <button
          class="w-tool"
          :title="fullscreen ? '退出表格全屏' : '表格全屏'"
          :aria-label="fullscreen ? '退出表格全屏' : '表格全屏'"
          @click="fullscreen = !fullscreen"
        >
          <Icon name="full" />
        </button>
        <button class="w-tool" title="列设置" aria-label="列设置" @click="showColumns">
          <Icon name="settings" />
        </button>
      </div>
    </div>
    <div class="tw">
      <table ref="table" class="tbl" :class="{ 'w3-roster-table': route === 'roster' }">
        <thead>
          <tr>
            <th
              v-for="c in columns"
              :key="c.key"
              :data-list-key="c.key"
              :class="{
                'v-check': c.key === '__select',
                'v-index': c.key === '__index',
                'v-actions': c.key === '__actions',
              }"
            >
              <template v-if="c.key === '__select'">
                <input
                  type="checkbox"
                  aria-label="选择本页全部记录"
                  :checked="allSelected"
                  :indeterminate="partlySelected"
                  @change="selectAll"
                /> </template
              ><template v-else-if="c.key.startsWith('__')">{{ c.label }}</template>
              <button v-else class="v-sort" @click="doSort(c.key)"
                >{{ c.label
                }}<span class="w3-sort-icons">
                  <Icon name="e8ee" />
                  <Icon name="e8ed" />
                </span>
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in currentRows" :key="r.id">
            <td
              v-for="c in columns"
              :key="c.key"
              :data-list-key="c.key"
              :class="{
                'v-check': c.key === '__select',
                'v-index': c.key === '__index',
                'v-actions': c.key === '__actions',
              }"
            >
              <template v-if="c.key === '__select'">
                <input
                  type="checkbox"
                  :aria-label="'选择' + (r.name || r.code)"
                  :checked="selected.has(r.id)"
                  @change="select(r)"
                /> </template
              ><template v-else-if="c.key === '__index'">{{ (page - 1) * size + i + 1 }}</template>
              <template v-else-if="c.key !== '__actions'">
                <div v-if="route === 'roster' && c.key === 'name'" class="w3-person">
                  <div>
                    <b>{{ r.name }}</b>
                    <span class="v-muted">{{ r.gender }}</span>
                  </div>
                  <span> <Icon name="phone" />{{ r.phone }}</span>
                  <span> <Icon name="e81c" />{{ r.id }}</span>
                </div>
                <template
                  v-else-if="
                    c.key === 'name' &&
                    ['pool', 'screening', 'interviews', 'offers'].includes(route)
                  "
                >
                  <div class="v-cell-name">
                    <button class="v-link" @click="action('view', r)">{{ r.name }}</button>
                  </div>
                  <div class="v-cell-sub">{{ r.education }} · {{ r.years }} 年经验</div>
                </template>
                <template v-else-if="c.key === 'req'"
                  >{{ reqName(r.req) }}<div class="v-cell-sub">{{ deptName(r.dept) }}</div>
                </template>
                <span
                  v-else-if="['status', 'stage', 'interviewStatus'].includes(c.key)"
                  class="v-badge"
                  :class="{ blue: isBlue(cell(r, c.key)) }"
                  >{{ cell(r, c.key) }}</span
                >
                <span
                  v-else-if="c.key === 'capacityState'"
                  class="v-badge job-capacity-chip"
                  :class="capacity(r).key"
                  >{{ capacity(r).label }}</span
                >
                <template v-else-if="c.key === 'capacity'">
                  <div v-if="reqCapacity(r)" class="req-capacity-cell">
                    <span
                      class="v-badge req-capacity-state"
                      :class="reqCapacity(r).over ? 'req-capacity-over' : 'req-capacity-ok'"
                      >{{
                        reqCapacity(r).over ? '超出编制 ' + reqCapacity(r).over + ' 人' : '可招聘'
                      }}</span
                    >
                    <div class="v-cell-sub">{{
                      reqCapacity(r).over
                        ? `在编 ${reqCapacity(r).staff} · 在途 ${reqCapacity(r).pending} / 编制 ${reqCapacity(r).limit}`
                        : `可用 ${reqCapacity(r).available} · 预计占用 ${reqCapacity(r).projected} / ${reqCapacity(r).limit}`
                    }}</div> </div
                  ><span v-else>—</span>
                </template>
                <template v-else-if="c.key === 'candidates'">
                  <button
                    v-if="candidateCount(r)"
                    class="v-link"
                    @click="action('reqCandidates', r)"
                    >{{ candidateCount(r) }} 人 →</button
                  >
                  <span v-else>—</span>
                </template>
                <template v-else-if="route === 'reqs' && c.key === 'job'"
                  >{{ jobName(r.job) }}<div class="v-cell-sub">{{ r.name }}</div>
                </template>
                <template v-else-if="route === 'reqs' && c.key === 'count'"
                  >{{ r.count }}<div class="v-cell-sub">已入职 {{ reqArrived(r) }}</div>
                </template>
                <button
                  v-else-if="
                    (route === 'reqs' && c.key === 'id') || (route === 'assets' && c.key === 'name')
                  "
                  class="v-link"
                  @click="action('view', r)"
                  >{{ cell(r, c.key) }}</button
                >
                <template v-else-if="c.key === 'date'"
                  >{{ cell(r, c.key)
                  }}<div v-if="lastInterview(r)" class="v-cell-sub"
                    >{{ lastInterview(r).start }}–{{ lastInterview(r).end }}</div
                  >
                </template>
                <span
                  v-else
                  :class="{
                    'job-metric-number': ['headcount', 'staffed', 'recruiting'].includes(c.key),
                  }"
                  >{{ cell(r, c.key) }}</span
                >
              </template>
              <div v-else>
                <button class="v-link" @click="action('view', r)">查看</button>
                <template
                  v-if="
                    editable &&
                    ['orgs', 'jobs', 'grades', 'reqs', 'assets', 'screening'].includes(route)
                  "
                >
                  <span class="v-sep" />
                  <button class="v-link" @click="action('edit', r)">编辑</button>
                </template>
                <template v-if="editable && route === 'pool'"
                  ><span class="v-sep" /><button class="v-link" @click="action('delete', r)"
                    >删除</button
                  ></template
                >
                <template v-if="route === 'jobs' && isHr">
                  <span class="v-sep" />
                  <button class="v-link" @click="action('audit', r)">日志</button>
                </template>
                <template v-if="route === 'roster' && isHr">
                  <span class="v-sep" />
                  <button
                    class="v-link"
                    @click="action(r.status === '已离职' ? 'reinstate' : 'leave', r)"
                    >{{ r.status === '已离职' ? '复职' : '办理离职' }}</button
                  >
                  <span class="v-sep" />
                  <button class="v-link danger" @click="action('permanentDelete', r)"
                    >彻底删除</button
                  >
                </template>
                <template
                  v-if="route === 'interviews' && editable && ['初试', '复试'].includes(r.stage)"
                >
                  <span class="v-sep" />
                  <button
                    class="v-link"
                    @click="
                      action(
                        lastInterview(r)?.round === r.stage &&
                          ['待面试', '待评价'].includes(lastInterview(r)?.status)
                          ? 'interviewResult'
                          : 'schedule',
                        r,
                      )
                    "
                    >{{
                      lastInterview(r)?.round === r.stage &&
                      ['待面试', '待评价'].includes(lastInterview(r)?.status)
                        ? '录入结果'
                        : '安排面试'
                    }}</button
                  >
                  <span class="v-sep" />
                  <button class="v-link" @click="action('schedule', r)">改期</button>
                </template>
                <template v-if="route === 'offers' && isHr">
                  <span class="v-sep" />
                  <button class="v-link" @click="action('onboarding', r)">{{
                    ['待入职', '延期入职'].includes(r.stage) ? '确认入职' : '办理'
                  }}</button>
                  <template v-if="['待入职', '延期入职', '未到岗'].includes(r.stage)"
                    ><span class="v-sep" /><button
                      class="v-link"
                      @click="action('cancelOnboarding', r)"
                      >取消入职</button
                    ></template
                  >
                </template>
                <template v-if="route === 'assets'">
                  <span class="v-sep" />
                  <button class="v-link" @click="action('qr', r)">二维码</button>
                </template>
              </div>
            </td>
          </tr>
          <tr v-if="!currentRows.length">
            <td :colspan="columns.length">
              <div class="v-empty">
                <Icon name="search" />
                <strong>{{ loading ? '数据加载中' : '暂无符合条件的记录' }}</strong
                >调整筛选条件，或录入新的数据。</div
              >
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="pager">
      <span>共 {{ rows.length }} 条记录</span>
      <span>每页</span>
      <FieldControl
        v-model="size"
        type="select"
        :options="[15, 30, 50, 100]"
        label="每页条数"
        required
      />
      <span>条</span>
      <button aria-label="上一页" :disabled="page === 1" @click="page--">
        <Icon name="e744" />
      </button>
      <template v-for="n in numbers" :key="n">
        <span v-if="n === '…'" class="v-muted">…</span>
        <button
          v-else
          :class="{ current: page === n }"
          :aria-current="page === n ? 'page' : undefined"
          @click="page = n"
          >{{ n }}</button
        >
      </template>
      <button aria-label="下一页" :disabled="page >= pages" @click="page++">
        <Icon name="e743" />
      </button>
      <span>前往</span>
      <input
        class="inp"
        type="number"
        :value="page"
        min="1"
        :max="pages"
        aria-label="跳转页码"
        @change="page = Math.min(pages, Math.max(1, Number($event.target.value) || 1))"
      />
      <span>页</span>
    </div>
  </section>
  <Teleport to="body">
    <div
      v-if="importPopup"
      class="w3-popover w3-menu import-menu"
      :style="importAnchor"
      role="menu"
      aria-label="导入选项"
    >
      <button class="w-select-option" @click="action('import')">{{
        route === 'roster' ? '导入花名册' : route === 'reqs' ? '导入钉钉招聘需求' : '导入数据'
      }}</button>
      <button class="w-select-option" @click="action('importRecords')">导入记录</button>
    </div>
    <div
      v-if="columnPopup"
      class="w3-popover w-columns column-popup"
      :style="anchor"
      role="dialog"
      aria-label="列设置"
    >
      <div class="w-columns-head">
        <label>
          <input
            type="checkbox"
            :checked="columnDraft.every((c) => c.show)"
            @change="columnDraft.forEach((c) => (c.show = $event.target.checked))"
          />
          全部</label
        >
      </div>
      <div class="w-columns-list">
        <div
          v-for="(c, i) in columnDraft"
          :key="c.key"
          class="w-column-row"
          @dragover.prevent
          @drop="moveColumn(dragIndex, i)"
        >
          <input v-model="c.show" type="checkbox" :aria-label="'显示' + c.label" />
          <button
            class="w3-grip"
            draggable="true"
            :aria-label="'调整' + c.label + '顺序'"
            @dragstart="dragIndex = i"
            @keydown.up.prevent="moveColumn(i, i - 1)"
            @keydown.down.prevent="moveColumn(i, i + 1)"
          >
            <Icon name="e821" />
          </button>
          <span>{{ c.label }}</span>
          <button
            :class="{ on: c.pin === 'left' }"
            aria-label="固定到左侧"
            @click="c.pin = c.pin === 'left' ? '' : 'left'"
            ><svg class="w-pin-icon" viewBox="0 0 16 16" aria-hidden="true">
              <g transform="rotate(45 8 8)">
                <path
                  d="M5 2.5h6l-1 1.7v3L12 9H4l2-1.8v-3z"
                  :fill="c.pin === 'left' ? 'currentColor' : 'none'"
                  stroke="currentColor"
                  stroke-width="1"
                  stroke-linejoin="round"
                />
                <path d="M8 9v4.5" stroke="currentColor" stroke-width="1" stroke-linecap="round" />
              </g></svg
          ></button>
          <button
            :class="{ on: c.pin === 'right' }"
            aria-label="固定到右侧"
            @click="c.pin = c.pin === 'right' ? '' : 'right'"
            ><svg class="w-pin-icon" viewBox="0 0 16 16" aria-hidden="true">
              <g transform="rotate(-45 8 8)">
                <path
                  d="M5 2.5h6l-1 1.7v3L12 9H4l2-1.8v-3z"
                  :fill="c.pin === 'right' ? 'currentColor' : 'none'"
                  stroke="currentColor"
                  stroke-width="1"
                  stroke-linejoin="round"
                />
                <path d="M8 9v4.5" stroke="currentColor" stroke-width="1" stroke-linecap="round" />
              </g></svg
          ></button>
        </div>
      </div>
      <div class="w-columns-foot">
        <button @click="resetConfirmation = true">恢复默认</button>
        <button @click="columnPopup = false">取消</button>
        <button :disabled="!columnDraft.some((c) => c.show)" @click="applyColumns">确认</button>
      </div>
      <div v-if="columnError" class="w3-column-error" role="alert">{{ columnError }}</div>
    </div>
    <div v-if="resetConfirmation" class="w-column-reset-mask"
      ><section
        class="w-column-reset-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="column-reset-title"
        ><h3 id="column-reset-title">确认恢复默认列配置?</h3
        ><button
          class="w-column-reset-close"
          aria-label="关闭恢复默认确认"
          @click="resetConfirmation = false"
          >×</button
        ><div class="w-column-reset-footer"
          ><button class="btn" @click="resetConfirmation = false">取消</button
          ><button
            class="btn pri-btn"
            @click="
              columnDraft = defaults.map((c) => ({ ...c }));
              resetConfirmation = false;
            "
            >确认</button
          ></div
        ></section
      ></div
    >
  </Teleport>
</template>
