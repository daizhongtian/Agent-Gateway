package com.codexcontrol.platform.auth;

import java.time.Instant;

public record DesktopAuthorizationIssue(String code, Instant expiresAt) {
}
