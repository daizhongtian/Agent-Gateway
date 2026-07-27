package com.codexcontrol.platform.common;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.LinkedHashMap;
import java.util.Map;

@RestControllerAdvice
public class GlobalExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    ResponseEntity<ApiErrorResponse> apiException(ApiException error, HttpServletRequest request) {
        return ResponseEntity.status(error.status()).body(ApiErrorResponse.of(
                error.code(), error.getMessage(), requestId(request), error.details()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ApiErrorResponse> validation(MethodArgumentNotValidException error, HttpServletRequest request) {
        Map<String, Object> fields = new LinkedHashMap<>();
        for (FieldError fieldError : error.getBindingResult().getFieldErrors()) {
            fields.putIfAbsent(fieldError.getField(), fieldError.getDefaultMessage());
        }
        return ResponseEntity.badRequest().body(ApiErrorResponse.of(
                "VALIDATION_FAILED", "The request contains invalid fields.", requestId(request), fields));
    }

    @ExceptionHandler(ConstraintViolationException.class)
    ResponseEntity<ApiErrorResponse> constraintViolation(ConstraintViolationException error, HttpServletRequest request) {
        return ResponseEntity.badRequest().body(ApiErrorResponse.of(
                "VALIDATION_FAILED", "The request contains an invalid value.", requestId(request)));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ApiErrorResponse> unreadable(HttpMessageNotReadableException error, HttpServletRequest request) {
        return ResponseEntity.badRequest().body(ApiErrorResponse.of(
                "INVALID_JSON", "The request body is not valid JSON.", requestId(request)));
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    ResponseEntity<ApiErrorResponse> invalidParameter(
            MethodArgumentTypeMismatchException error,
            HttpServletRequest request
    ) {
        return ResponseEntity.badRequest().body(ApiErrorResponse.of(
                "INVALID_PARAMETER",
                "A path or query parameter has an invalid value.",
                requestId(request),
                Map.of("parameter", error.getName())));
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    ResponseEntity<ApiErrorResponse> conflict(DataIntegrityViolationException error, HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(ApiErrorResponse.of(
                "RESOURCE_CONFLICT", "The requested resource conflicts with an existing record.", requestId(request)));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiErrorResponse> unexpected(Exception error, HttpServletRequest request) {
        log.error("Unhandled platform request failure", error);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(ApiErrorResponse.of(
                "INTERNAL_ERROR", "The server could not complete the request.", requestId(request)));
    }

    private static String requestId(HttpServletRequest request) {
        Object value = request.getAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE);
        return value instanceof String text ? text : null;
    }
}
