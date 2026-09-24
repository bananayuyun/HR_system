package cn.hrplatform;

import java.io.OutputStream;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.time.LocalDate;
import java.util.*;
import org.apache.poi.ss.usermodel.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;

@Service
public class ImportService {
  final HrService hr;
  final Db db;
  final WorkflowService workflows;
  final TransactionTemplate transaction;
  static final Map<String, String> TYPES =
      Map.of(
          "emps",
          "EMPLOYEE",
          "assets",
          "ASSET",
          "reqs",
          "REQUEST",
          "grades",
          "GRADE",
          "timeline",
          "TIMELINE");

  ImportService(HrService hr, WorkflowService workflows, PlatformTransactionManager manager) {
    this.hr = hr;
    this.db = hr.database();
    this.workflows = workflows;
    transaction = new TransactionTemplate(manager);
    transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
  }

  public Map<String, Object> hash(Actor a, String type, MultipartFile file) {
    hr.auditor().require(a, "imports:write");
    checkType(type);
    if (file.isEmpty() || file.getSize() > 20L * 1024 * 1024)
      throw ApiException.bad("表格文件必须非空且不能超过 20 MB。");
    try {
      var digest = MessageDigest.getInstance("SHA-256");
      try (var input = new DigestInputStream(file.getInputStream(), digest)) {
        input.transferTo(OutputStream.nullOutputStream());
      }
      return Db.map("sha256", HexFormat.of().formatHex(digest.digest()));
    } catch (Exception e) {
      throw ApiException.bad("文件读取失败，请重新选择。");
    }
  }

  public Map<String, Object> parse(Actor a, String type, MultipartFile file) {
    hr.auditor().require(a, "imports:write");
    checkType(type);
    if (file.getSize() > 20L * 1024 * 1024) throw ApiException.bad("表格文件不能超过 20 MB。");
    try (var input = file.getInputStream();
        var workbook = WorkbookFactory.create(input)) {
      Sheet sheet = workbook.getSheetAt(0);
      if (sheet.getLastRowNum() > 10000) throw ApiException.bad("表格有效区域过大，请移除多余空行后导入。");
      DataFormatter format = new DataFormatter(Locale.ROOT);
      List<List<String>> all = new ArrayList<>();
      int header = -1;
      for (int rowIndex = 0; rowIndex <= sheet.getLastRowNum(); rowIndex++) {
        Row row = sheet.getRow(rowIndex);
        if (row == null) {
          if (header >= 0) all.add(List.of());
          continue;
        }
        if (row.getLastCellNum() > 150) throw ApiException.bad("导入表格最多 150 列。");
        List<String> values = new ArrayList<>();
        for (int col = 0; col < Math.max(0, row.getLastCellNum()); col++) {
          Cell cell = row.getCell(col);
          String value =
              cell == null
                  ? ""
                  : cell.getCellType() == CellType.NUMERIC && DateUtil.isCellDateFormatted(cell)
                      ? cell.getLocalDateTimeCellValue().toLocalDate().toString()
                      : format.formatCellValue(cell);
          values.add(value);
        }
        if (header < 0 && values.stream().anyMatch(v -> !v.isBlank())) {
          header = row.getRowNum();
          all.add(values);
        } else if (header >= 0) all.add(values);
      }
      if (all.isEmpty()) throw ApiException.bad("表格为空。");
      if (all.stream()
              .skip(1)
              .filter(values -> values.stream().anyMatch(value -> !value.isBlank()))
              .count()
          > 2000) throw ApiException.bad("单次导入最多 2000 行。");
      return Db.map(
          "headers",
          all.get(0),
          "rows",
          all.subList(1, all.size()),
          "headerRow",
          header + 1,
          "sheetName",
          sheet.getSheetName());
    } catch (ApiException e) {
      throw e;
    } catch (Exception e) {
      throw ApiException.bad("无法解析表格，请确认文件为有效的 XLSX 或 XLS。");
    }
  }

  void checkType(String type) {
    if (!TYPES.containsKey(type)) throw new ApiException(404, "导入类型不存在。");
  }

