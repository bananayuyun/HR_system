package cn.hrplatform;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;

class ImportOwnerAndLogTest {
  final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  final Db db = new Db(jdbc, new ObjectMapper());
  final Audit audit = mock(Audit.class);
  final HrService hr = mock(HrService.class);
  final Actor admin =
      new Actor(1, "admin", "许 HR", List.of("HR_ADMIN"), List.of("imports:write"), null, "", "ALL");
  final ImportService service;

  ImportOwnerAndLogTest() {
    when(hr.database()).thenReturn(db);
    when(hr.auditor()).thenReturn(audit);
    when(hr.dataScope()).thenReturn(mock(Scope.class));
    service =
        new ImportService(hr, mock(WorkflowService.class), mock(PlatformTransactionManager.class));
  }

  @Test
  void fileHashUsesTheExactUploadedBytes() {
    var file = new MockMultipartFile("file", "sample.csv", "text/csv", "abc".getBytes());
    assertEquals(
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        service.hash(admin, "emps", file).get("sha256"));
    assertEquals(
        400,
        assertThrows(
                ApiException.class,
                () -> service.hash(admin, "emps", new MockMultipartFile("file", new byte[0])))
            .status);
  }

  @Test
  void newRequestUsesTheCurrentAccountsEmployeeNotItsDisplayName() {
    when(jdbc.queryForList(contains("JOIN employee e ON e.id=u.employee_id"), eq(1L)))
        .thenReturn(List.of(Db.map("employee_no", "E0005")));
    var row = Db.map("name", "招聘岗位");
    service.defaultRequestOwner(admin, row, true, Map.of());
    assertEquals(List.of("E0005"), row.get("ownerIds"));
  }

  @Test
  void updateWithoutOwnerDoesNotReplaceExistingOwnership() {
    var row = Db.map("name", "改名");
    service.defaultRequestOwner(admin, row, false, Map.of());
    assertFalse(row.containsKey("ownerIds"));
    verifyNoInteractions(jdbc);
  }

  @Test
  void explicitOwnersIncludingEmptyListAreNeverReplacedWithTheDefault() {
    var row = Db.map("ownerIds", List.of());
    service.defaultRequestOwner(admin, row, true, Map.of());
    assertEquals(List.of(), row.get("ownerIds"));
    var named = Db.map("owner", "不存在的负责人");
    service.defaultRequestOwner(admin, named, true, Map.of());
    assertFalse(named.containsKey("ownerIds"));
    verifyNoInteractions(jdbc);
  }

  @Test
  void unboundAccountFailsClearlyRatherThanInventingAnEmployee() {
    assertEquals(
        400,
        assertThrows(
                ApiException.class,
                () -> service.defaultRequestOwner(admin, new LinkedHashMap<>(), true, Map.of()))
            .status);
  }

  @Test
  void unboundAccountCanUseAnExplicitDefaultOwner() {
    when(jdbc.queryForList(contains("FROM employee WHERE employee_no=?"), eq("E0005")))
        .thenReturn(List.of(Db.map("employee_no", "E0005")));
    var row = Db.map("name", "招聘岗位");
    service.defaultRequestOwner(admin, row, true, Map.of("defaultOwnerId", "E0005"));
    assertEquals(List.of("E0005"), row.get("ownerIds"));
    verify(jdbc, never()).queryForList(contains("JOIN employee e ON e.id=u.employee_id"), eq(1L));
  }

  @Test
  void explicitUnresolvableOwnerIsAnErrorDuringImportNormalization() {
    when(jdbc.queryForList(
            contains("FROM org_department WHERE (code=?"), eq("ORG_18"), eq("ORG_18")))
        .thenReturn(List.of(Db.map("id", 18L, "code", "ORG_18")));
    var row = Db.map("dept", "ORG_18", "owner", "未知负责人");
    var error =
        assertThrows(ApiException.class, () -> service.normalize("reqs", row, new ArrayList<>()));
    assertEquals(400, error.status);
    assertTrue(error.getMessage().contains("负责人不存在"));
  }

  @Test
  void logDetailsExcludeRawCellsEvenIfAnOldReportContainedThem() {
    var raw =
        Db.map(
            "error_detail",
            db.json(
                List.of(
                    Db.map(
                        "index",
                        1,
                        "action",
                        "新增",
                        "label",
                        "EQA / 姓名",
                        "errors",
                        List.of(),
                        "warnings",
                        List.of(),
                        "data",
                        Map.of("identityNumber", "sensitive")))));
    var response = service.logView(raw, true);
    assertFalse(db.json(response).contains("sensitive"));
    assertFalse(db.json(response).contains("identityNumber"));
    assertEquals("EQA / 姓名", db.object(((List<?>) response.get("rows")).get(0)).get("label"));
    assertFalse(service.logView(raw, false).containsKey("rows"));
  }

  @Test
  void managerCannotReadImportLogsEvenIfMisconfiguredWithImportPermission() {
    var manager =
        new Actor(
            2,
            "manager",
            "林主管",
            List.of(),
            List.of("imports:write"),
            18L,
            "ORG_18",
            "SELF_ORG_TREE");
    assertEquals(
        403, assertThrows(ApiException.class, () -> service.logs(manager, "emps", 1, 20)).status);
    verify(audit).denied(manager, "IMPORT_LOG", null);
    verifyNoInteractions(jdbc);
  }

  @Test
  void detailQueryRestrictsTheRequestedImportType() {
    assertEquals(
        404, assertThrows(ApiException.class, () -> service.log(admin, "reqs", 23L)).status);
    verify(jdbc).queryForList(contains("WHERE l.id=? AND l.import_type=?"), eq(23L), eq("REQUEST"));
  }

  @Test
  void importLabelContainsOnlySafeIdentifierAndName() {
    assertEquals(
        "EQA / 测试",
        ImportService.importLabel(Db.map("id", "EQA", "name", "测试", "bankNumber", "SECRET")));
  }
}
