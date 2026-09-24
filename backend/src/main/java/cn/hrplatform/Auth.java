package cn.hrplatform;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import java.util.*;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class Auth {
  private final Db db;
  private final Audit audit;
  private final UserCenterClient userCenter;
  final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(12);

  Auth(Db db, Audit audit, UserCenterClient userCenter) {
    this.db = db;
    this.audit = audit;
    this.userCenter = userCenter;
  }

  public String hashPassword(String password) {
    return encoder.encode(password);
  }

  public Actor actor(HttpServletRequest request) {
    var session = request.getSession(false);
    if (session == null || session.getAttribute("userId") == null)
      throw new ApiException(401, "请先登录。");
    if (session.getAttribute("userCenterToken") == null) {
      session.invalidate();
      throw new ApiException(401, "请使用用户中心账号重新登录。");
    }
    Actor a = load(Db.num(session.getAttribute("userId")));
    if (a == null) {
      session.invalidate();
      throw new ApiException(401, "会话已失效，请重新登录。");
    }
    String hash =
        Db.text(
            db.one("SELECT password_hash FROM sys_user WHERE id=?", a.id()).get("password_hash"));
    if (!hash.equals(session.getAttribute("credentialVersion"))) {
      session.invalidate();
      throw new ApiException(401, "密码已变更，请重新登录。");
    }
    a = userCenterActor(a);
    request.setAttribute("actor", a);
    return a;
  }

  protected Actor userCenterActor(Actor local) {
    if (local.roles().contains("HR_ADMIN") && local.all()) return local;
    var permissions =
        db.jdbc.queryForList(
            "SELECT DISTINCT p.code FROM sys_permission p"
                + " JOIN sys_role_permission rp ON rp.permission_id=p.id"
                + " JOIN sys_role r ON r.id=rp.role_id WHERE r.code='HR_ADMIN'",
            String.class);
    if (!permissions.contains("screening:department")) throw new ApiException(500, "HR 管理员权限未初始化。");
    return new Actor(
        local.id(),
        local.username(),
        local.displayName(),
        List.of("HR_ADMIN"),
        permissions,
        local.orgId(),
        local.orgCode(),
        "ALL");
  }

  public Actor load(long id) {
    var u =
        db.one(
            "SELECT u.*,o.code org_code FROM sys_user u LEFT JOIN org_department o ON o.id=u.org_id"
                + " WHERE u.id=? AND u.status='ACTIVE'",
            id);
    if (u == null) return null;
    var roles =
        db.jdbc.queryForList(
            "SELECT r.code,r.data_scope FROM sys_role r JOIN sys_user_role ur ON ur.role_id=r.id"
                + " WHERE ur.user_id=?",
            id);
    var permissions =
        db.jdbc.queryForList(
            "SELECT DISTINCT p.code FROM sys_permission p JOIN sys_role_permission rp ON"
                + " rp.permission_id=p.id JOIN sys_user_role ur ON ur.role_id=rp.role_id WHERE"
                + " ur.user_id=?",
            String.class,
            id);
    String scope =
        roles.stream().anyMatch(r -> "ALL".equals(r.get("data_scope")))
            ? "ALL"
            : roles.stream().anyMatch(r -> "SELF_ORG_TREE".equals(r.get("data_scope")))
                ? "SELF_ORG_TREE"
                : "SELF_ORG";
    return new Actor(
        id,
        Db.str(u, "username"),
        Db.str(u, "display_name"),
        roles.stream().map(r -> Db.str(r, "code")).toList(),
        permissions,
        u.get("org_id") == null ? null : Db.num(u.get("org_id")),
        Db.str(u, "org_code"),
        scope);
  }

  public Map<String, Object> login(HttpServletRequest request, Map<String, Object> body) {
    String username = Db.str(body, "username"), password = Db.str(body, "password");
    if (username.length() > 64 || password.length() > 256) throw ApiException.bad("用户名或密码格式无效。");
    return userCenterLogin(request, username, password);
  }

  private Map<String, Object> userCenterLogin(
      HttpServletRequest request, String account, String password) {
    if (account.isBlank() || password.isBlank()) throw ApiException.bad("请输入账号和密码。");
    var login = userCenter.login(account, password);
    String initialToken = Db.str(login, "token");
    if (initialToken.isBlank()) throw new ApiException(502, "用户中心登录响应缺少 token。");
    var profile = userCenter.userInfo(initialToken);
    String refreshedToken = Db.str(profile, "token");
    if (refreshedToken.isBlank()) throw new ApiException(502, "用户中心用户信息响应缺少 token。");
    verifyAccount(account, profile);

    var local = db.one("SELECT id,username,status FROM sys_user WHERE username=?", account);
    if (local != null && !account.equals(Db.str(local, "username")))
      throw new ApiException(409, "本地存在大小写不同的同名账号，请联系管理员处理。");
    if (local == null) {
      db.jdbc.update(
          "INSERT IGNORE INTO sys_user(username,display_name,password_hash) VALUES(?,?,?)",
          account,
          displayName(account, profile),
          encoder.encode(UUID.randomUUID().toString()));
      local = db.one("SELECT id,username,status FROM sys_user WHERE username=?", account);
      if (local == null || !account.equals(Db.str(local, "username")))
        throw new ApiException(409, "本地账号无法创建，请联系管理员处理。");
    }
    if (!"ACTIVE".equals(Db.str(local, "status"))) throw new ApiException(403, "本地账号已停用，请联系管理员。");
    long localId = Db.num(local.get("id"));
    String roleQuery = "SELECT 1 AS present FROM sys_user_role WHERE user_id=? LIMIT 1";
    if (db.one(roleQuery, localId) == null) {
      db.jdbc.update(
          "INSERT IGNORE INTO sys_user_role(user_id,role_id)"
              + " SELECT ?,id FROM sys_role WHERE code='HR_ADMIN'",
          localId);
      if (db.one(roleQuery, localId) == null) throw new ApiException(500, "HR 管理员角色未初始化。");
    }
    if (request.getSession(false) != null) request.getSession(false).invalidate();
    var session = request.getSession(true);
    session.setAttribute("userId", Db.num(local.get("id")));
    session.setAttribute(
        "credentialVersion",
        Db.str(
            db.one("SELECT password_hash FROM sys_user WHERE id=?", local.get("id")),
            "password_hash"));
    session.setAttribute("userCenterToken", refreshedToken);
    session.setAttribute("userCenterProfile", profile);
    Actor actor = userCenterActor(load(Db.num(local.get("id"))));
    db.jdbc.update("UPDATE sys_user SET last_login_at=UTC_TIMESTAMP() WHERE id=?", actor.id());
    audit.record(actor, "LOGIN", "AUTH", actor.id(), null, null);
    return Map.of("user", view(actor, session));
  }

  private void verifyAccount(String account, Map<String, Object> profile) {
    if (!(profile.get("userAccount") instanceof Map<?, ?> user))
      throw new ApiException(502, "用户中心响应缺少账号信息。");
    Object actual = user.get("account");
    if (actual != null && !account.equals(Db.text(actual)))
      throw new ApiException(401, "用户中心返回的账号与登录账号不一致。");
  }

  private String displayName(String account, Map<String, Object> profile) {
    Map<String, Object> user = db.object(profile.get("userAccount"));
    for (String key : List.of("realName", "name", "nickName", "userName")) {
      String value = Db.str(user, key);
      if (!value.isBlank()) return value.length() > 128 ? value.substring(0, 128) : value;
    }
    return account;
  }

  public Map<String, Object> me(HttpServletRequest request) {
    Actor current = actor(request);
    var session = request.getSession(false);
    try {
      var profile = userCenter.userInfo(Db.text(session.getAttribute("userCenterToken")));
      verifyAccount(current.username(), profile);
      String token = Db.str(profile, "token");
      if (token.isBlank()) throw new ApiException(502, "用户中心用户信息响应缺少 token。");
      session.setAttribute("userCenterToken", token);
      session.setAttribute("userCenterProfile", profile);
    } catch (ApiException e) {
      session.invalidate();
      throw e;
    }
    return Map.of("user", view(current, session));
  }

  public Map<String, Object> view(Actor actor, HttpSession session) {
    var view = new LinkedHashMap<>(actor.view());
    if (session != null && session.getAttribute("userCenterProfile") instanceof Map<?, ?> raw) {
      var profile = new LinkedHashMap<>((Map<String, Object>) raw);
      profile.keySet().retainAll(Set.of("userAccount", "userInfo", "currentTenant"));
      view.put("authSource", "userCenter");
      view.put("displayName", displayName(actor.username(), (Map<String, Object>) raw));
      view.put("userCenter", profile);
    }
    return view;
  }

  public void password(Actor a, Map<String, Object> body, HttpServletRequest request) {
    throw new ApiException(400, "请在用户中心修改密码。");
  }
}