  void requireLogAccess(Actor actor, String type) {
    checkType(type);
    hr.auditor().require(actor, "imports:write");
    if (!actor.all()) {
      hr.auditor().denied(actor, "IMPORT_LOG", null);
      throw new ApiException(403, "仅 HR 管理员可查看导入记录。");
    }
  }

  public Map<String, Object> logs(Actor actor, String type, int page, int size) {
    requireLogAccess(actor, type);
    if (page < 1 || size < 1 || size > 100) throw ApiException.bad("分页参数无效，单页最多 100 条。");
    String kind = TYPES.get(type);
    var items =
        db
            .jdbc
            .queryForList(
                "SELECT l.*,u.display_name operator_name FROM import_log l"
                    + " LEFT JOIN sys_user u ON u.id=l.operator_user_id"
                    + " WHERE l.import_type=? ORDER BY l.id DESC LIMIT ? OFFSET ?",
                kind,
                size,
                (long) (page - 1) * size)
            .stream()
            .map(row -> logView(row, false))
            .toList();
    long total =
        db.jdbc.queryForObject(
            "SELECT COUNT(*) FROM import_log WHERE import_type=?", Long.class, kind);
    return Db.map("items", items, "total", total, "page", page, "size", size);
  }

  public Map<String, Object> log(Actor actor, String type, long id) {
    requireLogAccess(actor, type);
    var row =
        db.one(
            "SELECT l.*,u.display_name operator_name FROM import_log l"
                + " LEFT JOIN sys_user u ON u.id=l.operator_user_id"
                + " WHERE l.id=? AND l.import_type=?",
            id,
            TYPES.get(type));
    if (row == null) throw new ApiException(404, "导入记录不存在。");
    return logView(row, true);
  }

  Map<String, Object> logView(Map<String, Object> row, boolean details) {
    var result =
        Db.map(
            "id",
            row.get("id"),
            "fileName",
            row.get("file_name"),
            "fileHash",
            row.get("file_hash"),
            "status",
            row.get("status"),
            "createdAt",
            HrService.stringDate(row.get("created_at")),
            "operatorName",
            row.get("operator_name"),
            "total",
            row.get("total_count"),
            "added",
            row.get("added_count"),
            "updated",
            row.get("updated_count"),
            "skipped",
            row.get("skipped_count"),
            "errorCount",
            row.get("error_count"));
    if (details) {
      List<?> rows = List.of();
      if (row.get("error_detail") != null) {
        try {
          rows = db.json.readValue(Db.str(row, "error_detail"), List.class);
        } catch (Exception e) {
          throw new IllegalStateException("Invalid stored import report", e);
        }
      }
      result.put(
          "rows",
          rows.stream()
              .map(
                  value -> {
                    var detail = db.object(value);
                    return Db.map(
                        "index",
                        detail.get("index"),
                        "action",
                        detail.get("action"),
                        "label",
                        detail.getOrDefault("label", ""),
                        "errors",
                        detail.getOrDefault("errors", List.of()),
                        "warnings",
                        detail.getOrDefault("warnings", List.of()));
                  })
              .toList());
    }
    return result;
  }

