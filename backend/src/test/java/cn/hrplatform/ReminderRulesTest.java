package cn.hrplatform;

import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import org.junit.jupiter.api.Test;

class ReminderRulesTest {
  @Test
  void acceptsOneToThreeDistinctMinuteTimes() {
    assertEquals(List.of("09:00"), SettingsService.reminderTimes(List.of("09:00")));
    var three = List.of("00:00", "12:30", "23:59");
    assertEquals(three, SettingsService.reminderTimes(three));
  }

  @Test
  void rejectsEmptyOrMoreThanThreeTimes() {
    assertBad(List.of());
    assertBad(List.of("09:00", "10:00", "11:00", "12:00"));
  }

  @Test
  void rejectsDuplicateTimes() {
    assertBad(List.of("09:00", "09:00"));
  }

  @Test
  void rejectsNonMinuteFormatsOrInvalidClockValues() {
    for (String time : List.of("9:00", "09:0", "09:00:00", "24:00", "12:60", " 09:00", "09:00 "))
      assertBad(List.of(time));
    assertBad(List.of(900));
  }

  @Test
  void rejectsMissingOrNonArrayConfiguration() {
    assertBad(null);
    assertBad("09:00");
  }

  private static void assertBad(Object input) {
    assertEquals(
        400, assertThrows(ApiException.class, () -> SettingsService.reminderTimes(input)).status);
  }
}
