package cn.hrplatform;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class Crypto {
  private final byte[] key;
  private final SecureRandom random = new SecureRandom();

  public Crypto(@Value("${hr.encryption-key}") String encoded) {
    try {
      key = Base64.getDecoder().decode(encoded);
    } catch (Exception e) {
      throw new IllegalStateException("HR_ENCRYPTION_KEY must be base64 for 32 random bytes");
    }
    if (key.length != 32)
      throw new IllegalStateException(
          "Set HR_ENCRYPTION_KEY to base64 for 32 random bytes; never change it without"
              + " re-encrypting existing data.");
  }

  public byte[] encrypt(String value) {
    if (value == null || value.isBlank()) return null;
    try {
      byte[] iv = new byte[12];
      random.nextBytes(iv);
      Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
      c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
      byte[] out = c.doFinal(value.getBytes(StandardCharsets.UTF_8));
      byte[] bytes = Arrays.copyOf(iv, iv.length + out.length);
      System.arraycopy(out, 0, bytes, iv.length, out.length);
      return bytes;
    } catch (Exception e) {
      throw new IllegalStateException("Encryption failed", e);
    }
  }

  public String decrypt(byte[] value) {
    if (value == null) return "";
    try {
      Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
      c.init(
          Cipher.DECRYPT_MODE,
          new SecretKeySpec(key, "AES"),
          new GCMParameterSpec(128, Arrays.copyOf(value, 12)));
      return new String(
          c.doFinal(Arrays.copyOfRange(value, 12, value.length)), StandardCharsets.UTF_8);
    } catch (Exception e) {
      throw new IllegalStateException("Encrypted data failed authentication", e);
    }
  }
}
