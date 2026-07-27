package com.codexcontrol.platform.common;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class CryptoTokensTest {
    private final CryptoTokens tokens = new CryptoTokens();

    @Test
    void createsOpaqueTokensAndConstantTimeHashes() {
        String first = tokens.opaque("ccc_at_", 32);
        String second = tokens.opaque("ccc_at_", 32);

        assertThat(first).startsWith("ccc_at_").isNotEqualTo(second);
        assertThat(tokens.sha256(first)).hasSize(64);
        assertThat(tokens.matches(first, tokens.sha256(first))).isTrue();
        assertThat(tokens.matches(second, tokens.sha256(first))).isFalse();
    }

    @Test
    void createsHumanFriendlyPairingCodesAndOpaqueHostSlugs() {
        assertThat(tokens.pairingCode()).matches("[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}");
        assertThat(tokens.hostSlug()).matches("h-[a-z0-9-]{16,}");
    }
}
