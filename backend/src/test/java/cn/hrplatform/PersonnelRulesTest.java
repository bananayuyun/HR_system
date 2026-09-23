package cn.hrplatform;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class PersonnelRulesTest {
  final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  final HrService hr =
      spy(
          new HrService(
              new Db(jdbc, new ObjectMapper()),
              mock(Scope.class),
              mock(Audit.class),
              mock(Crypto.class)));

  @Test
  void actualRegularCannotPrecedeEntryOrBeInTheFuture() {
    String today = LocalDate.now(ZoneId.of("Asia/Shanghai")).toString();
    assertEquals(
        400,
        assertThrows(
                ApiException.class,
                () ->
                    HrService.validateEmployeeDates(
                        Db.map("entry", today, "actualRegular", "2000-01-01")))
            .status);
    assertEquals(
        400,
        assertThrows(
                ApiException.class,
                () ->
                    HrService.validateEmployeeDates(
                        Db.map(
                            "actualRegular",
                            LocalDate.now(ZoneId.of("Asia/Shanghai")).plusDays(1).toString())))
            .status);
    assertDoesNotThrow(
        () -> HrService.validateEmployeeDates(Db.map("entry", today, "actualRegular", today)));
  }

  @Test
  void workHistoryValidatesEveryRowBeforeDeletingExistingHistory() {
    var valid = Db.map("company", "A", "start", "2020-01-01", "end", "2021-01-01");
    var invalid = Db.map("company", "B", "start", "2022-01-01", "end", "2021-01-01");
    assertEquals(
        400,
        assertThrows(ApiException.class, () -> hr.saveWorkHistory(1L, List.of(valid, invalid)))
            .status);
    verifyNoInteractions(jdbc);
  }

  @Test
  void workHistoryRequiresCompanyAndStartAndRejectsFutureDates() {
    for (var row :
        List.of(
            Db.map("company", "A"),
            Db.map("start", "2020-01-01"),
            Db.map(
                "company",
                "A",
                "start",
                LocalDate.now(ZoneId.of("Asia/Shanghai")).plusDays(1).toString()),
            Db.map(
                "company",
                "A",
                "start",
                "2020-01-01",
                "end",
                LocalDate.now(ZoneId.of("Asia/Shanghai")).plusDays(1).toString()),
            Db.map("company", "A", "start", "not-a-date"))) {
      assertEquals(
          400,
          assertThrows(ApiException.class, () -> hr.validatedWorkHistory(List.of(row))).status);
    }
    assertEquals(List.of(), hr.validatedWorkHistory(List.of(Map.of())));
    assertEquals(
        "2020-01-01",
        hr.validatedWorkHistory(List.of(Db.map("company", "A", "start", "2020-01")))
            .get(0)
            .get("start"));
  }

  @Test
  void supervisorCannotBeSelfOrAnIndirectDescendant() {
    assertEquals(400, assertThrows(ApiException.class, () -> hr.validateSupervisor(1L, 1L)).status);
    when(jdbc.queryForList("SELECT supervisor_id FROM employee WHERE id=? FOR UPDATE", 2L))
        .thenReturn(List.of(Db.map("supervisor_id", 3L)));
    when(jdbc.queryForList("SELECT supervisor_id FROM employee WHERE id=? FOR UPDATE", 3L))
        .thenReturn(List.of(Db.map("supervisor_id", 1L)));
    assertEquals(400, assertThrows(ApiException.class, () -> hr.validateSupervisor(1L, 2L)).status);
    assertDoesNotThrow(() -> hr.validateSupervisor(1L, null));
  }

  @Test
  void preexistingCycleInSupervisorChainAlsoFailsSafely() {
    when(jdbc.queryForList("SELECT supervisor_id FROM employee WHERE id=? FOR UPDATE", 2L))
        .thenReturn(List.of(Db.map("supervisor_id", 3L)));
    when(jdbc.queryForList("SELECT supervisor_id FROM employee WHERE id=? FOR UPDATE", 3L))
        .thenReturn(List.of(Db.map("supervisor_id", 2L)));
    assertEquals(400, assertThrows(ApiException.class, () -> hr.validateSupervisor(1L, 2L)).status);
  }

  @Test
  void inactiveParentCannotBeUsedForCreateOrMove() {
    doReturn(18L).when(hr).ref("orgs", "ORG_18", true);
    when(jdbc.queryForList("SELECT status FROM org_department WHERE id=?", 18L))
        .thenReturn(List.of(Db.map("status", "INACTIVE")));
    var input = Db.map("parent", "ORG_18", "name", "新组", "orgType", "组");
    assertEquals(
        400, assertThrows(ApiException.class, () -> hr.validateOrganization(input, null)).status);
    assertEquals(
        400,
        assertThrows(
                ApiException.class,
                () -> hr.validateOrganization(input, Db.map("id", 19L, "parent_id", 1L)))
            .status);
  }

  @Test
  void duplicateSiblingNameIsRejectedForCreateAndEdit() {
    doReturn(18L).when(hr).ref("orgs", "ORG_18", true);
    doNothing().when(hr).activeOrg(18L);
    when(jdbc.queryForList(contains("parent_id <=> ? AND name=?"), eq(18L), eq("同名组"), any()))
        .thenReturn(List.of(Db.map("id", 20L)));
    var input = Db.map("parent", "ORG_18", "name", "同名组", "orgType", "组");
    assertEquals(
        409, assertThrows(ApiException.class, () -> hr.validateOrganization(input, null)).status);
    assertEquals(
        409,
        assertThrows(
                ApiException.class,
                () -> hr.validateOrganization(input, Db.map("id", 19L, "parent_id", 18L)))
            .status);
  }

  @Test
  void rootCannotBeDeactivatedReparentedOrChangedToDepartment() {
    var root = Db.map("id", 1L, "parent_id", null);
    for (var input :
        List.of(Db.map("name", "公司", "status", "停用"), Db.map("name", "公司", "orgType", "部门")))
      assertEquals(
          400, assertThrows(ApiException.class, () -> hr.validateOrganization(input, root)).status);
  }

  @Test
  void archiveChecksChildrenRegardlessOfTheirEnabledStatus() {
    when(jdbc.queryForObject(
            "SELECT COUNT(*) FROM org_department WHERE parent_id=? AND deleted_at IS NULL",
            Integer.class,
            18L))
        .thenReturn(1);
    assertEquals(
        409,
        assertThrows(
                ApiException.class, () -> hr.guardOrgArchive(Db.map("id", 18L, "parent_id", 1L)))
            .status);
    verify(jdbc)
        .queryForObject(
            "SELECT COUNT(*) FROM org_department WHERE parent_id=? AND deleted_at IS NULL",
            Integer.class,
            18L);
  }

  @Test
  void archiveProtectsHistoricalEmployeeAndMainDepartmentReferences() {
    when(jdbc.queryForObject(
            "SELECT COUNT(*) FROM org_department WHERE parent_id=? AND deleted_at IS NULL",
            Integer.class,
            18L))
        .thenReturn(0);
    when(jdbc.queryForObject(
            "SELECT COUNT(*) FROM employee WHERE (org_id=? OR main_org_id=? OR secondary_org_id=?)",
            Integer.class,
            18L,
            18L,
            18L))
        .thenReturn(1);
    assertEquals(
        409,
        assertThrows(
                ApiException.class, () -> hr.guardOrgArchive(Db.map("id", 18L, "parent_id", 1L)))
            .status);
  }
}
