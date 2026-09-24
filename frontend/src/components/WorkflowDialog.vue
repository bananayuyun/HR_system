<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import DialogFrame from './DialogFrame.vue';
import FieldControl from './FieldControl.vue';
import { api, downloadFile, fileBlob } from '../api';
import { db, isHr, user, lastInterview, within } from '../store';
import { materialTypes } from '../config/schema';
import QRCode from 'qrcode';
import { readDocxText } from '../utils/docx-preview';
const props = defineProps({
  kind: String,
  type: String,
  row: Object,
  rows: Array,
  departmentScreening: Boolean,
});
const emit = defineEmits(['close', 'saved', 'action']);
const today = new Date().toLocaleDateString('sv-SE'),
  form = ref(),
  error = ref(''),
  busy = ref(false),
  qr = ref([]),
  file = ref(null),
  previewUrl = ref(''),
  checkMessage = ref('');
const previewText = ref(''),
  previewTruncated = ref(false),
  previewLoading = ref(false),
  previewAbort = new AbortController();
const request = db.reqs.find((r) => r.id === props.row?.req) || db.reqHistory.find((r) => r.id === props.row?.req),
  interview = lastInterview(props.row || {}),
  pending =
    interview &&
    props.row &&
    interview.round === props.row.stage &&
    ['待面试', '待评价', '待改期'].includes(interview.status)
      ? interview
      : null;
const ownVote =
  props.kind === 'interviewResult'
    ? interview?.votes?.find((vote) =>
        vote.operatorId != null
          ? String(vote.operatorId) === String(user.value?.id)
          : vote.operator === user.value?.displayName,
      )
    : null;
const transitions = {
  待入职: ['确认入职', '延期入职', '未到岗', '放弃入职', '取消入职'],
  延期入职: ['确认入职', '调整入职日期', '未到岗', '放弃入职', '取消入职'],
  未到岗: ['重新安排入职', '放弃入职', '取消入职'],
  放弃入职: ['重新安排入职'],
  取消入职: ['重新安排入职'],
};
const data = ref({
  result: props.kind === 'interviewResult' ? ownVote?.result || '' : props.row?.result || '通过',
  reason: '',
  date: pending?.date || today,
  start: pending?.start || '14:00',
  end: pending?.end || '15:00',
  round: props.row?.stage || '初试',
  interviewerIds: [
    ...(pending?.interviewerIds ||
      (props.row?.stage === '复试' ? request?.secondIds : request?.firstIds) ||
      []),
  ],
  method: pending?.method || '现场面试',
  place: pending?.place || request?.workplace || request?.office || '',
  evaluation: ownVote?.evaluation || '',
  handler: user.value?.displayName || '',
  action: props.row?.action || transitions[props.row?.stage]?.[0] || '确认入职',
  onboard: props.row?.onboard || request?.deadline || today,
  employeeId: props.row?.employeeId || '',
  grade: props.row?.contractGrade || '',
  workRegion: props.row?.workRegion || props.row?.location || '',
  workplace: props.row?.workplace || props.row?.office || '',
  contractCompany: props.row?.contractCompany || props.row?.company || '',
  entryNotes: props.row?.entryNotes || '',
  version: props.row?.version,
  leaveDate: today,
  type: '培训',
  title: '',
  detail: '',
  owner: '',
  location: props.row?.workRegion || props.row?.location || '',
  office: props.row?.office || '',
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
  sequence: '',
  enabled: db.rules?.enabled ?? true,
  workdays: db.rules?.workdays ?? true,
  times: db.rules?.times || ['10:00', '14:00', '17:00'],
  channel: '系统站内提醒',
  category: props.row?.category || materialTypes[0],
});
if (props.kind === 'timelineEdit')
  Object.assign(data.value, { ...props.row.item, date: props.row.item.date.slice(0, 10) });
if (props.kind === 'candidateActions') data.value.action = '改期';
const initial = JSON.stringify(data.value),
  dirty = computed(() => JSON.stringify(data.value) !== initial || !!file.value);
