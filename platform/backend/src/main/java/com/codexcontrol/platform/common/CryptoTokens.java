package com.codexcontrol.platform.common;

import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Locale;

@Component
public class CryptoTokens {
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final char[] PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".toCharArray();

    public String opaque(String prefix, int bytes) {
        byte[] random = new byte[bytes];
        RANDOM.nextBytes(random);
        return prefix + Base64.getUrlEncoder().withoutPadding().encodeToString(random);
    }

    public String pairingCode() {
        StringBuilder value = new StringBuilder(9);
        for (int index = 0; index < 8; index++) {
            if (index == 4) value.append('-');
            value.append(PAIRING_ALPHABET[RANDOM.nextInt(PAIRING_ALPHABET.length)]);
        }
        return value.toString();
    }

    public String hostSlug() {
        return opaque("h-", 12).toLowerCase(Locale.ROOT).replace('_', 'x');
    }

    public String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 is unavailable", error);
        }
    }

    public boolean matches(String value, String expectedHash) {
        if (value == null || expectedHash == null) return false;
        return MessageDigest.isEqual(
                sha256(value).getBytes(StandardCharsets.US_ASCII),
                expectedHash.getBytes(StandardCharsets.US_ASCII));
    }
}
