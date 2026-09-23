<script setup>
import {
  ref,
  reactive,
  computed,
  watch,
  onMounted,
  onBeforeUnmount,
  defineAsyncComponent,
  nextTick,
} from 'vue';
import { ConfigProvider, DatePicker } from 'ant-design-vue';
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import Icon from './components/Icon.vue';
import FieldControl from './components/FieldControl.vue';
import OrgTree from './components/OrgTree.vue';
import EntityTable from './components/EntityTable.vue';
import EntityEditor from './components/EntityEditor.vue';
import DetailDrawer from './components/DetailDrawer.vue';
import WorkflowDialog from './components/WorkflowDialog.vue';
import AdvancedFilter from './components/AdvancedFilter.vue';
import SettingsView from './components/SettingsView.vue';
import ImportDialog from './components/ImportDialog.vue';
import { api, setCsrfToken } from './api';
import { exportRoster, exportEmployee } from './export-workbook';
import {
  db,
  user,
  route,
  notice,
  isHr,
  menus,
  can,
  refresh,
  navigate,
  clearSession,
  deptName,
  jobName,
  reqName,
  within,
  topDept,
  jobStaffed,
  jobRecruiting,
  reqArrived,
  lastInterview,
} from './store';
import { routes, schemas, PRE_ENTRY } from './config/schema';
const ResumeBatchDialog = defineAsyncComponent(() => import('./components/ResumeBatchDialog.vue'));
const ReminderDialog = defineAsyncComponent(() => import('./components/ReminderDialog.vue'));
const SequenceDialog = defineAsyncComponent(() => import('./components/SequenceDialog.vue'));
const ImportRecords = defineAsyncComponent(() => import('./components/ImportRecords.vue'));
dayjs.locale('zh-cn');
const RangePicker = DatePicker.RangePicker;
const booting = ref(true),
  loading = ref(false),
  loginBusy = ref(false),
  loginError = ref(''),
  pageError = ref(''),
  login = reactive({ username: '', password: '' });
const navSearch = ref(''),
  collapsed = ref(false),
  mobile = ref(false),
  treeCollapsed = ref(false),
  query = reactive({}),
  applied = ref({}),
  expanded = ref(false),
  tab = ref('全部'),
  selected = ref(new Set()),
  archive = ref(false),
  archivedRows = ref([]),
  rankMap = ref(false),
  dialog = ref(null),
  dialogBack = ref(null),
  table = ref(),
  orgId = ref('ORG_ROOT'),
  orgTab = ref('info'),
  orgPeopleQuery = ref(''),
  orgPeopleApplied = ref(''),
  orgPeoplePage = ref(1),
  orgPeopleSize = ref(15),
  advanced = ref({}),
  dateRange = ref([]);