const assetNames = {
  assign: '领用资产',
  return: '归还资产',
  transfer: '转移资产',
  'repair-start': '开始维修',
  'repair-end': '完成维修',
  scrap: '资产报废',
  location: '变更存放位置',
};
const screenConfirmation = computed(() => props.kind === 'screening' && !!props.row?.result),
  screeningPass = computed(() => data.value.result === '通过'),
  hrScreening = computed(() => isHr.value && !props.departmentScreening);
const title = computed(() => {
  if (screenConfirmation.value)
    return screeningPass.value
      ? '确认筛选通过'
      : { 暂缓: '确认暂缓筛选', 未通过: '确认筛选不通过', 候选人取消: '确认候选人取消' }[
          data.value.result
        ] || '确认筛选处理';
  if (props.kind === 'screening')
    return (hrScreening.value ? 'HR 筛选' : '部门筛选') + ' · ' + props.row.name;
  if (props.kind === 'schedule')
    return (pending ? '调整' : '安排') + props.row.stage + ' · ' + props.row.name;
  if (props.kind === 'interviewResult') return props.row.stage + '结果 · ' + props.row.name;
  if (props.kind === 'onboarding') return '入职处理 · ' + props.row.name;
  if (props.kind === 'cancelOnboarding') return '取消入职 · ' + props.row.name;
  if (props.kind === 'previewFile') return '文件预览 · ' + props.row.file.name;
  return (
    {
      permanentDelete: '彻底删除员工档案',
      reinstate: '复职',
      delete: props.type === 'reqs' ? '删除招聘需求' : '删除记录',
      batchScreen: '批量筛选 · ' + (props.rows?.length || 0) + ' 人',
      cancelInterview: '取消面试安排',
      candidateActions: '候选人流程处理',
      timeline: '新增成长记录',
      timelineEdit: '编辑成长记录',
      timelineDelete: '删除成长记录',
      employeeUpload: '上传档案材料',
      previewFile: '文件预览',
      leave: '办理离职',
      asset: assetNames[props.row?.action] || '资产操作',
      password: '修改密码',
      audit: '操作日志',
      qr: '资产二维码',
      qrBatch: '资产二维码',
      sequences: '管理职务序列',
      reminders: '待筛选提醒规则',
    }[props.kind] || '确认操作'
  );
});
const f = (key, label, type = 'text', required = false, options = [], help = '') => ({
  key,
  label,
  type,
  required,
  options,
  help,
});
const employees = computed(() =>
  db.emps
    .filter(
      (e) =>
        !e.deletedAt &&
        !e.archived &&
        !e.deleted &&
        !['已离职', '待离职'].includes(e.status) &&
        (props.kind !== 'asset' || e.status !== '待离职'),
    )
    .map((e) => ({ value: e.id, label: e.name + ' / ' + e.id })),
);
const dict = (k) =>
  (db.baseSettings[k] || []).filter((x) => x.status === '启用').map((x) => x.name);