  public Map<String, Object> run(Actor a, String type, Map<String, Object> body) {
    hr.auditor().require(a, "imports:write");
    checkType(type);
    if (!(body.get("rows") instanceof List<?> inputs) || inputs.size() > 2000)
      throw ApiException.bad("导入 rows 须为不超过 2000 行的数组。");
    boolean preview = Boolean.TRUE.equals(body.get("validateOnly"));
    String hash = Db.str(body, "fileHash");
    if (!hash.matches("[a-fA-F0-9]{64}")) throw ApiException.bad("请提供有效的文件 SHA-256。");
    if (!preview) {
      var previous =
          db.one(
              "SELECT id,total_count,added_count,updated_count,skipped_count,error_count,error_detail"
                  + " FROM import_log WHERE import_type=? AND file_hash=? AND status='SUCCESS'"
                  + " ORDER BY id DESC LIMIT 1",
              TYPES.get(type),
              hash);
      if (previous != null) {
        List<?> previousRows = List.of();
        if (previous.get("error_detail") != null) {
          try {
            previousRows = db.json.readValue(Db.str(previous, "error_detail"), List.class);
          } catch (Exception e) {
            throw new IllegalStateException("Invalid stored import report", e);
          }
        }
        return Db.map(
            "duplicate", true,
            "importId", previous.get("id"),
            "added", previous.get("added_count"),
            "updated", previous.get("updated_count"),
            "skipped", previous.get("skipped_count"),
            "errorCount", previous.get("error_count"),
            "rows", previousRows);
      }
    }
    Long importId = null;
    if (!preview) {
      try {
        importId =
            transaction.execute(
                s ->
                    db.insert(
                        "import_log",
                        Db.map(
                            "import_type",
                            TYPES.get(type),
                            "file_name",
                            Db.str(body, "fileName").isBlank() ? "导入文件" : body.get("fileName"),
                            "file_hash",
                            hash,
                            "total_count",
                            inputs.size(),
                            "status",
                            "RUNNING",
                            "operator_user_id",
                            a.id())));
      } catch (org.springframework.dao.DataAccessException e) {
        throw ApiException.conflict("导入批次创建失败，请稍后重试。");
      }
    }
    Map<String, Integer> repeated = new HashMap<>();
    for (Object input : inputs) {
      var row = db.object(input);
      String id = Db.str(row, "id");
      if (id.isBlank() && type.equals("grades")) id = Db.str(row, "code");
      if (!id.isBlank()) repeated.merge(id, 1, Integer::sum);
    }
    List<Map<String, Object>> reports = new ArrayList<>();
    int added = 0, updated = 0, skipped = 0, errors = 0, index = 0;
    for (Object input : inputs) {
      index++;
      Map<String, Object> row = db.object(input);
      row.entrySet()
          .removeIf(e -> e.getValue() == null || e.getValue() instanceof String s && s.isBlank());
      List<String> warnings = new ArrayList<>(), problems = new ArrayList<>();
      String code = Db.str(row, "id");
      if (type.equals("grades")) {
        code = Db.str(row, "code").isBlank() ? code : Db.str(row, "code");
        row.put("id", code);
      }
      String operation = "新增";
      if (!type.equals("timeline")) {
        if (code.isBlank()) problems.add("工号/业务编号不能为空");
        if (Db.str(row, "name").isBlank()) problems.add("姓名/名称不能为空");
        if (repeated.getOrDefault(code, 0) > 1) problems.add("文件内业务编号重复");
        var schema = EntitySchema.get(type);
        var old =
            code.isBlank()
                ? null
                : db.one(
                    "SELECT id,version FROM " + schema.table() + " WHERE " + schema.code() + "=?",
                    code);
        if (type.equals("emps") && old == null && Db.str(row, "department").isBlank()
            && Db.str(row, "dept").isBlank()) problems.add("部门不能为空");
        if (old != null) {
          operation = "更新";
          row.put("version", old.get("version"));
          if ("skip".equals(Db.str(body, "mode")) && problems.isEmpty()) {
            operation = "跳过";
            skipped++;
            reports.add(report(index, operation, row, problems, warnings));
            continue;
          }
        }
      }
      String finalCode = code;
      String finalOperation = operation;
      if (problems.isEmpty())
        try {
          normalize(type, row, warnings);
          transaction.executeWithoutResult(
              status -> {
                if (type.equals("timeline"))
                  workflows.action(a, "emps", Db.str(body, "employeeId"), "timeline", row);
                else {
                  if (type.equals("reqs"))
                    defaultRequestOwner(a, row, finalOperation.equals("新增"), body);
                  hr.saveInternal(
                      a, type, finalOperation.equals("更新") ? finalCode : null, row, true);
                }
                if (preview) status.setRollbackOnly();
              });
          if (operation.equals("新增")) added++;
          else updated++;
        } catch (Exception e) {
          problems.add(
              e instanceof ApiException
                  ? e.getMessage()
                  : e instanceof org.springframework.dao.DataIntegrityViolationException
                      ? "唯一编号、手机号或关联约束冲突"
                      : "字段内容无效，请核对原始数据");
        }
      if (!problems.isEmpty()) {
        operation = "错误";
        errors++;
      }
      reports.add(report(index, operation, row, problems, warnings));
    }
    if (!preview) {
      long id = importId;
      int finalAdded = added, finalUpdated = updated, finalSkipped = skipped, finalErrors = errors;
      List<Map<String, Object>> safe =
          reports.stream()
              .map(
                  r ->
                      Db.map(
                          "index",
                          r.get("index"),
                          "action",
                          r.get("action"),
                          "label",
                          importLabel(db.object(r.get("data"))),
                          "errors",
                          r.get("errors"),
                          "warnings",
                          r.get("warnings")))
              .toList();
      transaction.executeWithoutResult(
          s -> {
            db.jdbc.update(
                "UPDATE import_log SET"
                    + " added_count=?,updated_count=?,skipped_count=?,error_count=?,status=?,error_detail=?"
                    + " WHERE id=?",
                finalAdded,
                finalUpdated,
                finalSkipped,
                finalErrors,
                finalErrors == 0
                    ? "SUCCESS"
                    : finalAdded + finalUpdated > 0 ? "PARTIAL_SUCCESS" : "FAILED",
                db.json(safe),
                id);
            hr.auditor()
                .record(
                    a,
                    "IMPORT",
                    type,
                    id,
                    null,
                    Db.map("added", finalAdded, "updated", finalUpdated, "errors", finalErrors));
          });
    }
    return Db.map(
        "duplicate",
        false,
        "importId",
        importId,
        "added",
        added,
        "updated",
        updated,
        "skipped",
        skipped,
        "errorCount",
        errors,
        "rows",
        reports);
  }

