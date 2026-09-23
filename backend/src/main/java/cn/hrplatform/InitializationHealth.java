package cn.hrplatform;

import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

@Component
public class InitializationHealth implements HealthIndicator {
  private volatile boolean ready;

  @EventListener(ApplicationReadyEvent.class)
  public void ready() {
    ready = true;
  }

  @Override
  public Health health() {
    return ready ? Health.up().build() : Health.down().build();
  }
}