const fields = computed(() => {
  switch (props.kind) {
    case 'screening':
    case 'batchScreen':
      return screenConfirmation.value
        ? []
        : [
            f('handler', '处理负责人', 'select', true, [data.value.handler]),
            f('result', '筛选结果', 'select', true, [
              {
                value: '通过',
                label: hrScreening.value ? '通过，提交部门筛选' : '通过并进入初试',
              },
              { value: '暂缓', label: '暂缓筛选' },
              '未通过',
              '候选人取消',
            ]),
            f('reason', '处理说明', 'textarea'),
          ];
    case 'schedule':
      return [
        f('round', '面试轮次', 'select', true, [props.row.stage]),
        f('interviewerIds', '面试官', 'multi', true, employees.value),
        f('date', '面试日期', 'date', true),
        f('method', '面试方式', 'select', true, ['现场面试', '视频面试', '电话面试']),
        f('start', '开始时间', 'time', true),
        f('end', '结束时间', 'time', true),
        f('place', '面试地点 / 会议链接', 'text', true),
      ];
    case 'interviewResult':
      return [
        f('result', '此次面试结果', 'select', true, [
          '通过',
          '未通过',
          '待定',
          '候选人取消',
          '未到场 / 改期',
        ]),
        f(
          'evaluation',
          '备注',
          'textarea',
          false,
          [],
          '选择“通过”或“未通过”时必填，其它结果可不填写。',
        ),
      ];
    case 'candidateActions':
      return [
        f('action', '处理动作', 'select', true, ['改期', '取消面试', '候选人取消', '未到场']),
        f('reason', '处理说明', 'textarea', true),
      ];
    case 'onboarding':
      return [
        f('action', '下一步处理', 'select', true, transitions[props.row.stage] || []),
        f('onboard', '计划 / 实际入职日', 'date', true),
        f('employeeId', '入职工号', 'text', false, [], '确认入职时必填，须与现有工号不同'),
        f(
          'grade',
          '签约职级',
          'select',
          true,
          db.grades
            .filter(
              (g) =>
                g.status === '启用' &&
                (g.scope === '全部部门' ||
                  within(props.row.dept, db.orgs.find((o) => o.name === g.scope)?.id)),
            )
            .map((g) => g.code),
        ),
        f('workRegion', '工作片区', 'select', true, dict('workRegion')),
        f('workplace', '工作所在地', 'select', true, dict('workplace')),
        f('contractCompany', '合同归属', 'select', true, dict('contractCompany')),
        f('entryNotes', '处理说明', 'textarea'),
      ];
    case 'cancelInterview':
      return [f('reason', '取消原因', 'textarea', true)];
    case 'cancelOnboarding':
      return [f('reason', '取消原因', 'textarea', true)];
    case 'timeline':
    case 'timelineEdit':
      return [
        f('date', '日期', 'date', true),
        f('type', '事件类型', 'select', true, [
          ...new Set([
            '入职',
            '转正',
            '晋升',
            '调薪',
            '调岗',
            '奖励',
            '处分',
            '绩效',
            '培训',
            '其它',
            ...(props.kind === 'timelineEdit' && props.row?.item?.type
              ? [props.row.item.type]
              : []),
          ]),
        ]),
        f('title', '事件标题', 'text', true),
        f('detail', '事件说明', 'textarea', true),
      ];
    case 'employeeUpload':
      return [
        f('category', '材料分类', 'select', true, [
          ...new Set([...materialTypes, '劳动合同', '入职材料', '资格证书', '其它']),
        ]),
      ];
    case 'leave':
      return [f('leaveDate', '离职日期', 'date', true), f('reason', '离职原因', 'textarea', true)];
    case 'asset':
      return [
        ...(['assign', 'transfer'].includes(props.row.action)
          ? [
              f(
                'owner',
                '使用人',
                'select',
                true,
                employees.value.filter((e) => e.value !== props.row.owner),
              ),
            ]
          : []),
        f('location', '工作片区', 'select', true, dict('workRegion')),
        f('office', props.row.action === 'return' ? '存放位置' : '使用位置', 'text', true),
        f('reason', '办理说明', 'textarea', true),
      ];
    case 'password':
      return [
        f('oldPassword', '当前密码', 'password', true),
        f('newPassword', '新密码', 'password', true),
        f('confirmPassword', '确认新密码', 'password', true),
      ];
    default:
      return [];
  }
});
const logs = ref(props.row?.audit || props.row?.history || props.row?.timeline || []),
  sequences = ref([...(db.sequences || [])]);
