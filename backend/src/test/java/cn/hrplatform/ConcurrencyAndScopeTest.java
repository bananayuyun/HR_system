package cn.hrplatform;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class ConcurrencyAndScopeTest {
  @Test
  void staleVersionCannotOverwrite() {
    var error =
        assertThrows(
            ApiException.class,
            () -> HrService.version(Db.map("version", 4), Db.map("version", 3)));
    assertEquals(409, error.status);
  }

  @Test
  void omissionIsNotTreatedAsLatestVersion() {
    var error =
        assertThrows(ApiException.class, () -> HrService.version(Db.map("version", 4), Map.of()));
    assertEquals(428, error.status);
  }

  @Test
  void currentVersionCanWrite() {
    assertDoesNotThrow(() -> HrService.version(Db.map("version", 4), Db.map("version", 4)));
  }

  @Test
  void managerWithoutOrganizationGetsNoScope() {
    var db = new Db(mock(JdbcTemplate.class), new ObjectMapper());
    var audit = mock(Audit.class);
    var service = new Scope(db, audit);
    var actor =
        new Actor(
            7,
            "manager",
            "主管",
            List.of("DEPT_MANAGER"),
            List.of("jobs:read"),
            null,
            "",
            "SELF_ORG_TREE");
    assertEquals(Set.of(), service.orgs(actor));
    ApiException error = assertThrows(ApiException.class, () -> service.check(actor, 18));
    assertEquals(403, error.status);
    verify(audit).denied(actor, "ORGANIZATION", 18L);
  }

  @Test
  void roleNameAloneDoesNotGrantAllData() {
    var actor =
        new Actor(7, "user", "用户", List.of("HR_ADMIN"), List.of(), 18L, "ORG_18", "SELF_ORG_TREE");
    assertFalse(actor.all());
    assertFalse(actor.can("emps:write"));
    assertEquals(List.of(), actor.view().get("menus"));
  }

  @Test
  void managerMenuMatchesPrototypeEvenWithLegacyReadPermissions() {
    var actor =
        new Actor(
            7,
            "manager",
            "主管",
            List.of("DEPT_MANAGER"),
            List.of(
                "roster:read",
                "grades:read",
                "pool:read",
                "assets:read",
                "reqs:read",
                "screening:read",
                "interviews:read",
                "offers:read",
                "orgs:read",
                "jobs:read"),
            18L,
            "ORG_18",
            "SELF_ORG_TREE");
    assertEquals(
        List.of("reqs", "screening", "interviews", "offers", "orgs", "jobs"),
        actor.view().get("menus"));
  }

  @Test
  void hrMenuIncludesDepartmentScreeningAfterResumeScreening() {
    var actor =
        new Actor(
            8,
            "hr",
            "HR",
            List.of("HR_ADMIN"),
            List.of("screening:read", "screening:hr", "screening:department"),
            null,
            "",
            "ALL");
    assertEquals(List.of("screening", "deptscreening"), actor.view().get("menus"));
  }
}