  Map<String, Object> report(
      int index,
      String action,
      Map<String, Object> data,
      List<String> errors,
      List<String> warnings) {
    return Db.map(
        "index", index, "action", action, "data", data, "errors", errors, "warnings", warnings);
  }

  void normalize(String type, Map<String, Object> row, List<String> warnings) {
    HrService.normalize(row);
    if (type.equals("timeline")) return;
    if (Set.of("emps", "reqs").contains(type)) {
      String org = Db.str(row, "dept");
      if (org.isBlank()) org = Db.str(row, "department");
      if (org.isBlank() && row.containsKey("version")) {
        var spec = EntitySchema.get(type);
        var old =
            db.one(
                "SELECT org_id FROM " + spec.table() + " WHERE " + spec.code() + "=?",
                row.get("id"));
        if (old != null) org = hr.code("orgs", old.get("org_id"));
      }
      String group = Db.str(row, "group");
      Map<String, Object> direct = lookup("org_department", "code", org, null);
      if (!group.isBlank()) {
        Map<String, Object> subgroup =
            lookup(
                "org_department", "code", group, direct == null ? null : Db.num(direct.get("id")));
        if (subgroup != null) direct = subgroup;
        else {
          warnings.add("组别不存在，已保留部门直属并标记待核对");
          row.put("pendingGroup", group);
        }
      }
      if (direct == null) throw ApiException.bad("部门不存在：" + org);
      row.put("dept", direct.get("code"));
      row.put("mainDept", hr.code("orgs", hr.dataScope().top(Db.num(direct.get("id")))));
      row.put("mainDeptId", row.get("mainDept"));
      long directId = Db.num(direct.get("id"));
      String job = Db.str(row, "job");
      if (!job.isBlank()) {
        var j = lookup("job_position", "code", job, directId);
        if (j == null && type.equals("reqs")) {
          var all =
              db.jdbc.queryForList(
                  "SELECT * FROM job_position WHERE name=? AND deleted_at IS NULL", job);
          j =
              all.stream()
                  .filter(x -> hr.dataScope().within(Db.num(x.get("org_id")), directId))
                  .findFirst()
                  .orElse(null);
        }
        if (j == null) {
          if (type.equals("reqs")) throw ApiException.bad("招聘岗位不存在或不属于需求部门");
          row.put("job", "");
          row.put("pendingJob", job);
          warnings.add("岗位未匹配，保留原文供核对");
        } else row.put("job", j.get("code"));
      }
    }
    if (type.equals("emps")) {
      String secondary = Db.str(row, "secondaryDept");
      if (!secondary.isBlank()) throw ApiException.bad("兼任部门录入已停用，已有记录仅供查看。");
      String phone = Db.str(row, "phone");
      if (!phone.isBlank()) {
        if (!phone.matches("1\\d{10}")) throw ApiException.bad("手机号须为 11 位有效号码");
        if (db.jdbc.queryForObject(
                      "SELECT COUNT(*) FROM employee WHERE phone=? AND employee_no<>?",
                      Integer.class,
                      phone,
                      Db.str(row, "id"))
                  > 0) throw ApiException.bad("手机号已被其他员工使用");
      }
      String grade = Db.str(row, "grade");
      if (!grade.isBlank()) {
        var band = java.util.regex.Pattern.compile("(?i)^[MTSP](?:[1-9]|1[0-2])-(\\d+)$")
            .matcher(grade);
        if (band.matches()) row.put("salaryBand", band.group(1));
        String matched = matchGrade(grade);
        if (matched == null) {
          row.put("grade", "");
          warnings.add("职级未匹配，已留空：" + grade);
        } else row.put("grade", matched);
      }
      String email = Db.str(row, "email");
      if (!email.isBlank() && !email.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")) {
        row.remove("email");
        warnings.add("邮箱格式无效，该字段未覆盖");
      }
      for (String field :
          List.of(
              "entry",
              "leaveDate",
              "regular",
              "actualRegular",
              "contractStart",
              "contractEnd",
              "firstContractStart",
              "firstContractEnd",
              "graduation")) {
        String date = Db.str(row, field);
        if (date.isBlank()) continue;
        String normalized = date.replace('/', '-').replace('.', '-');
        try {
          if (normalized.matches("\\d{4}-\\d{1,2}-\\d{1,2}")) {
            String[] p = normalized.split("-");
            normalized =
                String.format(
                    "%04d-%02d-%02d",
                    Integer.parseInt(p[0]), Integer.parseInt(p[1]), Integer.parseInt(p[2]));
          }
          LocalDate.parse(normalized);
          row.put(field, normalized);
        } catch (Exception e) {
          throw ApiException.bad(field + " 日期格式错误");
        }
      }
      if (!row.containsKey("status")
          && (!row.containsKey("version") || row.containsKey("leaveDate")))
        row.put("status", Db.str(row, "leaveDate").isBlank() ? "正式" : "已离职");
      if (row.containsKey("status")
          && !EntitySchema.EMP_STATUS.containsKey(Db.str(row, "status"))
          && !EntitySchema.EMP_STATUS.containsValue(Db.str(row, "status"))) {
        warnings.add("员工状态无效，已按默认状态处理");
        row.put("status", "正式");
      }
    }
    for (var pair :
        Map.of("location", "WORK_REGION", "workplace", "WORKPLACE", "company", "CONTRACT_COMPANY")
            .entrySet()) {
      String value = Db.str(row, pair.getKey());
      if (value.isBlank()) continue;
      var dict =
          db.one(
              "SELECT i.item_name FROM base_dictionary_item i JOIN base_dictionary d ON"
                  + " d.id=i.dictionary_id WHERE d.dict_code=? AND i.status='ACTIVE' AND"
                  + " (i.item_name=? OR"
                  + " JSON_CONTAINS(COALESCE(i.aliases,JSON_ARRAY()),JSON_QUOTE(?)))",
              pair.getValue(),
              value,
              value);
      if (dict == null) {
        if (!type.equals("emps")) throw ApiException.bad("基础信息未匹配：" + value);
        warnings.add("基础信息未匹配，已按原值导入：" + value);
      } else canonicalDictionaryValue(row, pair.getKey(), dict.get("item_name"));
    }
    if (type.equals("reqs"))
      for (String role : List.of("owner", "screener", "first", "second")) {
        if (row.get(role + "Ids") instanceof List<?>) continue;
        String people = Db.str(row, role);
        List<String> codes = new ArrayList<>();
        for (String name : people.split("[、,，]")) {
          name = name.trim();
          if (name.isBlank()) continue;
          var person =
              db.one(
                  "SELECT employee_no FROM employee WHERE (employee_no=? OR name=?) AND deleted_at"
                      + " IS NULL AND status NOT IN ('LEFT','PENDING_LEAVE') ORDER BY id LIMIT 1",
                  name,
                  name);
          if (person == null) throw ApiException.bad("负责人不存在或已离岗：" + name);
          codes.add(Db.str(person, "employee_no"));
        }
        if (!codes.isEmpty()) row.put(role + "Ids", codes);
      }
  }

