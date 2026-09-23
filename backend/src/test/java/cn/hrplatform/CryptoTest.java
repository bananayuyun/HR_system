package cn.hrplatform;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.charset.StandardCharsets;
import java.util.*;
import org.junit.jupiter.api.Test;

class CryptoTest {
  Crypto crypto = new Crypto(Base64.getEncoder().encodeToString(new byte[32]));

  @Test
  void sensitiveValuesRoundTripWithoutPlaintext() {
    String value = "310101199402123456/6222000000000000";
    byte[] bytes = crypto.encrypt(value);
    assertEquals(value, crypto.decrypt(bytes));
    assertFalse(new String(bytes, StandardCharsets.UTF_8).contains(value));
  }

  @Test
  void sameValueHasDifferentCiphertexts() {
    assertFalse(Arrays.equals(crypto.encrypt("secret"), crypto.encrypt("secret")));
  }

  @Test
  void tamperedCiphertextIsRejected() {
    byte[] bytes = crypto.encrypt("身份证信息");
    bytes[bytes.length - 1] ^= 1;
    assertThrows(IllegalStateException.class, () -> crypto.decrypt(bytes));
  }

  @Test
  void wrongKeyCannotDecrypt() {
    byte[] key = new byte[32];
    key[0] = 1;
    var other = new Crypto(Base64.getEncoder().encodeToString(key));
    assertThrows(IllegalStateException.class, () -> other.decrypt(crypto.encrypt("银行卡信息")));
  }

  @Test
  void invalidKeyFailsClosed() {
    assertThrows(IllegalStateException.class, () -> new Crypto(""));
  }
}
