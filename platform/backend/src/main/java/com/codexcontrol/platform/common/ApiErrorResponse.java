package com.codexcontrol.platform.common;

import java.time.Instant;
import java.util.Map;

public record ApiErrorResponse(ErrorBody error) {
    public static ApiErrorResponse of(String code, String message, String requestId) {
        return of(code, message, requestId, Map.of());
    }

    public static ApiErrorResponse of(String code, String message, String requestId, Map<String, Object> details) {
        return new ApiErrorResponse(new ErrorBody(code, message, requestId, Instant.now(), details));
    }

    public record ErrorBody(
            String code,
            String message,
            String requestId,
            Instant timestamp,
            Map<String, Object> details
    ) {
    }
}
