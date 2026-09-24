import { reactive, ref, computed } from 'vue';
import { api } from './api';
import { routes } from './config/schema';
export const user = ref(null);
export const db = reactive({
  orgs: [],
  jobs: [],
  jobHistory: [],
  grades: [],
  emps: [],
  reqs: [],
  reqHistory: [],
  candidates: [],
  assets: [],
  baseSettings: { workRegion: [], workplace: [], contractCompany: [] },
  sequences: [],
  rules: {},
});
export const route = ref(location.hash.replace('#/', '') || 'roster');
export const notice = ref('');
export const isHr = computed(() => user.value?.role === 'hr');
export const menus = computed(() => {
  const list = user.value?.menus || [];
  const order = isHr.value
    ? Object.keys(routes)
    : ['reqs', 'screening', 'interviews', 'offers', 'orgs', 'jobs'];
  return order.filter((k) =>
    list.some((m) =>
      typeof m === 'string'
        ? [k, '/' + k].includes(m)
        : [m.code, m.route, m.path, m.id].some((v) => [k, '/' + k].includes(v)),
    ),
  );
});
export function can(permission) {
  const p = user.value?.permissions || [];
  return p.includes('*') || p.includes(permission);
}
export function deptName(id) {
  return db.orgs.find((x) => x.id === id)?.name || '—';
}
export function jobName(id, historicalName = '') {
  return db.jobs.find((x) => x.id === id)?.name || db.jobHistory.find((x) => x.id === id)?.name || historicalName || '—';
}
export function empName(id) {
  return db.emps.find((x) => x.id === id)?.name || (id ? '人员不存在' : '未分配');
}
export function reqName(id) {
  return db.reqs.find((x) => x.id === id)?.name || db.reqHistory.find((x) => x.id === id)?.name || '—';
}
export function within(id, parent) {
  if (!parent) return true;
  const seen = new Set();
  while (id && !seen.has(id)) {
    if (id === parent) return true;
    seen.add(id);
    id = db.orgs.find((o) => o.id === id)?.parent;
  }
  return false;
}
export function topDept(id) {
  let o = db.orgs.find((x) => x.id === id),
    seen = new Set();
  while (o?.parent && o.parent !== 'ORG_ROOT' && !seen.has(o.id)) {
    seen.add(o.id);
    o = db.orgs.find((x) => x.id === o.parent);
  }
  return o;
}
export function jobStaffed(row) {
  return db.emps.filter((e) => e.job === row.id && !e.deletedAt && e.status !== '已离职').length;
}
export function reqArrived(row) {
  return db.candidates.filter((c) => c.req === row.id && c.stage === '已入职').length;
}
export function reqCapacity(row, draft = row || {}) {
  const job = db.jobs.find((j) => j.id === draft.job);
  if (!job) return null;
  const headcount = Number(job.headcount || 0),
    occupied = jobStaffed(job),
    leaving =
      draft.type === '替补'
        ? db.emps.filter((e) => e.job === job.id && e.status === '待离职' && !e.deletedAt).length
        : 0,
    otherInTransit = db.reqs
      .filter((r) => r.id !== row?.id && r.job === job.id && ['招聘中', '暂停'].includes(r.status))
      .reduce((n, r) => n + Math.max(0, Number(r.count || 0) - reqArrived(r)), 0),
    currentInTransit = ['招聘中', '暂停'].includes(draft.status)
      ? Math.max(0, Number(draft.count || 0) - (row ? reqArrived(row) : 0))
      : 0,
    available = Math.max(0, headcount - occupied - otherInTransit + leaving),
    projected = occupied + otherInTransit + currentInTransit - leaving;
  return {
    job,
    headcount,
    occupied,
    otherInTransit,
    currentInTransit,
    available,
    projected,
    over: Math.max(0, currentInTransit - available),
    leaving,
  };
}
export function jobRecruiting(row) {
  return db.reqs
    .filter((r) => r.job === row.id && ['招聘中', '暂停'].includes(r.status))
    .reduce((s, r) => s + Math.max(0, Number(r.count) - reqArrived(r)), 0);
}
export function capacity(row) {
  const n = Number(row.headcount || 0) - jobStaffed(row);
  return {
    key: n > 0 ? 'vacancy' : n < 0 ? 'over' : 'full',
    label: n > 0 ? '空编 ' + n : n < 0 ? '超编 ' + -n : '满编',
  };
}
export const lastInterview = (row) => row?.interviews?.at(-1);
export async function refresh() {
  const data = await api('/bootstrap');
  if (Array.isArray(data?.jobs)) db.jobHistory = data.jobs;
  if (Array.isArray(data?.reqs)) db.reqHistory = data.reqs;
  for (const key of Object.keys(db))
    if (data?.[key] !== undefined) {
      const value = data[key];
      db[key] =
        ['orgs', 'jobs', 'grades', 'reqs', 'candidates', 'assets'].includes(key) &&
        Array.isArray(value)
          ? value.filter(
              (row) =>
                !row.deletedAt && !row.deleted_at && row.deleted !== true && row.archived !== true,
            )
          : value;
    }
  if (data?.user) user.value = data.user;
  if (Array.isArray(db.baseSettings))
    db.baseSettings = data.dictionary ||
      data.settings || { workRegion: [], workplace: [], contractCompany: [] };
  if (!Object.keys(db.baseSettings || {}).length || !db.baseSettings.workRegion?.length) {
    const results = await Promise.all(
      ['workRegion', 'workplace', 'contractCompany'].map(async (k) => [
        k,
        await api('/settings/' + k),
      ]),
    );
    for (const [k, v] of results) db.baseSettings[k] = v.items || v;
  }
  if (!db.sequences?.length)
    db.sequences = [...new Set(db.grades.map((g) => g.sequence).filter(Boolean))];
}
export function navigate(target) {
  const fallback = isHr.value ? 'roster' : 'screening';
  const next = menus.value.includes(target)
    ? target
    : menus.value.includes(fallback)
      ? fallback
      : menus.value[0] || fallback;
  const proceed = () => {
    route.value = next;
    history.replaceState(null, '', '#/' + next);
  };
  if (next !== route.value) {
    const event = new CustomEvent('hr:before-navigate', {
      cancelable: true,
      detail: { target: next, proceed },
    });
    if (!window.dispatchEvent(event)) {
      history.replaceState(null, '', '#/' + route.value);
      return false;
    }
  }
  proceed();
  return true;
}
export function clearSession() {
  user.value = null;
  for (const k of ['orgs', 'jobs', 'grades', 'emps', 'reqs', 'candidates', 'assets', 'sequences'])
    db[k] = [];
  db.rules = {};
  db.baseSettings = { workRegion: [], workplace: [], contractCompany: [] };
}