  void defaultRequestOwner(
      Actor actor, Map<String, Object> row, boolean creating, Map<String, Object> body) {
    if (!creating || row.containsKey("ownerIds") || !Db.str(row, "owner").isBlank()) return;
    String selected = Db.str(body, "defaultOwnerId");
    if (!selected.isBlank()) {
      var owner =
          db.one(
              "SELECT employee_no FROM employee WHERE employee_no=? AND deleted_at IS NULL"
                  + " AND status NOT IN ('LEFT','PENDING_LEAVE')",
              selected);
      if (owner == null) throw ApiException.bad("所选默认 HR 负责人不存在或已离岗。");
      row.put("ownerIds", List.of(Db.str(owner, "employee_no")));
      return;
    }
    var owner =
        db.one(
            "SELECT e.employee_no FROM sys_user u JOIN employee e ON e.id=u.employee_id"
                + " WHERE u.id=? AND u.status='ACTIVE' AND e.deleted_at IS NULL"
                + " AND e.status NOT IN ('LEFT','PENDING_LEAVE')",
            actor.id());
    if (owner == null)
      throw ApiException.bad("请选择默认 HR 负责人，或在文件中填写 HR 负责人。");
    row.put("ownerIds", List.of(Db.str(owner, "employee_no")));
  }

