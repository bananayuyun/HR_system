package cn.hrplatform;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;

class UserCenterAuthTest {
  @Test
  void rejectsLegacyLocalSessionWithoutUserCenterToken() {
    var jdbc = mock(JdbcTemplate.class);
    var auth =
        new Auth(new Db(jdbc, new ObjectMapper()), mock(Audit.class), mock(UserCenterClient.class));
    var request = new MockHttpServletRequest();
    request.getSession().setAttribute("userId", 1L);

    var error = assertThrows(ApiException.class, () -> auth.actor(request));
    assertEquals(401, error.status);
    verifyNoInteractions(jdbc);
  }

  @Test
  void rejectsProfileForAnotherAccountBeforeCreatingLocalSession() {
    var jdbc = mock(JdbcTemplate.class);
    var db = new Db(jdbc, new ObjectMapper());
    var center = mock(UserCenterClient.class);
    var auth = new Auth(db, mock(Audit.class), center);
    when(center.login("alice", "password")).thenReturn(Map.of("token", "initial"));
    when(center.userInfo("initial"))
        .thenReturn(Db.map("token", "refreshed", "userAccount", Db.map("account", "other")));

    var request = new MockHttpServletRequest();
    var error =
        assertThrows(
            ApiException.class,
            () -> auth.login(request, Db.map("username", "alice", "password", "password")));
    assertEquals(401, error.status);
    assertNull(request.getSession(false));
    verifyNoInteractions(jdbc);
  }

  @Test
  void loginUsesRefreshedTokenAndMeRefreshesItAgain() {
    var jdbc = mock(JdbcTemplate.class);
    var db = spy(new Db(jdbc, new ObjectMapper()));
    var center = mock(UserCenterClient.class);
    var audit = mock(Audit.class);
    var auth = spy(new Auth(db, audit, center));
    var actor =
        new Actor(7, "alice", "本地名称", List.of("HR_ADMIN"), List.of("roster:read"), null, "", "ALL");
    var local = Db.map("id", 7L, "username", "alice", "status", "ACTIVE");
    when(center.login("alice", "原始密码")).thenReturn(Map.of("token", "initial"));
    when(center.userInfo("initial"))
        .thenReturn(
            Db.map("token", "current", "userAccount", Db.map("account", "alice", "name", "中心名称")));
    when(center.userInfo("current"))
        .thenReturn(
            Db.map("token", "next", "userAccount", Db.map("account", "alice", "name", "新名称")));
    doReturn(local).when(db).one(startsWith("SELECT id,username,status"), eq("alice"));
    doReturn(Map.of("password_hash", "stored-hash"))
        .when(db)
        .one(eq("SELECT password_hash FROM sys_user WHERE id=?"), eq(7L));
    doReturn(Map.of("present", 1))
        .when(db)
        .one(eq("SELECT 1 AS present FROM sys_user_role WHERE user_id=? LIMIT 1"), eq(7L));
    doReturn(actor).when(auth).load(7L);

    var request = new MockHttpServletRequest();
    var login = auth.login(request, Db.map("username", "alice", "password", "原始密码"));
    var loginUser = (Map<?, ?>) login.get("user");
    assertEquals("中心名称", loginUser.get("displayName"));
    assertEquals("userCenter", loginUser.get("authSource"));
    assertEquals("current", request.getSession().getAttribute("userCenterToken"));
    assertFalse(((Map<?, ?>) loginUser.get("userCenter")).containsKey("token"));

    var refreshed = (Map<?, ?>) auth.me(request).get("user");
    assertEquals("新名称", refreshed.get("displayName"));
    assertEquals("next", request.getSession().getAttribute("userCenterToken"));
    verify(center).userInfo("initial");
    verify(center).userInfo("current");
    verify(jdbc, never()).update(startsWith("INSERT IGNORE INTO sys_user"), any(), any(), any());
  }

