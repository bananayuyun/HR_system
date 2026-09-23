package cn.hrplatform;

import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class Auth {
  private final Db db;
  private final Audit audit;
  final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(12);
  private final Map<String, Attempts> attempts = new ConcurrentHashMap<>();

  private record Attempts(int count, long until) {}

  Auth(Db db, Audit audit) {
    this.db = db;
    this.audit = audit;
  }

  public String hashPassword(String password) {
    return encoder.encode(password);
  }

  public Actor actor(HttpServletRequest request) {
    var session = request.getSession(false);
    if (session == null || session.getAttribute("userId") == null)
      throw new ApiException(401, "请先登录。");
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
    request.setAttribute("actor", a);
    return a;
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
    String key = request.getRemoteAddr() + ":" + username;
    long now = System.currentTimeMillis();
    attempts.entrySet().removeIf(e -> e.getValue().until < now);
    var current = attempts.get(key);
    if (current != null && current.count >= 10) throw new ApiException(429, "登录尝试过多，请 15 分钟后重试。");
    var u = db.one("SELECT * FROM sys_user WHERE username=?", username);
    boolean match =
        u != null
            && "ACTIVE".equals(u.get("status"))
            && encoder.matches(password, Db.str(u, "password_hash"));
    if (!match) {
      attempts.compute(key, (k, v) -> new Attempts(v == null ? 1 : v.count + 1, now + 900_000));
      audit.record(null, "LOGIN_FAILURE", "AUTH", null, null, Map.of("username", username));
      throw new ApiException(401, "用户名或密码错误。");
    }
    attempts.remove(key);
    if (request.getSession(false) != null) request.getSession(false).invalidate();
    var session = request.getSession(true);
    session.setAttribute("userId", Db.num(u.get("id")));
    session.setAttribute("credentialVersion", Db.str(u, "password_hash"));
    Actor a = load(Db.num(u.get("id")));
    db.jdbc.update("UPDATE sys_user SET last_login_at=UTC_TIMESTAMP() WHERE id=?", a.id());
    audit.record(a, "LOGIN", "AUTH", a.id(), null, null);
    return Map.of("user", a.view());
  }

  @Transactional
  public void password(Actor a, Map<String, Object> body, HttpServletRequest request) {
    String old = Db.str(body, "oldPassword"), next = Db.str(body, "newPassword");
    var u = db.one("SELECT * FROM sys_user WHERE id=? FOR UPDATE", a.id());
    if (!encoder.matches(old, Db.str(u, "password_hash"))) throw ApiException.bad("当前密码不正确。");
    if (next.length() < 8 || next.length() > 128) throw ApiException.bad("新密码长度须为 8 至 128 位。");
    db.jdbc.update(
        "UPDATE sys_user SET password_hash=?,password_changed_at=UTC_TIMESTAMP() WHERE id=?",
        encoder.encode(next),
        a.id());
    audit.record(a, "PASSWORD_CHANGE", "AUTH", a.id(), null, null);
    request.getSession(false).invalidate();
  }
}
