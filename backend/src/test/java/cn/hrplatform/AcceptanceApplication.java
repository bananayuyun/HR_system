package cn.hrplatform;

import java.util.Map;
import org.mockito.Mockito;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Local acceptance entry point; never included in the deployable JAR. */
public class AcceptanceApplication {
  public static void main(String[] args) {
    String database = System.getenv().getOrDefault("DB_URL", "");
    if (!database.matches("jdbc:mysql://127[.]0[.]0[.]1:[0-9]+/hrms_acceptance_[0-9]{8}([_][a-z0-9]+)?[?].*"))
      throw new IllegalStateException("Acceptance backend requires an isolated localhost schema.");
    if (!"8091".equals(System.getenv("SERVER_PORT")))
      throw new IllegalStateException("Acceptance backend requires port 8091.");
    new SpringApplicationBuilder(HrApplication.class, AcceptanceConfiguration.class).run(args);
  }

  @RestController
  static class AcceptanceMarker {
    @GetMapping("/__acceptance/identity")
    String identity() {
      return "mock-user-center-v1";
    }
  }

  @Configuration(proxyBeanMethods = false)
  static class AcceptanceConfiguration {
    @Bean
    @Primary
    UserCenterClient acceptanceUserCenter() {
      var center = Mockito.mock(UserCenterClient.class);
      Mockito.when(center.login(Mockito.anyString(), Mockito.anyString()))
          .thenAnswer(
              call -> {
                String account = call.getArgument(0);
                String password = call.getArgument(1);
                boolean allowed =
                    ("admin".equals(account) && "admin123".equals(password))
                        || ("manager".equals(account) && "manager123".equals(password))
                        || ("qa_unbound".equals(account) && "qa123".equals(password));
                if (!allowed) throw new ApiException(401, "测试用户中心拒绝登录。");
                return Map.of("token", "acceptance:" + account);
              });
      Mockito.when(center.userInfo(Mockito.anyString()))
          .thenAnswer(
              call -> {
                String token = call.getArgument(0);
                if (!token.startsWith("acceptance:"))
                  throw new ApiException(401, "测试用户中心会话无效。");
                String account = token.substring("acceptance:".length());
                return Db.map(
                    "token",
                    token,
                    "userAccount",
                    Db.map("account", account, "name", account));
              });
      return center;
    }

    @Bean
    @Primary
    Auth acceptanceAuth(Db db, Audit audit, UserCenterClient center) {
      return new Auth(db, audit, center) {
        @Override
        protected Actor userCenterActor(Actor local) {
          return local;
        }
      };
    }
  }
}