  static String importLabel(Map<String, Object> row) {
    String id = Db.str(row, "id");
    if (id.isBlank()) id = Db.str(row, "code");
    if (id.isBlank()) id = Db.str(row, "date");
    String name = Db.str(row, "name");
    if (name.isBlank()) name = Db.str(row, "type");
    return id + (name.isBlank() ? "" : " / " + name);
  }

  static void canonicalDictionaryValue(Map<String, Object> row, String field, Object value) {
    row.put(field, value);
    // Keep prototype aliases synchronized; saveInternal normalizes them again after merging.
    if (field.equals("location")) row.put("workRegion", value);
    if (field.equals("company")) row.put("contractCompany", value);
  }

  String matchGrade(String input) {
    String value = input.trim();
    String code = value.toUpperCase(Locale.ROOT).replaceAll("^([MTSP](?:[1-9]|1[0-2]))-\\d+$", "$1");
    var grades = db.jdbc.queryForList(
        "SELECT code,name FROM grade WHERE deleted_at IS NULL AND status='ACTIVE'");
    for (var grade : grades)
      if (code.equals(grade.get("code"))) return Db.str(grade, "code");
    var exact = grades.stream().filter(g -> Arrays.stream(Db.str(g, "name").split("/"))
        .anyMatch(part -> part.trim().equals(value))).toList();
    if (exact.size() == 1) return Db.str(exact.get(0), "code");
    var partial = grades.stream().filter(g -> Db.str(g, "name").contains(value)).toList();
    return partial.size() == 1 ? Db.str(partial.get(0), "code") : null;
  }

  Map<String, Object> lookup(String table, String code, String value, Long org) {
    if (value.isBlank()) return null;
    String orgColumn = table.equals("org_department") ? "parent_id" : "org_id";
    return org == null
        ? db.one(
            "SELECT * FROM "
                + table
                + " WHERE ("
                + code
                + "=? OR name=?) AND deleted_at IS NULL AND status='ACTIVE' ORDER BY id LIMIT 1",
            value,
            value)
        : db.one(
            "SELECT * FROM "
                + table
                + " WHERE ("
                + code
                + "=? OR name=?) AND "
                + orgColumn
                + "=? AND deleted_at IS NULL AND status='ACTIVE' ORDER BY id LIMIT 1",
            value,
            value,
            org);
  }
}