const screenMessage = computed(() =>
  screeningPass.value
    ? '确定将“' +
      props.row?.name +
      '”筛选通过' +
      (hrScreening.value ? '，并转交部门主管筛选' : '并进入初试') +
      '吗？'
    : '确定将“' +
      props.row?.name +
      '”标记为' +
      (data.value.result === '暂缓'
        ? '暂缓筛选'
        : data.value.result === '未通过'
          ? '筛选不通过'
          : data.value.result) +
      '吗？',
);
const screenEffect = computed(() =>
  screeningPass.value
    ? hrScreening.value
      ? '确认后状态变为“待部门筛选”，该候选人将从 HR 待办中移除，并同步进入部门主管待办。'
      : '确认后将进入面试管理，其他负责人看到的状态会同步更新。'
    : data.value.result === '暂缓'
      ? '确认后仍保留在当前角色的简历筛选列表，可稍后继续处理。'
      : '确认后将结束该候选人的当前招聘流程，其他负责人看到的状态会同步更新。',
);
const readOnly = computed(() => ['audit', 'qr', 'qrBatch', 'previewFile'].includes(props.kind));
const previewType = computed(() =>
  /\.pdf$/i.test(props.row?.file?.name || '')
    ? 'pdf'
    : /\.(png|jpe?g|webp)$/i.test(props.row?.file?.name || '')
      ? 'image'
      : /\.docx$/i.test(props.row?.file?.name || '')
        ? 'docx'
        : 'download',
);
onMounted(async () => {
  try {
    if (['qr', 'qrBatch'].includes(props.kind)) {
      const list = props.kind === 'qr' ? [props.row] : props.rows || [];
      if (!list.length) throw new Error('请先选择或筛选资产。');
      qr.value = await Promise.all(
        list.map(async (row) => {
          const segments = [{ data: 'HR-ASSET:' + row.id, mode: 'byte' }],
            code = QRCode.create(segments, { errorCorrectionLevel: 'M' }),
            svg = await QRCode.toString(segments, {
              type: 'svg',
              errorCorrectionLevel: 'M',
              margin: 0.8,
              width: code.modules.size * 5 + 8,
            });
          return { row, svg };
        }),
      );
      if (props.kind === 'qrBatch') {
        exportQrLabels();
        emit('saved', '已导出 ' + list.length + ' 个可打印二维码标签。');
      }
    }
    if (props.kind === 'audit') {
      if (props.type === 'jobs')
        logs.value = await api('/jobs/' + props.row.id + '/audit');
      else {
        const record = await api('/' + props.type + '/' + props.row.id);
        logs.value = record.audit || record.history || record.timeline || [];
      }
    }
    if (props.kind === 'previewFile' && previewType.value !== 'download') {
      previewLoading.value = true;
      const blob = await fileBlob('/' + props.type + '/files/' + props.row.file.id);
      previewAbort.signal.throwIfAborted();
      if (previewType.value === 'docx') {
        const result = await readDocxText(blob, previewAbort.signal);
        previewText.value = result.text;
        previewTruncated.value = result.truncated;
      } else previewUrl.value = URL.createObjectURL(blob);
    }
  } catch (e) {
    if (e.name !== 'AbortError') error.value = e.message;
  } finally {
    previewLoading.value = false;
  }
});
onBeforeUnmount(() => {
  previewAbort.abort();
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
});
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function downloadQr(item) {
  downloadBlob(new Blob([item.svg], { type: 'image/svg+xml' }), item.row.id + '-二维码.svg');
}
async function downloadAttachment() {
  try {
    await downloadFile('/' + props.type + '/files/' + props.row.file.id, props.row.file.name);
  } catch (cause) {
    error.value = cause.message;
  }
}
function exportQrLabels() {
  const escape = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
    );
  const html =
    '<!doctype html><meta charset="utf-8"><title>资产标签</title><style>body{font:14px sans-serif;display:flex;flex-wrap:wrap;gap:16px}.label{width:220px;text-align:center;border:1px solid #aaa;padding:16px;break-inside:avoid}.label svg{width:160px;height:160px}h3{font-size:14px}p{font-size:12px}@media print{body{gap:8mm}.label{width:50mm;padding:4mm}}</style>' +
    qr.value
      .map(
        ({ row, svg }) =>
          `<section class="label">${svg}<h3>${escape(row.name)}</h3><p>${escape(row.id)}</p><p>${escape(row.office)}</p></section>`,
      )
      .join('');
  downloadBlob(
    new Blob([html], { type: 'text/html;charset=utf-8' }),
    '资产二维码标签_' + today + '.html',
  );
}
function valid() {
  error.value = '';
  if (form.value && !form.value.reportValidity()) return false;
  for (const field of fields.value) {
    const v = data.value[field.key];
    if (
      field.required &&
      (v === undefined || v === null || String(v).trim() === '' || (Array.isArray(v) && !v.length))
    ) {
      error.value = '请填写' + field.label;
      return false;
    }
  }
  return true;
}
async function checkInterview() {
  if (!valid()) return;
  busy.value = true;
  checkMessage.value = '';
  try {
    const result = await api('/candidates/' + props.row.id + '/actions/interview-check', {
      method: 'POST',
      body: {
        date: data.value.date,
        start: data.value.start,
        end: data.value.end,
        interviewerIds: data.value.interviewerIds,
      },
    });
    checkMessage.value = result.available
      ? '未发现时间冲突，可以保存安排。'
      : (result.conflicts || [])
          .map(
            (c) =>
              c.interviewerName +
              '：' +
              c.date +
              ' ' +
              c.start +
              '–' +
              c.end +
              ' ' +
              (c.candidateName || '已有面试'),
          )
          .join('；');
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
async function save() {
  if (!valid()) return;
  const p = data.value,
    id = props.row?.id;
  if (props.kind === 'schedule' && p.end <= p.start) {
    error.value = '面试结束时间必须晚于开始时间。';
    return;
  }
  if (props.kind === 'schedule' && p.date < today) {
    error.value = '面试日期不能早于今天。';
    return;
  }
  if (
    props.kind === 'interviewResult' &&
    ['通过', '未通过'].includes(p.result) &&
    !p.evaluation.trim()
  ) {
    error.value = '选择“' + p.result + '”时，请填写备注。';
    return;
  }
  if (props.kind === 'onboarding' && p.action === '确认入职' && !p.employeeId.trim()) {
    error.value = '请填写入职工号。';
    return;
  }
  if (props.kind === 'onboarding' && p.action !== '确认入职' && !p.entryNotes.trim()) {
    error.value = '请填写处理说明。';
    return;
  }
  if (props.kind === 'password' && p.newPassword !== p.confirmPassword) {
    error.value = '两次输入的新密码不一致。';
    return;
  }
  if (props.kind === 'password' && p.newPassword.length < 8) {
    error.value = '新密码至少需要 8 位。';
    return;
  }
  if (props.kind === 'candidateActions' && p.action === '改期') {
    emit('action', 'schedule', props.row);
    return;
  }
  if (
    props.kind === 'employeeUpload' &&
    (!file.value ||
      file.value.size > 20 * 1024 * 1024 ||
      !/\.(pdf|png|jpe?g|webp|docx)$/i.test(file.value.name))
  ) {
    error.value = '请选择 PDF、图片或 DOCX 文件，单个文件不超过 20 MB。';
    return;
  }
  busy.value = true;
  try {
    let path = '',
      body = {},
      method = 'POST';
    if (props.kind === 'permanentDelete') {
      path = '/emps/' + id + '/permanent';
      method = 'DELETE';
    } else if (['archive', 'delete'].includes(props.kind)) {
      path = '/' + props.type + '/' + id;
      method = 'DELETE';
      body = { reason: p.reason, version: props.row.version };
    } else if (props.kind === 'restore') path = '/' + props.type + '/' + id + '/restore';
    else if (props.kind === 'password') {
      path = '/auth/password';
      body = { oldPassword: p.oldPassword, newPassword: p.newPassword };
    } else if (props.kind === 'sequences') {
      path = '/settings/sequences';
      method = 'PUT';
      body = { items: sequences.value };
    } else if (props.kind === 'reminders') {
      path = '/settings/reminders';
      method = 'PUT';
      body = { enabled: p.enabled, workdays: p.workdays, times: p.times, channel: p.channel };
    } else if (props.kind === 'employeeUpload') {
      path = '/emps/' + id + '/files';
      body = new FormData();
      body.append('file', file.value);
      body.append('category', p.category);
    } else if (props.kind === 'batchScreen') {
      const result = await api('/candidates/actions/batch-screening', {
        method: 'POST',
        body: { ids: (props.rows || []).map((row) => row.id), result: p.result, reason: p.reason },
      });
      emit('saved', '已完成 ' + result.count + ' 条简历筛选');
      return;
    } else {
      let action = {
        screening: 'screening',
        schedule: 'schedule',
        interviewResult: 'interview-result',
        candidateActions: 'interview-cancel',
        cancelInterview: 'interview-cancel',
        onboarding: 'onboarding',
        cancelOnboarding: 'onboarding',
        timeline: 'timeline',
        timelineEdit: 'timeline-update',
        timelineDelete: 'timeline-delete',
        leave: 'leave',
        reinstate: 'reinstate',
        asset: props.row?.action,
      }[props.kind];
      if (props.kind === 'screening') body = { result: p.result, reason: p.reason };
      if (props.kind === 'schedule')
        body = {
          round: p.round,
          date: p.date,
          start: p.start,
          end: p.end,
          interviewerIds: p.interviewerIds,
          method: p.method,
          place: p.place,
        };
      if (props.kind === 'interviewResult')
        body = { interviewId: interview?.id, result: p.result, evaluation: p.evaluation };
      if (props.kind === 'cancelInterview') body = { interviewId: interview?.id, reason: p.reason };
      if (props.kind === 'candidateActions') {
        body = { interviewId: interview?.id, reason: p.reason };
        if (['候选人取消', '未到场'].includes(p.action)) {
          action = 'interview-result';
          body = {
            interviewId: interview?.id,
            result: p.action === '未到场' ? '未到场 / 改期' : '候选人取消',
            evaluation: p.reason,
          };
        }
      }
      if (props.kind === 'onboarding')
        body = Object.fromEntries(
          [
            'action',
            'onboard',
            'employeeId',
            'grade',
            'workRegion',
            'workplace',
            'contractCompany',
            'entryNotes',
          ].map((k) => [k, p[k]]),
        );
      if (props.kind === 'cancelOnboarding') body = { action: '取消入职', entryNotes: p.reason };
      if (['timeline', 'timelineEdit', 'timelineDelete'].includes(props.kind))
        body = {
          date: p.date,
          type: p.type,
          title: p.title,
          detail: p.detail,
          timelineId: props.row?.item?.id,
        };
      if (props.kind === 'leave')
        body = { leaveDate: p.leaveDate, reason: p.reason, version: props.row.version };
      if (props.kind === 'reinstate') body = { version: props.row.version };
      if (props.kind === 'asset')
        body = {
          ...(['assign', 'transfer'].includes(action) ? { owner: p.owner } : {}),
          workRegion: p.location,
          location: p.location,
          office: p.office,
          reason: p.reason,
          version: props.row.version,
        };
      path = '/' + props.type + '/' + id + '/actions/' + action;
    }
    await api(path, { method, body });
    emit('saved', props.kind === 'password' ? '密码已修改，请重新登录。' : title.value + '已完成');
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <DialogFrame
    v-if="kind !== 'qrBatch' || error"
    :title="title"
    :wide="['audit', 'previewFile'].includes(kind)"
    :narrow="!['audit', 'previewFile'].includes(kind)"
    :busy="busy"
    :error="error"
    :dirty="!readOnly && dirty"
    @close="emit('close')"
  >
    <template v-if="kind === 'audit'"
      ><ol class="v-timeline"
        ><li v-for="(item, i) in logs" :key="i"
          ><b>{{ item.type || item.action || item.title }}</b
          ><p>{{ item.detail || item.reason }}</p
          ><span class="v-muted"
            >{{ item.date || item.createdAt }} · {{ item.operator || item.actorName }}</span
          ><table v-if="item.changes?.length" class="v-mini-table"
            ><thead
              ><tr><th>字段</th><th>变更前</th><th>变更后</th></tr></thead
            ><tbody
              ><tr v-for="c in item.changes" :key="c.field"
                ><td>{{ c.label || c.field }}</td
                ><td>{{ c.before }}</td
                ><td>{{ c.after }}</td></tr
              ></tbody
            ></table
          ></li
        ></ol
      ><p v-if="!logs.length" class="v-history-empty">暂无日志记录</p></template
    >
    <template v-else-if="kind === 'qr'"
      ><div v-for="item in qr" :key="item.row.id" class="v-print-qr"
        ><div v-html="item.svg" /><h3>{{ item.row.name }}</h3
        ><p>{{ item.row.id }}</p
        ><p class="v-muted"
          >二维码内容：HR-ASSET:{{ item.row.id
          }}<br />可用于资产唯一识别，正式系统上线后绑定资产详情地址。</p
        ></div
      ></template
    >
    <template v-else-if="kind === 'previewFile'"
      ><p v-if="previewLoading" class="v-muted" role="status">正在读取文件…</p
      ><object
        v-if="previewUrl && previewType === 'pdf'"
        class="v-preview"
        :data="previewUrl"
        type="application/pdf"
        ><p>浏览器不支持 PDF 内嵌预览，请使用下载按钮查看。</p></object
      ><img
        v-else-if="previewUrl && previewType === 'image'"
        class="v-preview"
        :src="previewUrl"
        :alt="row.file.name"
      /><template v-else-if="previewType === 'docx'"
        ><div v-if="previewText" class="v-document">{{ previewText }}</div
        ><p class="v-muted"
          >Word 文本预览，原始排版请下载文件查看。<span v-if="previewTruncated"
            >当前仅显示前 20 万字。</span
          ></p
        ></template
      ><div v-else-if="previewType === 'download'" class="v-hint"
        >此文件格式（含旧版 .doc）请下载后查看。</div
      ></template
    >
    <template v-else-if="kind === 'sequences'"
      ><div v-for="(s, i) in sequences" :key="i" class="v-columns"
        ><input v-model="sequences[i]" class="inp" aria-label="职务序列名称" /><button
          class="v-link"
          @click="sequences.splice(i, 1)"
          >删除</button
        ></div
      ><div class="row" style="margin-top: 16px"
        ><input v-model="data.sequence" class="inp" placeholder="新增职务序列" /><button
          class="btn"
          :disabled="!data.sequence.trim()"
          @click="
            sequences.push(data.sequence.trim());
            data.sequence = '';
          "
          >添加</button
        ></div
      ></template
    >
    <template v-else-if="kind === 'reminders'"
      ><div class="v-form"
        ><label class="chk"><input v-model="data.enabled" type="checkbox" />启用待筛选提醒</label
        ><label class="chk"><input v-model="data.workdays" type="checkbox" />仅工作日提醒</label
        ><div class="v-field full"
          ><label>提醒时刻</label
          ><div class="v-reminder-times"
            ><input
              v-for="(t, i) in data.times"
              :key="i"
              v-model="data.times[i]"
              type="time"
              class="inp" /></div></div></div
      ><div class="v-hint" style="margin-top: 24px"
        >当前待 HR 筛选
        {{ db.candidates.filter((c) => c.stage === '待 HR 筛选').length }} 份，待部门筛选
        {{ db.candidates.filter((c) => c.stage === '待部门筛选').length }} 份。</div
      ></template
    >
    <template v-else-if="screenConfirmation"
      ><p>{{ screenMessage }}</p
      ><p class="v-muted">{{ screenEffect }}</p></template
    >
    <form v-else ref="form" @submit.prevent="save">
      <template v-if="kind === 'cancelOnboarding'"
        ><p>确定取消“{{ row.name }}”的本次入职安排吗？</p
        ><div class="v-hint"
          >取消后保留候选人、面试记录和全部操作记录，可在入职管理中重新安排。</div
        ></template
      >
      <div v-else-if="kind === 'onboarding'" class="v-hint"
        >当前状态：{{ row.stage }}。确认入职后将自动建立员工档案，并从入职管理移出。</div
      >
      <div v-else-if="kind === 'interviewResult'" class="v-hint"
        >{{ interview?.date }} {{ interview?.start }}–{{ interview?.end }}<br />面试官：{{
          interview?.interviewer
        }}</div
      >
      <div v-else-if="['screening', 'batchScreen'].includes(kind)" class="v-hint">{{
        hrScreening
          ? 'HR 通过后交给招聘需求配置的部门筛选负责人，不直接进入初试。'
          : '筛选通过后进入初试，其他筛选负责人可同步查看处理结果。'
      }}</div>
      <p v-else-if="kind === 'permanentDelete'"
        >确定彻底删除员工【{{ row.name }}】吗？须先办理离职，并解除账号、业务和档案材料关联。</p
      >
      <p v-else-if="kind === 'reinstate'">确定为员工【{{ row.name }}】办理复职吗？</p>
      <p v-else-if="kind === 'delete' && type === 'reqs'"
        >确定删除【{{ row.name || row.code }}】吗？关联候选人的招聘历史会保留。</p
      >
      <p v-else-if="kind === 'delete'"
        >确定删除【{{ row.name || row.code }}】吗？已被业务使用的记录不能删除。</p
      >
      <p v-else-if="kind === 'timelineDelete'">确定删除这条成长记录吗？</p>
      <div class="v-form"
        ><div
          v-for="field in fields"
          :key="field.key"
          class="v-field"
          :class="{ full: field.type === 'textarea' }"
          ><label :for="'field-' + field.key"><i v-if="field.required">*</i>{{ field.label }}</label
          ><FieldControl v-model="data[field.key]" v-bind="field" :name="field.key" /><span
            v-if="field.help"
            class="help"
            >{{ field.help }}</span
          ></div
        ></div
      >
      <template v-if="kind === 'schedule'"
        ><div class="v-hint"
          >保存时检查每位面试官的时间冲突。可下载日历文件；当前未连接钉钉日程。</div
        ><p role="status">{{ checkMessage }}</p></template
      >
      <div v-if="kind === 'interviewResult'" class="v-hint"
        >任一面试官选择“通过”或“未通过”，本轮即按该选择形成最终结果，并同步给其他面试官。</div
      >
      <label v-if="kind === 'employeeUpload'" class="v-file-box"
        >选择材料文件<input
          name="file"
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.docx"
          required
          @change="file = $event.target.files[0]"
        /><span class="v-muted">单次上传一个文件，最大 20 MB。</span></label
      >
    </form>
    <template #footer="{ requestClose }"
      ><button class="btn" :disabled="busy" @click="requestClose">{{
        readOnly ? '关闭' : kind === 'cancelOnboarding' ? '返回' : '取消'
      }}</button
      ><button v-if="kind === 'previewFile'" class="btn" @click="downloadAttachment"
        >下载文件</button
      ><button v-if="kind === 'qr' && qr[0]" class="btn pri-btn" @click="downloadQr(qr[0])"
        >下载二维码</button
      ><button v-if="kind === 'schedule'" class="btn" :disabled="busy" @click="checkInterview"
        >检查时间冲突</button
      ><button
        v-if="!readOnly"
        class="btn"
        :class="kind === 'cancelOnboarding' ? 'danger' : 'pri-btn'"
        :disabled="busy"
        @click="save"
        >{{ busy ? '处理中…' : screenConfirmation && screeningPass ? '确认通过' : '确定' }}</button
      ></template
    >
  </DialogFrame>
</template>
