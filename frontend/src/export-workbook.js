import metadata from './config/prototype-metadata.json';
import { api } from './api';
import { deptName, jobName, topDept } from './store';

export async function downloadWorkbook(workbook, name) {
  for (const sheet of workbook.worksheets) {
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.columns.forEach((c) => (c.width = 24));
  }
  const data = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name + '.xlsx';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function workbook() {
  const { default: ExcelJS } = await import('exceljs');
  return new ExcelJS.Workbook();
}
export function employeeValue(row, key, index = 0) {
  if (key === 'sourceIndex') return index + 1;
  if (key === 'department' || key === 'mainDept')
    return row.pendingDepartment || deptName(row.mainDept || topDept(row.dept)?.id);
  if (key === 'dept') return deptName(row.dept);
  if (key === 'group')
    return row.pendingGroup || (row.dept === topDept(row.dept)?.id ? '' : deptName(row.dept));
  if (key === 'job') return row.pendingJob || jobName(row.job, row.historicalJobName);
  if (
    key === 'sourceAge' &&
    !row.sourceAge &&
    row.birthday &&
    /^\d{4}-\d{2}-\d{2}$/.test(row.birthday)
  ) {
    const d = new Date(),
      b = new Date(row.birthday);
    return (
      d.getFullYear() -
      b.getFullYear() -
      (d.getMonth() < b.getMonth() || (d.getMonth() === b.getMonth() && d.getDate() < b.getDate())
        ? 1
        : 0)
    );
  }
  if (
    key === 'birthMonth' &&
    !row.birthMonth &&
    row.birthday &&
    /^\d{4}-\d{2}-\d{2}$/.test(row.birthday)
  )
    return Number(row.birthday.slice(5, 7)) + '月';
  if (key === 'sourceTenure' && !row.sourceTenure && row.entry) {
    const d = new Date(row.leaveDate || Date.now()),
      b = new Date(row.entry);
    return Math.max(0, (d.getFullYear() - b.getFullYear()) * 12 + d.getMonth() - b.getMonth());
  }
  const value = row[key];
  return Array.isArray(value) ? value.join('、') : (value ?? '');
}
export async function exportRoster(rows) {
  const records = new Array(rows.length);
  let cursor = 0;
  // Decryption is authorized and audited by the API; do not put clear text in a
  // shared store or localStorage. Limit parallel requests to the database pool.
  await Promise.all(
    Array.from({ length: Math.min(4, rows.length) }, async () => {
      while (cursor < rows.length) {
        const i = cursor++;
        records[i] = {
          ...rows[i],
          ...(await api('/emps/' + encodeURIComponent(rows[i].id) + '/sensitive')),
        };
      }
    }),
  );
  const book = await workbook(),
    sheet = book.addWorksheet('花名册'),
    fields = metadata.importConfig.emps.fields;
  sheet.addRow(fields.map((f) => f[1]));
  records.forEach((r, i) => sheet.addRow(fields.map(([key]) => employeeValue(r, key, i))));
  sheet.autoFilter = { from: 'A1', to: { row: 1, column: fields.length } };
  await downloadWorkbook(book, '花名册_' + new Date().toISOString().slice(0, 10));
}
export async function exportEmployee(row) {
  const employee = { ...row, ...(await api('/emps/' + encodeURIComponent(row.id) + '/sensitive')) },
    book = await workbook();
  const profile = book.addWorksheet('员工档案');
  profile.addRow(['模块', '字段', '内容']);
  for (const section of metadata.employeeSections)
    for (const [key, label] of section[2])
      profile.addRow([section[1], label, employeeValue(employee, key)]);
  const history = book.addWorksheet('工作经历');
  history.addRow(['就职公司', '就职时间', '离职时间', '离职原因']);
  for (const h of employee.workHistory || []) history.addRow([h.company, h.start, h.end, h.reason]);
  const files = book.addWorksheet('材料清单');
  files.addRow(['材料名称', '类别', '上传日期']);
  for (const f of employee.files || []) files.addRow([f.name, f.category, f.date]);
  const timeline = book.addWorksheet('成长记录');
  timeline.addRow(['日期', '类型', '内容', '操作人']);
  for (const t of employee.timeline || []) timeline.addRow([t.date, t.type, t.detail, t.operator]);
  await downloadWorkbook(book, employee.name + '-员工档案');
}
