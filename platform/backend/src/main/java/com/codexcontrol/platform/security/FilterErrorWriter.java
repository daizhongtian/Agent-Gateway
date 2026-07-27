package com.codexcontrol.platform.security;

import com.codexcontrol.platform.common.ApiErrorResponse;
import com.codexcontrol.platform.common.RequestIdFilter;
import tools.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;

import java.io.IOException;

@Component
public class FilterErrorWriter {
    private final ObjectMapper objectMapper;

    public FilterErrorWriter(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public void write(HttpServletRequest request, HttpServletResponse response, int status, String code, String message)
            throws IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        Object requestId = request.getAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE);
        objectMapper.writeValue(response.getWriter(), ApiErrorResponse.of(
                code,
                message,
                requestId instanceof String value ? value : null));
    }
}
