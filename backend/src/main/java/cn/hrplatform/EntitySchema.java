package cn.hrplatform;

import java.util.*;

public record EntitySchema(
    String table,
    String code,
    String readPermission,
    String writePermission,
    Map<String, String> fields) {
  private static Map<String, String> fields(String pairs) {
    Map<String, String> m = new LinkedHashMap<>();
    for (String pair : pairs.split(" ")) {
      var p = pair.split(":");
      m.put(p[0], p.length == 1 ? p[0] : p[1]);
    }
    return m;
  }

  public static final Map<String, EntitySchema> ALL =
      Map.of(
          "orgs",
              new EntitySchema(
                  "org_department",
                  "code",
                  "orgs:read",
                  "orgs:write",
                  fields("name location description")),
          "jobs",
              new EntitySchema(
                  "job_position",
                  "code",
                  "jobs:read",
                  "jobs:write",
                  fields("name location headcount duties requirements")),
          "grades",
              new EntitySchema(
                  "grade",
                  "code",
                  "grades:read",
                  "grades:write",
                  fields("code name level:level_no min:min_years requirements")),
          "emps",
              new EntitySchema(
                  "employee",
                  "employee_no",
                  "roster:read",
                  "emps:write",
                  fields(
                      "name phone email company location workplace office"
                          + " archiveNumber:archive_number entry:entry_date leaveDate:leave_date"
                          + " probationMonths:probation_months actualRegular:regular_date"
                          + " contractStart:contract_start contractEnd:contract_end"
                          + " contractType:contract_type contractYears:contract_term"
                          + " firstContractStart:first_contract_start"
                          + " firstContractEnd:first_contract_end gender ethnicity"
                          + " marital:marital_status political:political_status constellation"
                          + " education school major graduation:graduated_date"
                          + " socialStatus:social_status fundStatus:fund_status"
                          + " insuranceNotes:insurance_notes bankName:bank_name"
                          + " titleLevel:title_level titleSpecialty:title_specialty notes:remark"
                          + " wechat")),
          "reqs",
              new EntitySchema(
                  "recruitment_request",
                  "request_no",
                  "reqs:read",
                  "reqs:write",
                  fields(
                      "name location company count:headcount salaryMin:salary_min"
                          + " salaryMax:salary_max deadline")),
          "candidates",
              new EntitySchema(
                  "candidate",
                  "code",
                  "pool:read",
                  "candidates:write",
                  fields("name phone email source education years")),
          "assets",
              new EntitySchema(
                  "asset",
                  "asset_no",
                  "assets:read",
                  "assets:write",
                  fields(
                      "name category model location office purchased:purchased_date cost:value"
                          + " supplier")));

  public static EntitySchema get(String type) {
    var s = ALL.get(type);
    if (s == null) throw new ApiException(404, "资源不存在。");
    return s;
  }

  public static final Map<String, String> EMP_STATUS =
      Map.of(
          "待入职",
          "PRE_ONBOARD",
          "试用",
          "PROBATION",
          "正式",
          "ACTIVE",
          "在职",
          "ACTIVE",
          "待离职",
          "PENDING_LEAVE",
          "已离职",
          "LEFT");
  public static final Map<String, String> EMP_TYPE =
      Map.of(
          "全职",
          "FULL_TIME",
          "兼职",
          "PART_TIME",
          "外包",
          "OUTSOURCED",
          "实习",
          "INTERN",
          "劳务派遣",
          "LABOR_DISPATCH",
          "其它",
          "OTHER");
  public static final Map<String, String> REQ_STATUS =
      Map.of("招聘中", "OPEN", "暂停", "PAUSED", "已完成", "COMPLETED", "已关闭", "CLOSED");
  public static final Map<String, String> ASSET_STATUS =
      Map.of("闲置", "IDLE", "使用中", "IN_USE", "维修中", "REPAIRING", "已报废", "SCRAPPED");
  public static final Map<String, String> CAND_STAGE =
      Map.ofEntries(
          Map.entry("待 HR 筛选", "HR_SCREEN"),
          Map.entry("待筛选", "HR_SCREEN"),
          Map.entry("暂缓筛选", "HR_SCREEN"),
          Map.entry("待部门筛选", "DEPT_SCREEN"),
          Map.entry("初试", "FIRST_INTERVIEW"),
          Map.entry("复试", "SECOND_INTERVIEW"),
          Map.entry("待入职", "ONBOARDING"),
          Map.entry("延期入职", "ONBOARDING"),
          Map.entry("未到岗", "ONBOARDING"),
          Map.entry("放弃入职", "ONBOARDING"),
          Map.entry("取消入职", "ONBOARDING"),
          Map.entry("已入职", "HIRED"),
          Map.entry("未通过", "REJECTED"),
          Map.entry("候选人取消", "CANCELLED"));

  public static String from(Map<String, String> mapping, Object value, String fallback) {
    String s = Db.text(value);
    if (s.isEmpty()) return fallback;
    if (mapping.containsValue(s)) return s;
    if (mapping.containsKey(s)) return mapping.get(s);
    throw ApiException.bad("状态值无效：" + s);
  }

  public static String to(Map<String, String> mapping, Object value) {
    String v = Db.text(value);
    if (v.equals("ACTIVE") && mapping == EMP_STATUS) return "正式";
    if (v.equals("HR_SCREEN")) return "待 HR 筛选";
    if (v.equals("ONBOARDING")) return "待入职";
    return mapping.entrySet().stream()
        .filter(e -> e.getValue().equals(v))
        .map(Map.Entry::getKey)
        .findFirst()
        .orElse(v);
  }
}