  @Test
  void firstUserCenterLoginCreatesLocalHrAdministrator() {
    var jdbc = mock(JdbcTemplate.class);
    var db = spy(new Db(jdbc, new ObjectMapper()));
    var center = mock(UserCenterClient.class);
    var auth = spy(new Auth(db, mock(Audit.class), center));
    var local = Db.map("id", 9L, "username", "bob", "status", "ACTIVE");
    var queries = new AtomicInteger();
    when(center.login("bob", "password")).thenReturn(Map.of("token", "initial"));
    when(center.userInfo("initial"))
        .thenReturn(
            Db.map("token", "refreshed", "userAccount", Db.map("account", "bob", "name", "鲍勃")));
    doAnswer(call -> queries.getAndIncrement() == 0 ? null : local)
        .when(db)
        .one(startsWith("SELECT id,username,status"), eq("bob"));
    doReturn(Map.of("password_hash", "random-hash"))
        .when(db)
        .one(eq("SELECT password_hash FROM sys_user WHERE id=?"), eq(9L));
    var roleChecks = new AtomicInteger();
    doAnswer(call -> roleChecks.getAndIncrement() == 0 ? null : Map.of("present", 1))
        .when(db)
        .one(eq("SELECT 1 AS present FROM sys_user_role WHERE user_id=? LIMIT 1"), eq(9L));
    doReturn(
            new Actor(9, "bob", "鲍勃", List.of("HR_ADMIN"), List.of("roster:read"), null, "", "ALL"))
        .when(auth)
        .load(9L);

    var request = new MockHttpServletRequest();
    auth.login(request, Db.map("username", "bob", "password", "password"));
    assertEquals("refreshed", request.getSession().getAttribute("userCenterToken"));
    verify(jdbc)
        .update(startsWith("INSERT IGNORE INTO sys_user"), eq("bob"), eq("鲍勃"), anyString());
    verify(jdbc).update(startsWith("INSERT IGNORE INTO sys_user_role"), eq(9L));
  }

  @Test
  void existingLocalManagerUsesHrViewOnlyInUserCenterSession() {
    var jdbc = mock(JdbcTemplate.class);
    var db = spy(new Db(jdbc, new ObjectMapper()));
    var center = mock(UserCenterClient.class);
    var auth = spy(new Auth(db, mock(Audit.class), center));
    var manager =
        new Actor(
            12,
            "manager",
            "本地主管",
            List.of("DEPT_MANAGER"),
            List.of("screening:department"),
            18L,
            "ORG_18",
            "SELF_ORG_TREE");
    when(center.login("manager", "password")).thenReturn(Map.of("token", "initial"));
    when(center.userInfo("initial"))
        .thenReturn(Db.map("token", "refreshed", "userAccount", Db.map("account", "manager")));
    doReturn(Db.map("id", 12L, "username", "manager", "status", "ACTIVE"))
        .when(db)
        .one(startsWith("SELECT id,username,status"), eq("manager"));
    doReturn(Map.of("present", 1))
        .when(db)
        .one(eq("SELECT 1 AS present FROM sys_user_role WHERE user_id=? LIMIT 1"), eq(12L));
    doReturn(Map.of("password_hash", "local-hash"))
        .when(db)
        .one(eq("SELECT password_hash FROM sys_user WHERE id=?"), eq(12L));
    doReturn(manager).when(auth).load(12L);
    when(jdbc.queryForList(contains("JOIN sys_role r"), eq(String.class)))
        .thenReturn(List.of("roster:read", "screening:read", "screening:department"));

    var request = new MockHttpServletRequest();
    var view =
        (Map<?, ?>)
            auth.login(request, Db.map("username", "manager", "password", "password")).get("user");
    assertEquals("hr", view.get("role"));
    assertEquals(List.of("roster", "screening", "deptscreening"), view.get("menus"));
    assertEquals("ALL", auth.actor(request).dataScope());
    assertEquals("SELF_ORG_TREE", auth.load(12L).dataScope());
    verify(jdbc, never()).update(startsWith("INSERT IGNORE INTO sys_user_role"), eq(12L));
  }
}
