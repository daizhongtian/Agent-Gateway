package com.codexcontrol.platform.common;

import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class GlobalExceptionHandlerTest {
    @Test
    void dataIntegrityFailuresReturnAStableConflict() {
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE)).thenReturn("req_conflict_test");
        GlobalExceptionHandler handler = new GlobalExceptionHandler();

        var response = handler.conflict(mock(DataIntegrityViolationException.class), request);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().error().code()).isEqualTo("RESOURCE_CONFLICT");
    }

    @Test
    void unsupportedContentTypesReturnAClientError() {
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE)).thenReturn("req_media_type_test");
        GlobalExceptionHandler handler = new GlobalExceptionHandler();

        var response = handler.unsupportedMediaType(mock(HttpMediaTypeNotSupportedException.class), request);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNSUPPORTED_MEDIA_TYPE);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().error().code()).isEqualTo("UNSUPPORTED_MEDIA_TYPE");
        assertThat(response.getBody().error().requestId()).isEqualTo("req_media_type_test");
    }

    @Test
    void unknownRoutesRemainClientErrorsInsteadOfBecomingInternalFailures() {
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE)).thenReturn("req_security_test");
        GlobalExceptionHandler handler = new GlobalExceptionHandler();

        var response = handler.routeNotFound(mock(NoResourceFoundException.class), request);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().error().code()).isEqualTo("ROUTE_NOT_FOUND");
        assertThat(response.getBody().error().requestId()).isEqualTo("req_security_test");
    }
}
