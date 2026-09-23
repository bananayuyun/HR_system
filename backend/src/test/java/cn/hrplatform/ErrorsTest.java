package cn.hrplatform;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.web.servlet.resource.NoResourceFoundException;

class ErrorsTest {
  @Test
  void unknownEndpointIsNotAServerFailure() {
    var response =
        new Errors().notFound(new NoResourceFoundException(HttpMethod.GET, "/api/not-defined"));
    assertEquals(404, response.getStatusCode().value());
    assertEquals(404, ((Map<?, ?>) response.getBody()).get("code"));
  }
}
