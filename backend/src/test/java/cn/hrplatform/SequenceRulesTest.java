package cn.hrplatform;

import static org.junit.jupiter.api.Assertions.*;

import java.util.Collections;
import java.util.List;
import org.junit.jupiter.api.Test;

class SequenceRulesTest {
  @Test
  void preservesTheOrderAndUnusedNames() {
    assertEquals(
        List.of("技术序列 T", "新序列"), SettingsService.sequenceItems(List.of("技术序列 T", " 新序列 ")));
  }

  @Test
  void rejectsBlankAndDuplicateNamesInsteadOfSilentlyDroppingThem() {
    assertBad(List.of("技术序列 T", ""));
    assertBad(List.of("技术序列 T", " 技术序列 T "));
  }

  @Test
  void rejectsInvalidListAndLength() {
    assertBad(null);
    assertBad("技术序列 T");
    assertBad(List.of());
    assertBad(Collections.nCopies(101, "技术序列 T"));
    assertBad(List.of("名".repeat(129)));
    assertBad(List.of(42));
  }

  @Test
  void renameNamesUseTheSameValidation() {
    assertEquals("技术序列 T", SettingsService.sequenceName(" 技术序列 T "));
    assertThrows(ApiException.class, () -> SettingsService.sequenceName(" "));
    assertThrows(ApiException.class, () -> SettingsService.sequenceName(null));
  }

  private static void assertBad(Object input) {
    assertEquals(
        400, assertThrows(ApiException.class, () -> SettingsService.sequenceItems(input)).status);
  }
}
