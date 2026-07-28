package com.codexcontrol.platform.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {
    private final AuthService authService;
    private final CookieSupport cookies;

    public AuthController(AuthService authService, CookieSupport cookies) {
        this.authService = authService;
        this.cookies = cookies;
    }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public AuthDtos.AuthResponse register(
            @Valid @RequestBody AuthDtos.RegisterRequest request,
            HttpServletRequest servletRequest,
            HttpServletResponse response
    ) {
        IssuedSession issued = authService.register(request, servletRequest);
        return response(issued, AuthDtos.ClientType.parse(request.clientType()), response);
    }

    @PostMapping("/login")
    public AuthDtos.AuthResponse login(
            @Valid @RequestBody AuthDtos.LoginRequest request,
            HttpServletRequest servletRequest,
            HttpServletResponse response
    ) {
        IssuedSession issued = authService.login(request, servletRequest);
        return response(issued, AuthDtos.ClientType.parse(request.clientType()), response);
    }

    @PostMapping("/refresh")
    public AuthDtos.AuthResponse refresh(
            @Valid @RequestBody(required = false) AuthDtos.RefreshRequest request,
            HttpServletRequest servletRequest,
            HttpServletResponse response
    ) {
        String supplied = request == null ? null : request.refreshToken();
        String refreshToken = supplied == null || supplied.isBlank()
                ? cookies.read(servletRequest, CookieSupport.REFRESH_COOKIE)
                : supplied;
        IssuedSession issued = authService.refresh(refreshToken);
        AuthDtos.ClientType clientType = AuthDtos.ClientType.parse(request == null ? null : request.clientType());
        return response(issued, clientType, response);
    }

    @PostMapping("/desktop/authorize")
    @ResponseStatus(HttpStatus.CREATED)
    public AuthDtos.DesktopAuthorizeResponse authorizeDesktop(
            @AuthenticationPrincipal PlatformPrincipal principal,
            @Valid @RequestBody AuthDtos.DesktopAuthorizeRequest request
    ) {
        DesktopAuthorizationIssue issued = authService.authorizeDesktop(principal.userId(), request.codeChallenge());
        return new AuthDtos.DesktopAuthorizeResponse(issued.code(), issued.expiresAt());
    }

    @PostMapping("/desktop/exchange")
    public AuthDtos.AuthResponse exchangeDesktop(
            @Valid @RequestBody AuthDtos.DesktopExchangeRequest request,
            HttpServletRequest servletRequest,
            HttpServletResponse response
    ) {
        IssuedSession issued = authService.exchangeDesktopAuthorization(request, servletRequest);
        return response(issued, AuthDtos.ClientType.DESKTOP, response);
    }

    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(@AuthenticationPrincipal PlatformPrincipal principal, HttpServletResponse response) {
        authService.logout(principal.sessionId());
        cookies.clearSession(response);
    }

    @GetMapping("/session")
    public AuthDtos.SessionResponse session(@AuthenticationPrincipal PlatformPrincipal principal) {
        var user = authService.requireUser(principal.userId());
        return new AuthDtos.SessionResponse(AuthDtos.UserView.from(user), principal.accessExpiresAt());
    }

    private AuthDtos.AuthResponse response(
            IssuedSession issued,
            AuthDtos.ClientType clientType,
            HttpServletResponse servletResponse
    ) {
        if (clientType == AuthDtos.ClientType.BROWSER) cookies.writeSession(servletResponse, issued);
        return new AuthDtos.AuthResponse(
                AuthDtos.UserView.from(issued.session().getUser()),
                issued.accessExpiresAt(),
                issued.refreshExpiresAt(),
                issued.csrfToken(),
                clientType == AuthDtos.ClientType.DESKTOP ? issued.accessToken() : null,
                clientType == AuthDtos.ClientType.DESKTOP ? issued.refreshToken() : null);
    }
}