const theme = {
  token: {
    colorPrimary: '#1555d4',
    borderRadius: 4,
    controlHeight: 32,
    fontFamily: 'WSourceHan, Microsoft YaHei, sans-serif',
    fontSize: 14,
    lineHeight: 20 / 14,
    colorText: '#333',
    colorTextPlaceholder: '#c8c9cc',
    colorBorder: '#dcdde0',
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorBgTextHover: '#f5f7fa',
    colorFillSecondary: '#f5f7fa',
  },
  components: { Select: { optionSelectedBg: '#e8eefb', optionActiveBg: '#f5f7fa' } },
};
const page = computed(() => routes[route.value] || routes.roster);
const type = computed(() => page.value[2]);
const groups = computed(() =>
  ['员工管理', '招聘管理', '资产管理']
    .map((label, i) => ({
      label,
      icon: ['e808', 'e718', 'e807'][i],
      items: menus.value.filter(
        (k) => routes[k][1] === label && routes[k][0].includes(navSearch.value),
      ),
    }))
    .filter((g) => g.items.length),
);
const editable = computed(() =>
  route.value === 'screening'
    ? can(isHr.value ? 'screening:hr' : 'screening:department')
    : can(
        { interviews: 'interviews', offers: 'offers', settings: 'settings' }[route.value] +
          ':write',
      ) || can(type.value + ':write'),
);
const org = computed(() => db.orgs.find((o) => o.id === orgId.value) || db.orgs[0]);
watch(
  () => db.orgs,
  () => {
    if (orgId.value === 'ORG_ROOT')
      orgId.value = db.orgs.find((o) => o.id === 'ORG_18')?.id || db.orgs[0]?.id;
  },
);
const people = computed(() =>
  db.emps.filter(
    (e) =>
      org.value &&
      within(e.dept, org.value.id) &&
      !e.deletedAt &&
      (e.name + ' ' + e.phone).toLowerCase().includes(orgPeopleApplied.value.toLowerCase()),
  ),
);
const orgPeoplePages = computed(() =>
  Math.max(1, Math.ceil(people.value.length / orgPeopleSize.value)),
);
const currentPeople = computed(() =>
  people.value.slice(
    (orgPeoplePage.value - 1) * orgPeopleSize.value,
    orgPeoplePage.value * orgPeopleSize.value,
  ),
);
function searchPeople(reset = false) {
  if (reset) orgPeopleQuery.value = '';
  orgPeopleApplied.value = orgPeopleQuery.value.trim();
  orgPeoplePage.value = 1;
}
watch(orgId, () => searchPeople(true));
watch(orgPeopleSize, () => (orgPeoplePage.value = 1));
watch(people, () => (orgPeoplePage.value = Math.min(orgPeoplePage.value, orgPeoplePages.value)));
const stageTabs = computed(() =>
  route.value === 'screening'
    ? [isHr.value ? '待 HR 筛选' : '待部门筛选', '暂缓筛选', '未通过', '候选人取消']
    : route.value === 'interviews'
      ? ['初试', '复试', '未通过', '候选人取消']
      : route.value === 'offers'
        ? PRE_ENTRY
        : [],
);
const rawRows = computed(() => {
  let rows = route.value === 'roster' && archive.value ? archivedRows.value : db[type.value] || [];
  if (!Array.isArray(rows)) return [];
  if (route.value === 'roster' && !archive.value)
    rows = rows.filter((r) => !r.deletedAt && !r.deleted_at && !r.archived);
  if (route.value === 'screening') {
    const pending = isHr.value ? '待 HR 筛选' : '待部门筛选';
    rows = rows.filter(
      (c) =>
        c.stage === pending ||
        (c.stage === '暂缓筛选' && (!c.deferredFrom || c.deferredFrom === pending)),
    );
  }
  if (route.value === 'interviews')
    rows = rows.filter(
      (c) =>
        ['初试', '复试'].includes(c.stage) ||
        (['未通过', '候选人取消'].includes(c.stage) && c.interviews?.length),
    );
  if (route.value === 'offers') rows = rows.filter((c) => PRE_ENTRY.includes(c.stage));
  return rows;
});
function fieldValue(row, key) {
  if (key === 'mainDept') return deptName(row.mainDept || topDept(row.dept)?.id);
  if (key === 'dept') return deptName(row.dept);
  if (key === 'job') return jobName(row.job);
  if (key === 'req') return reqName(row.req);
  return row[key] ?? '';
}
const filteredRows = computed(() => {
  const q = applied.value;
  let rows = rawRows.value.filter((r) => {
    if (tab.value !== '全部' && (r.stage || r.status) !== tab.value) return false;
    if (
      q.q &&
      ![r.name, r.id, r.phone, r.email, jobName(r.job), reqName(r.req)].some((v) =>
        String(v || '')
          .toLowerCase()
          .includes(q.q.toLowerCase()),
      )
    )
      return false;
    if (q.dept && !within(r.dept, q.dept)) return false;
    if (q.mainDept && !within(r.dept, q.mainDept)) return false;
    for (const k of [
      'workRegion',
      'workplace',
      'contractCompany',
      'status',
      'source',
      'req',
      'grade',
      'sequence',
      'category',
      'job',
    ])
      if (
        q[k] &&
        String(
          r[k] ?? (k === 'workRegion' ? r.location : k === 'contractCompany' ? r.company : ''),
        ) !== String(q[k])
      )
        return false;
    if (
      q.interviewer &&
      !lastInterview(r)?.interviewerIds?.includes(q.interviewer) &&
      !lastInterview(r)?.interviewer?.includes(q.interviewer)
    )
      return false;
    if (q.interviewStatus && (lastInterview(r)?.status || '待安排') !== q.interviewStatus)
      return false;
    const d =
      route.value === 'interviews'
        ? lastInterview(r)?.date
        : r.entry || r.created || r.purchased || r.deadline || '';
    if (q.from && d < q.from) return false;
    if (q.to && d > q.to) return false;
    return true;
  });
  const a = advanced.value[route.value];
  if (a?.rules?.length)
    rows = rows.filter((r) => {
      const tests = a.rules.map((rule) => {
        const v = String(fieldValue(r, rule.field)).toLowerCase(),
          term = String(rule.value).toLowerCase();
        return {
          contains: () => v.includes(term),
          eq: () => v === term,
          ne: () => v !== term,
          not: () => !v.includes(term),
          empty: () => !v,
          notempty: () => !!v,
        }[rule.op]?.();
      });
      return a.mode === 'any' ? tests.some(Boolean) : tests.every(Boolean);
    });
  return rows;
});
const filterFields = computed(() => {
  const orgs = db.orgs.map((o) => ({ value: o.id, label: o.name })),
    dict = (k) => (db.baseSettings[k] || []).map((x) => x.name),
    result = [];
  const add = (key, label, options) => result.push({ key, label, options });
  if (['screening', 'offers', 'pool'].includes(route.value))
    add(
      'req',
      '请选择招聘需求',
      db.reqs.map((r) => ({ value: r.id, label: r.name })),
    );
  if (route.value === 'interviews') {
    add('workRegion', '请选择工作片区', dict('workRegion'));
    add('workplace', '请选择工作所在地', dict('workplace'));
    add(
      'job',
      '请选择招聘岗位',
      db.jobs.map((j) => ({ value: j.id, label: j.name })),
    );
    add('q', '请输入候选人姓名/手机号', []);
    add('dept', '请选择部门', orgs);
    add('date', '面试日期区间', []);
    add(
      'req',
      '请选择招聘需求',
      db.reqs.map((r) => ({ value: r.id, label: r.name })),
    );
    add(
      'interviewer',
      '请选择面试官',
      db.emps.map((e) => ({ value: e.id, label: e.name })),
    );
    add('interviewStatus', '请选择面试状态', [
      '待安排',
      '待面试',
      '待评价',
      '已完成',
      '已取消',
      '未到场',
    ]);
    add('contractCompany', '请选择合同归属', dict('contractCompany'));
    add('source', '请选择简历来源', ['Boss 直聘', '内部推荐', '猎聘', '其它']);
    return result;
  }
  if (route.value === 'grades') add('sequence', '请选择职务序列', db.sequences);
  else if (route.value === 'assets')
    add('category', '请选择资产类别', ['电子设备', '办公家具', '其它']);
  else if (route.value === 'jobs') {
    add(
      'mainDept',
      '请选择部门',
      orgs.filter((o) => db.orgs.find((x) => x.id === o.value)?.parent === 'ORG_ROOT'),
    );
  } else if (!['roster', 'screening', 'offers', 'pool'].includes(route.value))
    add('dept', '请选择部门', orgs);
  if (!['grades', 'jobs'].includes(route.value)) {
    add('workRegion', '请选择工作片区', dict('workRegion'));
    add('workplace', '请选择工作所在地', dict('workplace'));
  }
  if (['roster', 'offers', 'reqs'].includes(route.value))
    add('contractCompany', '请选择合同归属', dict('contractCompany'));
  if (['roster', 'assets', 'reqs', 'jobs', 'orgs'].includes(route.value))
    add('status', '请选择状态', [...new Set(rawRows.value.map((r) => r.status))]);
  if (route.value === 'roster')
    add(
      'grade',
      '请选择职级',
      db.grades.map((g) => g.code),
    );
  if (['screening', 'pool'].includes(route.value))
    add('source', '请选择简历来源', ['Boss 直聘', '内部推荐', '猎聘', '其它']);
  if (!['grades', 'jobs', 'orgs'].includes(route.value)) add('date', '日期区间', []);
  return result;
});
const reqOverview = computed(() => {
  const reqs = db.reqs.filter((r) => r.status === '招聘中');
  return [
    {
      label: '招聘中岗位',
      value: new Set(reqs.map((r) => r.job)).size,
      unit: '个',
      sub: '需求 ' + reqs.reduce((s, r) => s + Number(r.count), 0) + ' 人',
      tone: 'brand',
    },
    {
      label: '待招人数',
      value: reqs.reduce((s, r) => s + Math.max(0, r.count - reqArrived(r)), 0),
      unit: '人',
      sub: '招聘中需求剩余人数',
      tone: 'blue',
    },
    {
      label: '面试中',
      value: db.candidates.filter((c) => ['初试', '复试'].includes(c.stage)).length,
      unit: '人',
      sub: '初试、复试候选人',
      tone: 'amber',
    },
    {
      label: '已入职',
      value: db.candidates.filter((c) => c.stage === '已入职').length,
      unit: '人',
      sub: '由招聘需求转入花名册',
      tone: 'green',
    },
  ];
});
function applyQuery() {
  applied.value = { ...query };
  selected.value = new Set();
}
function reset() {
  for (const k of Object.keys(query)) delete query[k];
  applied.value = {};
  dateRange.value = [];
  tab.value = '全部';
  selected.value = new Set();
  delete advanced.value[route.value];
  notice.value = '';
}
function orgFilter(id) {
  query.dept = id;
  applyQuery();
}
watch([tab, () => advanced.value[route.value]], () => {
  selected.value = new Set();
});
function closeDialog() {
  dialog.value = dialogBack.value;
  dialogBack.value = null;
}
async function loginSubmit() {
  loginError.value = '';
  loginBusy.value = true;
  try {
    const result = await api('/auth/login', {
      method: 'POST',
      body: { username: login.username.trim(), password: login.password },
    });
    user.value = result.user || result;
    await refresh();
    navigate(
      menus.value.includes(route.value) ? route.value : isHr.value ? 'roster' : menus.value[0],
    );
    login.password = '';
  } catch (e) {
    loginError.value = e.message;
    clearSession();
  } finally {
    loginBusy.value = false;
  }
}
async function logout() {
  try {
    await api('/auth/logout', { method: 'POST' });
  } finally {
    clearSession();
    dialog.value = null;
    login.password = '';
  }
}
async function load() {
  loading.value = true;
  pageError.value = '';
  try {
    await refresh();
    if (!menus.value.includes(route.value)) navigate(menus.value[0]);
  } catch (e) {
    pageError.value = e.message;
  } finally {
    loading.value = false;
  }
}
function unauthorized() {
  clearSession();
  dialog.value = null;
  dialogBack.value = null;
}
function hashchange() {
  const target = location.hash.replace('#/', '');
  navigate(target);
}
onMounted(async () => {
  window.addEventListener('hr:unauthorized', unauthorized);
  window.addEventListener('hashchange', hashchange);
  try {
    const result = await api('/auth/me');
    user.value = result.user || result;
    await load();
  } catch (e) {
    if (e.status !== 401) loginError.value = e.message;
  } finally {
    booting.value = false;
  }
});
onBeforeUnmount(() => {
  window.removeEventListener('hr:unauthorized', unauthorized);
  window.removeEventListener('hashchange', hashchange);
});
watch(route, () => {
  reset();
  archive.value = false;
  expanded.value = false;
  dialog.value = null;
  dialogBack.value = null;
  mobile.value = false;
  rankMap.value = false;
  orgTab.value = 'info';
});
watch([collapsed, mobile, treeCollapsed], () => {
  document.body.classList.toggle('collapsed', collapsed.value);
  document.body.classList.toggle('mobile-nav', mobile.value);
  document.body.classList.toggle('w3-tree-collapsed', treeCollapsed.value);
});
async function exportRows(rows, name) {
  if (route.value === 'roster') return exportRoster(rows);
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook(),
    sheet = wb.addWorksheet(name.slice(0, 31));
  const cols = (table.value?.columns || schemas[route.value] || []).filter(
    (c) => !c.key.startsWith('__'),
  );
  sheet.columns = cols.map((c) => ({ header: c.label, key: c.key, width: 22 }));
  rows.forEach((r) =>
    sheet.addRow(
      Object.fromEntries(
        cols.map((c) => [c.key, table.value?.cell(r, c.key) ?? fieldValue(r, c.key)]),
      ),
    ),
  );
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: { row: 1, column: cols.length } };
  const blob = new Blob([await wb.xlsx.writeBuffer()], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name + '.xlsx';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function handleAction(kind, row) {
  pageError.value = '';
  const entity =
    row?.entityType || (dialog.value?.kind === 'detail' ? dialog.value.type : type.value);
  try {
    if (kind === 'archiveToggle') {
      archive.value = !archive.value;
      archivedRows.value = db.emps.filter((r) => r.deleted || r.deletedAt || r.archived);
      selected.value = new Set();
      return;
    }
    if (kind === 'moveUp' || kind === 'moveDown') {
      await api('/orgs/' + encodeURIComponent(row.id) + '/move', {
        method: 'POST',
        body: { direction: kind === 'moveUp' ? 'up' : 'down' },
      });
      await load();
      notice.value = '同级组织顺序已调整。';
      return;
    }
    if (kind === 'export') {
      const rows = filteredRows.value.filter(
        (r) => !selected.value.size || selected.value.has(r.id),
      );
      if (!rows.length) throw new Error('没有可导出的记录。');
      await api('/audit/export', {
        method: 'POST',
        body: {
          type: entity,
          ids: rows.map((r) => r.id),
          columns: (table.value?.columns || schemas[route.value] || [])
            .filter((c) => !c.key.startsWith('__'))
            .map((c) => c.key),
        },
      });
      await exportRows(rows, page.value[0]);
      notice.value = `已导出 ${rows.length} 条${selected.value.size ? '选中记录' : '筛选结果'}。`;
      return;
    }
    if (kind === 'employeeExport') {
      await api('/audit/export', { method: 'POST', body: { type: 'emps', ids: [row.id] } });
      await exportEmployee(row);
      return;
    }
    if (kind === 'reqCandidates') {
      if (!navigate('pool')) return;
      await nextTick();
      query.req = row.id;
      applyQuery();
      return;
    }
    if (dialog.value?.kind === 'detail') dialogBack.value = dialog.value;
    if (kind === 'view') {
      loading.value = true;
      const detail = await api('/' + entity + '/' + encodeURIComponent(row.id));
      dialog.value = { kind: 'detail', type: entity, row: detail, route: route.value };
      loading.value = false;
      return;
    }
    if (kind === 'orgEmployee') {
      const detail = await api('/emps/' + row.id);
      dialog.value = { kind: 'detail', type: 'emps', row: detail, route: 'roster' };
      return;
    }
    if (kind === 'add' || kind === 'edit' || kind === 'sectionEdit') {
      dialog.value = {
        kind: 'edit',
        type: kind === 'sectionEdit' ? 'emps' : entity,
        row: kind === 'add' ? null : row,
        section: row?.section,
        initial:
          kind === 'add' && ['jobs', 'reqs'].includes(entity)
            ? {
                dept:
                  query.dept ||
                  query.mainDept ||
                  user.value?.departmentId ||
                  db.orgs.find((o) => o.id === 'ORG_18' && o.status === '启用')?.id ||
                  db.orgs.find((o) => o.parent && o.status === '启用')?.id ||
                  '',
              }
            : undefined,
      };
      return;
    }
    if (kind === 'import' || kind === 'timelineImport') {
      dialog.value = {
        kind: 'import',
        type: kind === 'timelineImport' ? 'timeline' : entity,
        employeeId: kind === 'timelineImport' ? row.id : undefined,
      };
      return;
    }
    if (kind === 'importRecords') {
      dialog.value = { kind: 'importRecords', type: entity };
      return;
    }
    if (kind === 'resumeImport') {
      dialog.value = { kind: 'resume' };
      return;
    }
    dialog.value = {
      kind: 'workflow',
      action: kind,
      type: kind === 'password' ? 'auth' : entity,
      row,
      rows:
        kind === 'qrBatch'
          ? selected.value.size
            ? filteredRows.value.filter((r) => selected.value.has(r.id))
            : filteredRows.value
          : kind === 'batchScreen'
            ? filteredRows.value.filter((r) => selected.value.has(r.id))
            : undefined,
    };
  } catch (e) {
    pageError.value = e.message;
    loading.value = false;
  }
}
async function saved(message, close = true) {
  const wasPassword = dialog.value?.action === 'password';
  const nextOrg =
    dialog.value?.type === 'orgs'
      ? dialog.value.kind === 'edit' && close?.id
        ? close.id
        : dialog.value.action === 'delete' && orgId.value === dialog.value.row?.id
          ? dialog.value.row.parent
          : null
      : null;
  if (close !== false) {
    dialog.value = null;
    dialogBack.value = null;
  }
  selected.value = new Set();
  notice.value = message;
  if (wasPassword) {
    clearSession();
    loginError.value = message;
    return;
  }
  await load();
  if (nextOrg) orgId.value = nextOrg;
  if (archive.value)
    archivedRows.value = db.emps.filter((r) => r.deleted || r.deletedAt || r.archived);
}
</script>
<template>
  <ConfigProvider :locale="zhCN" :theme="theme">
    <div v-if="booting" class="hr-loading">正在加载人力资源平台…</div>
    <main v-else-if="!user" class="login-page">
      <section class="login-shell" aria-label="人力资源平台登录">
        <div class="login-intro">
          <div class="login-intro-brand">
            <span class="login-intro-mark" aria-hidden="true" />
            <span>人力资源平台</span>
          </div>
          <div class="login-intro-content">
            <span class="login-eyebrow">HUMAN RESOURCES</span>
            <h1>让人员管理<br />更清晰、更高效</h1>
            <p>组织、岗位与员工信息，在同一处有序管理。</p>
            <div class="login-illustration" aria-hidden="true">
              <div class="login-illustration-line" />
              <span class="login-illustration-node node-one" />
              <span class="login-illustration-node node-two" />
              <span class="login-illustration-node node-three" />
              <span class="login-illustration-node node-four" />
            </div>
          </div>
        </div>
        <div class="login-form-panel">
          <form class="login-card" @submit.prevent="loginSubmit">
            <div class="brand">
              <span class="logo" aria-hidden="true" />
              <b>人力资源平台</b>
            </div>
            <span class="login-welcome">欢迎使用</span>
            <h2>登录账号</h2>
            <p>请输入账号和密码。</p>
            <div class="v-field">
              <label for="username">账号</label>
              <input
                id="username"
                v-model="login.username"
                class="inp"
                name="username"
                autocomplete="username"
                placeholder="请输入账号"
                required
              />
            </div>
            <div class="v-field">
              <label for="password">密码</label>
              <input
                id="password"
                v-model="login.password"
                class="inp"
                name="password"
                type="password"
                autocomplete="current-password"
                placeholder="请输入密码"
                required
              />
            </div>
            <p v-if="loginError" class="login-error" role="alert">{{ loginError }}</p>
            <button class="btn pri-btn" :disabled="loginBusy">{{
              loginBusy ? '正在登录…' : '登录'
            }}</button>
          </form>
        </div>
      </section>
    </main>
    <template v-else>
      <header class="v-top">
        <button class="iconbtn v-mobile-toggle" aria-label="展开导航" @click="mobile = !mobile">
          <Icon name="e993" />
        </button>
        <div class="brand">
          <span class="logo" aria-hidden="true" />
          <b>人力资源平台</b>
        </div>
        <div class="v-right">
          <span class="auth-name"
            >{{ user.displayName }} · {{ isHr ? 'HR 管理员' : deptName(user.departmentId) }}</span
          >
          <div class="auth-actions">
            <button class="v-link" @click="handleAction('password')">修改密码</button>
            <button class="v-link" @click="logout">退出</button>
          </div>
        </div>
      </header>
      <aside class="v-side" aria-label="系统导航">
        <div class="v-nav-search">
          <input
            v-model="navSearch"
            class="inp"
            placeholder="请输入菜单名称进行快捷跳转"
            aria-label="搜索菜单"
          />
        </div>
        <nav class="v-nav">
          <details v-for="g in groups" :key="g.label" class="v-group" open>
            <summary>
              <Icon
                :class="{ 'w3-menu-icon': route !== 'settings' }"
                :name="
                  route === 'settings'
                    ? { 员工管理: 'users', 招聘管理: 'org', 资产管理: 'assets' }[g.label]
                    : g.icon
                "
              />
              <span>{{ g.label }}</span>
            </summary>
            <a
              v-for="key in g.items"
              :key="key"
              :href="'#/' + key"
              :class="{ active: route === key }"
              @click.prevent="navigate(key)"
              >{{ routes[key][0] }}</a
            >
          </details>
        </nav>
        <div class="v-side-foot">
          <span>{{
            isHr ? 'HR 管理员 · 全部数据' : '部门主管 · ' + deptName(user.departmentId)
          }}</span>
        </div>
        <button class="v-collapse" aria-label="展开或收起侧栏" @click="collapsed = !collapsed">
          <Icon name="e9d8" />
        </button>
      </aside>
      <div class="v-work">
        <div class="v-breadcrumb"
          >{{ page[1] }}<span>/</span>
          <b>{{ page[0] }}</b>
        </div>
        <main class="v-content" :data-page="route">
          <div class="v-title">
            <h1>{{ page[0] }}</h1>
            <span v-if="route === 'settings'" class="v-scope">HR 管理员</span>
            <div v-else class="v-title-tools">
              <span class="v-scope">{{
                isHr ? '全部数据' : deptName(user.departmentId) + ' · 本部门数据'
              }}</span>
              <button
                v-if="route === 'screening' && isHr"
                class="btn"
                @click="handleAction('reminders')"
                >待筛选提醒规则</button
              >
              <button v-if="route === 'grades'" class="btn" @click="rankMap = !rankMap">{{
                rankMap ? '列表视图' : '职级图谱'
              }}</button>
            </div>
          </div>
          <div v-if="notice" class="v-success" role="status"
            >{{ notice }}<button aria-label="关闭操作结果" @click="notice = ''">×</button>
          </div>
          <div v-if="pageError" class="v-error error-retry" role="alert"
            >{{ pageError }}<button class="v-link" @click="load">重新加载</button>
          </div>
          <div v-if="route === 'screening'" class="v-hint">
            <template v-if="isHr"
              >当前仅展示待 HR
              筛选的简历。筛选通过后，状态将变为“待部门筛选”，并从当前待办中移除；可在简历库或招聘需求的候选人入口追踪进度。
              <button class="v-link" @click="handleAction('reminders')">查看提醒规则</button>
            </template>
            <template v-else
              >当前仅展示待部门筛选的简历。通过后将进入初试；HR
              与部门主管看到的候选状态会实时同步。</template
            >
          </div>
          <div v-if="route === 'offers' && !isHr" class="v-hint"
            >查看本部门未入职人员和到岗安排；入职手续由 HR 维护。</div
          >
          <div v-if="route === 'reqs'" class="req-overview">
            <section
              v-for="card in reqOverview"
              :key="card.label"
              class="req-overview-card"
              :class="card.tone"
            >
              <span class="req-overview-label">{{ card.label }}</span>
              <strong
                >{{ card.value }}<small>{{ card.unit }}</small>
              </strong>
              <span class="req-overview-sub">{{ card.sub }}</span>
            </section>
          </div>
          <SettingsView v-if="route === 'settings'" @saved="saved" />
          <div v-else-if="route === 'orgs'" class="w3-org-layout">
            <OrgTree
              :orgs="db.orgs"
              v-model="orgId"
              :editable="isHr"
              :collapsed="treeCollapsed"
              @collapse="treeCollapsed = !treeCollapsed"
              @add="dialog = { kind: 'edit', type: 'orgs', initial: { parent: orgId } }"
              @edit="handleAction('edit', $event)"
              @delete="handleAction('delete', $event)"
              @move-up="handleAction('moveUp', $event)"
              @move-down="handleAction('moveDown', $event)"
            />
            <div v-if="org" class="w3-org-detail">
              <h2> <Icon name="ea14" />{{ org.name }}</h2>
              <div class="w3-card-tabs">
                <button
                  class="btn"
                  :class="{ 'pri-btn': orgTab === 'info' }"
                  @click="orgTab = 'info'"
                  >组织信息</button
                >
                <button
                  class="btn"
                  :class="{ 'pri-btn': orgTab === 'people' }"
                  @click="orgTab = 'people'"
                  >组织人员</button
                >
              </div>
              <template v-if="orgTab === 'people'">
                <div class="w3-org-people-query">
                  <label class="w-search-field">
                    <input
                      v-model="orgPeopleQuery"
                      class="inp"
                      placeholder="请输入人员姓名/手机号"
                      aria-label="组织人员搜索"
                      @keyup.enter="searchPeople()"
                    />
                    <Icon name="search" />
                  </label>
                  <span class="w3-spacer" />
                  <button
                    class="btn w-iconbtn pri-btn"
                    title="查询组织人员"
                    aria-label="查询组织人员"
                    @click="searchPeople()"
                    ><Icon name="search"
                  /></button>
                  <button
                    class="btn w-iconbtn"
                    title="重置组织人员"
                    aria-label="重置组织人员"
                    @click="searchPeople(true)"
                    ><Icon name="reset"
                  /></button>
                </div>
                <div class="tw">
                  <table class="tbl w3-org-person-table">
                    <thead>
                      <tr>
                        <th>序号</th>
                        <th>姓名</th>
                        <th>手机号</th>
                        <th>岗位</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(p, i) in currentPeople" :key="p.id">
                        <td>{{ (orgPeoplePage - 1) * orgPeopleSize + i + 1 }}</td>
                        <td>{{ p.name }}</td>
                        <td>{{ p.phone }}</td>
                        <td>{{ jobName(p.job) }}</td>
                        <td>
                          <button class="v-link" @click="handleAction('orgEmployee', p)"
                            >查看</button
                          >
                        </td>
                      </tr>
                      <tr v-if="!people.length">
                        <td colspan="5">暂无人员</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div class="pager">
                  <span>共 {{ people.length }} 条记录</span><span>每页</span>
                  <FieldControl
                    v-model="orgPeopleSize"
                    type="select"
                    :options="[15, 30, 50, 100]"
                    label="组织人员每页条数"
                    required
                  />
                  <span>条</span>
                  <button
                    aria-label="组织人员上一页"
                    :disabled="orgPeoplePage === 1"
                    @click="orgPeoplePage--"
                    ><Icon name="e744"
                  /></button>
                  <button class="current">{{ orgPeoplePage }}</button>
                  <button
                    aria-label="组织人员下一页"
                    :disabled="orgPeoplePage >= orgPeoplePages"
                    @click="orgPeoplePage++"
                    ><Icon name="e743"
                  /></button>
                  <span>共 {{ orgPeoplePages }} 页</span>
                </div>
              </template>
              <template v-else>
                <h4 class="sec-h">基本信息</h4>
                <table class="w3-description">
                  <tbody>
                    <tr>
                      <th>组织名称</th>
                      <td>{{ org.name }}</td>
                      <th>组织编码</th>
                      <td>{{ org.id }}</td>
                    </tr>
                    <tr>
                      <th>组织类型</th>
                      <td>{{
                        org.orgType ||
                        (!org.parent ? '公司' : org.parent === 'ORG_ROOT' ? '部门' : '组')
                      }}</td>
                      <th>上级组织</th>
                      <td>{{ org.parent ? deptName(org.parent) : '无上级组织' }}</td>
                    </tr>
                    <tr>
                      <th>负责人</th>
                      <td>{{ org.manager || '—' }}</td>
                      <th>负责人电话</th>
                      <td>{{ org.managerPhone || '—' }}</td>
                    </tr>
                    <tr>
                      <th>启用状态</th>
                      <td>
                        <span class="v-badge" :class="{ blue: org.status === '启用' }">{{
                          org.status
                        }}</span>
                      </td>
                      <th>组织职责</th>
                      <td>{{ org.description || '—' }}</td>
                    </tr>
                  </tbody>
                </table>
              </template>
            </div>
          </div>
          <div v-else-if="route === 'grades' && rankMap" class="v-rank-map">
            <div class="v-hint">同一层级展示不同职务序列，点击职级维护适用范围与任职要求。</div>
            <table class="tbl">
              <thead>
                <tr>
                  <th>对应层级</th>
                  <th v-for="s in db.sequences" :key="s">{{ s }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="level in Array.from({ length: 12 }, (_, i) => 12 - i)" :key="level">
                  <th>{{ level }}</th>
                  <td v-for="s in db.sequences" :key="s">
                    <button
                      v-for="g in db.grades.filter(
                        (g) => Number(g.level) === level && g.sequence === s,
                      )"
                      :key="g.id"
                      class="v-rank-cell"
                      @click="handleAction(editable ? 'edit' : 'view', g)"
                      >{{ g.code }} · {{ g.name }}<div class="v-muted">{{ g.status }}</div>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <template v-else>
            <div v-if="stageTabs.length && route !== 'interviews'" class="v-tabs">
              <button
                v-for="t in ['全部', ...stageTabs]"
                :key="t"
                :class="{ on: tab === t }"
                @click="tab = t"
                >{{ t
                }}<small>{{
                  t === '全部' ? rawRows.length : rawRows.filter((r) => r.stage === t).length
                }}</small>
              </button>
            </div>
            <div class="v-list">
              <OrgTree
                v-if="route === 'roster'"
                :orgs="db.orgs"
                :model-value="query.dept || 'ORG_ROOT'"
                :collapsed="treeCollapsed"
                @update:model-value="orgFilter"
                @collapse="treeCollapsed = !treeCollapsed"
              />
              <div class="v-main">
                <div class="w-list-header">
                  <div class="w-list-header__filters" :class="{ 'is-collapsed': !expanded }">
                    <div class="w-list-header__filters-inner">
                      <div v-if="route !== 'interviews'" class="w-list-header__cell">
                        <label class="w-search-field">
                          <input
                            v-model="query.q"
                            class="inp"
                            :placeholder="
                              route === 'roster' ? '请输入姓名/手机号/工号' : '请输入名称或编码'
                            "
                            aria-label="关键词搜索"
                            @keyup.enter="applyQuery"
                          />
                          <Icon name="search" />
                        </label>
                      </div>
                      <div v-for="f in filterFields" :key="f.key" class="w-list-header__cell">
                        <label v-if="f.key === 'q'" class="w-search-field"
                          ><input
                            v-model="query.q"
                            class="inp"
                            :placeholder="f.label"
                            aria-label="关键词搜索"
                            @keyup.enter="applyQuery" /><Icon name="search"
                        /></label>
                        <template v-else-if="f.key === 'mainDept' && route === 'jobs'"
                          ><FieldControl
                            v-model="query.mainDept"
                            type="select"
                            :options="f.options"
                            :placeholder="f.label"
                            :label="f.label"
                            @update:model-value="query.dept = ''" /><FieldControl
                            v-model="query.dept"
                            type="select"
                            :options="
                              db.orgs
                                .filter((o) => !query.mainDept || within(o.id, query.mainDept))
                                .map((o) => ({
                                  value: o.id,
                                  label:
                                    o.name +
                                    (o.parent === 'ORG_ROOT' || !o.parent ? '（直属）' : ''),
                                }))
                            "
                            placeholder="请选择组织"
                            label="请选择组织"
                        /></template>
                        <span v-else-if="f.key === 'date'" class="w3-control">
                          <RangePicker
                            v-model:value="dateRange"
                            style="width: 100%"
                            :placeholder="['开始日期', '结束日期']"
                            @change="
                              (_, values) => {
                                query.from = values[0];
                                query.to = values[1];
                              }
                            "
                          />
                        </span>
                        <FieldControl
                          v-else
                          v-model="query[f.key]"
                          type="select"
                          :options="f.options"
                          :placeholder="f.label"
                          :label="f.label"
                        />
                      </div>
                    </div>
                  </div>
                  <aside class="w-list-header__aside">
                    <button class="w-toggle" @click="expanded = !expanded"
                      >{{ expanded ? '收起' : '展开'
                      }}<Icon name="ea15" :class="{ 'w3-rotate': expanded }" />
                    </button>
                    <div class="w-filter-actions">
                      <button
                        class="btn w-iconbtn pri-btn"
                        title="查询"
                        aria-label="查询"
                        @click="applyQuery"
                      >
                        <Icon name="search" />
                      </button>
                      <button class="btn w-iconbtn" title="重置" aria-label="重置" @click="reset">
                        <Icon name="reset" />
                      </button>
                      <button
                        class="btn w-iconbtn"
                        title="高级筛选"
                        aria-label="高级筛选"
                        @click="dialog = { kind: 'advanced' }"
                      >
                        <Icon name="filter" />
                      </button>
                    </div>
                  </aside>
                </div>
                <div v-if="advanced[route]?.rules?.length" class="w3-advanced-strip">
                  <b>高级筛选</b>
                  <span v-for="(r, i) in advanced[route].rules" :key="i"
                    >{{ schemas[route]?.find((c) => c.key === r.field)?.label }} {{ r.value }}</span
                  >
                  <button class="v-link" @click="delete advanced[route]">清空</button>
                </div>
                <div v-if="route === 'interviews'" class="v-tabs">
                  <button
                    v-for="t in ['全部', ...stageTabs]"
                    :key="t"
                    :class="{ on: tab === t }"
                    @click="tab = t"
                    >{{ t
                    }}<small>{{
                      t === '全部' ? rawRows.length : rawRows.filter((r) => r.stage === t).length
                    }}</small>
                  </button>
                </div>
                <EntityTable
                  ref="table"
                  :route="route"
                  :rows="filteredRows"
                  :selected="selected"
                  :editable="editable"
                  :is-hr="isHr"
                  :archived="archive"
                  :loading="loading"
                  :reset-key="JSON.stringify([applied, tab, advanced[route]])"
                  @action="handleAction"
                  @select="selected = $event"
                />
              </div>
            </div>
          </template>
        </main>
      </div>
      <div v-if="loading" class="v-busy" role="status">正在加载…</div>
      <EntityEditor
        v-if="dialog?.kind === 'edit'"
        :key="dialog.type + '-' + (dialog.row?.id || 'new') + '-' + (dialog.section || '')"
        :type="dialog.type"
        :row="dialog.row"
        :section="dialog.section"
        :initial="dialog.initial"
        @close="closeDialog"
        @saved="saved"
      />
      <DetailDrawer
        v-if="dialog?.kind === 'detail'"
        :type="dialog.type"
        :row="dialog.row"
        :route="dialog.route"
        :editable="editable"
        :initial-tab="dialog.tab"
        @tab-change="dialog.tab = $event"
        @close="closeDialog"
        @action="handleAction"
        @saved="saved"
      />
      <WorkflowDialog
        v-if="dialog?.kind === 'workflow' && !['reminders', 'sequences'].includes(dialog.action)"
        :kind="dialog.action"
        :type="dialog.type"
        :row="dialog.row"
        :rows="dialog.rows"
        @close="closeDialog"
        @saved="saved"
        @action="handleAction"
      />
      <ReminderDialog
        v-if="dialog?.kind === 'workflow' && dialog.action === 'reminders'"
        @close="closeDialog"
        @saved="saved"
      />
      <SequenceDialog
        v-if="dialog?.kind === 'workflow' && dialog.action === 'sequences'"
        @close="closeDialog"
      />
      <ImportDialog
        v-if="dialog?.kind === 'import'"
        :type="dialog.type"
        :employee-id="dialog.employeeId"
        :db="db"
        @close="closeDialog"
        @saved="saved"
      />
      <ImportRecords
        v-if="dialog?.kind === 'importRecords'"
        :type="dialog.type"
        @close="closeDialog"
      />
      <ResumeBatchDialog
        v-if="dialog?.kind === 'resume'"
        :db="db"
        @close="closeDialog"
        @saved="saved"
      />
      <AdvancedFilter
        v-if="dialog?.kind === 'advanced'"
        :schema="schemas[route] || []"
        :value="advanced[route]"
        :route="route"
        :user-id="user.username"
        @close="closeDialog"
        @apply="
          advanced[route] = $event;
          dialog = null;
        "
      />
    </template>
  </ConfigProvider>
</template>
