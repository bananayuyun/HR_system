package cn.hrplatform;

import java.util.*;

public record Actor(
    long id,
    String username,
    String displayName,
    List<String> roles,
    List<String> permissions,
    Long orgId,
    String orgCode,
    String dataScope) {
  public boolean all() {
    return "ALL".equals(dataScope);
  }

  public boolean can(String p) {
    return permissions.contains(p);
  }

  public Map<String, Object> view() {
    var menus =
        List.of(
                "roster",
                "orgs",
                "jobs",
                "grades",
                "settings",
                "reqs",
                "pool",
                "screening",
                "interviews",
                "offers",
                "assets")
            .stream()
            .filter(m -> can(m + ":read"))
            .toList();
    return Db.map(
        "id",
        id,
        "username",
        username,
        "displayName",
        displayName,
        "role",
        roles.contains("HR_ADMIN") ? "hr" : "manager",
        "roles",
        roles,
        "menus",
        menus,
        "permissions",
        permissions,
        "departmentId",
        orgCode,
        "managerDept",
        orgCode,
        "dataScope",
        dataScope);
  }
}
