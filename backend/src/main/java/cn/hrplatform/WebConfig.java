package cn.hrplatform;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {
  private final Auth auth;
  private final Set<String> origins;

  WebConfig(Auth auth, @Value("${hr.allowed-origins}") String origins) {
    this.auth = auth;
    this.origins = Set.of(origins.split(","));
  }

  @Override
  public void addInterceptors(InterceptorRegistry registry) {
    registry
        .addInterceptor(
            new HandlerInterceptor() {
              @Override
              public boolean preHandle(
                  HttpServletRequest req, HttpServletResponse res, Object handler) {
                String requestId = UUID.randomUUID().toString();
                req.setAttribute("requestId", requestId);
                res.setHeader("X-Request-Id", requestId);
                res.setHeader("X-Content-Type-Options", "nosniff");
                res.setHeader("X-Frame-Options", "DENY");
                res.setHeader("Cache-Control", "no-store");
                res.setHeader("Referrer-Policy", "same-origin");
                if (!Set.of("GET", "HEAD", "OPTIONS").contains(req.getMethod())) {
                  String origin = req.getHeader("Origin");
                  if (origin != null && !origins.contains(origin))
                    throw new ApiException(403, "请求来源不被允许。");
                  String content = Optional.ofNullable(req.getContentType()).orElse("");
                  if (req.getContentLengthLong() > 0
                      && !content.startsWith("application/json")
                      && !content.startsWith("multipart/form-data"))
                    throw new ApiException(415, "请使用 JSON 或 multipart 请求。");
                }
                if (!req.getRequestURI().equals("/api/auth/login")) auth.actor(req);
                return true;
              }
            })
        .addPathPatterns("/api/**");
  }
}
