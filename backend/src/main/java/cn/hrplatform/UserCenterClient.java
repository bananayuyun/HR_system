package cn.hrplatform;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class UserCenterClient {
  private final URI base;
  private final ObjectMapper json;
  private final HttpClient http =
      HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

  UserCenterClient(@Value("${hr.user-center-base-url:}") String baseUrl, ObjectMapper json) {
    if (baseUrl.isBlank())
      throw new IllegalArgumentException("HR_USER_CENTER_BASE_URL is required for login");
    this.base = URI.create(baseUrl.replaceAll("/+$", "") + "/");
    if (!"https".equals(base.getScheme()))
      throw new IllegalArgumentException("User center URL must use HTTPS");
    this.json = json;
  }

  Map<String, Object> login(String account, String password) {
    String encoded = Base64.getEncoder().encodeToString(password.getBytes(StandardCharsets.UTF_8));
    return exchange(
        "auth/login", null, Db.map("account", account, "password", encoded, "terminalType", 1));
  }

  Map<String, Object> userInfo(String token) {
    return exchange("auth/getUserInfo?type=1", token, null);
  }

  private Map<String, Object> exchange(String path, String token, Map<String, Object> body) {
    try {
      var request =
          HttpRequest.newBuilder(base.resolve(path))
              .timeout(Duration.ofSeconds(10))
              .header("Accept", "application/json");
      if (token != null) request.header("Authorization", token);
      if (body == null) request.GET();
      else
        request
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
      var response = http.send(request.build(), HttpResponse.BodyHandlers.ofString());
      Map<String, Object> envelope;
      try {
        envelope = json.readValue(response.body(), LinkedHashMap.class);
      } catch (Exception ignored) {
        throw new ApiException(502, "用户中心返回了无法解析的响应。");
      }
      Object code = envelope.get("code");
      if (response.statusCode() != 200 || !"200".equals(Db.text(code))) {
        String message = Db.str(envelope, "message");
        if (message.isBlank()) message = Db.str(envelope, "msg");
        throw new ApiException(
            response.statusCode() == 429 ? 429 : 401, message.isBlank() ? "用户中心认证失败。" : message);
      }
      if (!(envelope.get("data") instanceof Map<?, ?> data))
        throw new ApiException(502, "用户中心响应缺少用户数据。");
      return new LinkedHashMap<>((Map<String, Object>) data);
    } catch (ApiException e) {
      throw e;
    } catch (IOException e) {
      throw new ApiException(502, "用户中心暂时无法连接。");
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new ApiException(502, "用户中心请求已中断。");
    }
  }
}
