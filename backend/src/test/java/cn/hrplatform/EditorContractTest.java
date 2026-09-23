package cn.hrplatform;

import static org.junit.jupiter.api.Assertions.*;

import java.util.*;
import org.junit.jupiter.api.Test;

class EditorContractTest {
  @Test
  void employeePrototypeFieldsProduceStableCanonicalFields() {
    var patch =
        HrService.normalizePatch(
            "emps", Db.map("supervisor", "E0002", "graduated", "2018-06-30", "mainDept", "ORG_18"));
    assertEquals("E0002", patch.get("supervisorId"));
    assertEquals("2018-06-30", patch.get("graduation"));
    assertEquals("ORG_18", patch.get("mainDeptId"));
  }

  @Test
  void canonicalPatchIsAppliedBeforeOldPrototypeAliasesCanOverwriteIt() {
    var prior =
        Db.map(
            "workRegion",
            "旧片区",
            "location",
            "旧片区",
            "contractCompany",
            "旧公司",
            "company",
            "旧公司",
            "mainDeptId",
            "ORG_01",
            "supervisor",
            "EOLD");
    prior.putAll(
        HrService.normalizePatch(
            "emps",
            Db.map(
                "location",
                "新片区",
                "company",
                "新公司",
                "mainDept",
                "ORG_18",
                "supervisorId",
                "ENEW")));
    HrService.normalize(prior);
    assertEquals("新片区", prior.get("location"));
    assertEquals("新公司", prior.get("company"));
    assertEquals("ORG_18", prior.get("mainDeptId"));
    assertEquals("ENEW", prior.get("supervisor"));
  }

  @Test
  void absentAliasesDoNotClearFieldsAndInputIsNotMutated() {
    var input = Map.<String, Object>of("notes", "仅改备注");
    assertEquals(input, HrService.normalizePatch("emps", input));
    assertEquals(Map.of("notes", "仅改备注"), input);
  }

  @Test
  void explicitBlankCanClearOptionalEmployeeFields() {
    var patch = HrService.normalizePatch("emps", Db.map("supervisor", "", "graduated", ""));
    assertEquals("", patch.get("supervisorId"));
    assertEquals("", patch.get("graduation"));
  }

  @Test
  void nonOwnershipAssetActionsIgnoreUnrelatedBodyFields() {
    for (String action : List.of("repair-start", "repair-end", "location", "scrap", "return")) {
      var patch =
          WorkflowService.assetPatch(
              action,
              Db.map(
                  "owner",
                  "",
                  "name",
                  "意外改名",
                  "public",
                  "是",
                  "status",
                  "闲置",
                  "location",
                  "新片区",
                  "office",
                  "位置",
                  "reason",
                  "办理",
                  "version",
                  2));
      assertFalse(patch.containsKey("owner"));
      assertFalse(patch.containsKey("name"));
      assertFalse(patch.containsKey("public"));
      assertFalse(patch.containsKey("status"));
      assertEquals("新片区", patch.get("workRegion"));
      assertEquals(2, patch.get("version"));
    }
  }

  @Test
  void AssignAndTransferStillReceiveTheExplicitAssignee() {
    for (String action : List.of("assign", "transfer"))
      assertEquals(
          "E0002", WorkflowService.assetPatch(action, Db.map("owner", "E0002")).get("owner"));
  }
}
