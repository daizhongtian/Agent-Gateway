package com.codexcontrol.platform.account;

import com.codexcontrol.platform.auth.AuthDtos;
import com.codexcontrol.platform.auth.AuthService;
import com.codexcontrol.platform.auth.PlatformPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/account")
public class AccountController {
    private final AuthService authService;
    private final UserAccountRepository userRepository;

    public AccountController(AuthService authService, UserAccountRepository userRepository) {
        this.authService = authService;
        this.userRepository = userRepository;
    }

    @PatchMapping
    public AuthDtos.UserView update(
            @AuthenticationPrincipal PlatformPrincipal principal,
            @Valid @RequestBody UpdateAccountRequest request
    ) {
        UserAccount user = authService.requireUser(principal.userId());
        user.rename(request.displayName().trim());
        return AuthDtos.UserView.from(userRepository.save(user));
    }

    public record UpdateAccountRequest(@NotBlank @Size(min = 2, max = 80) String displayName) {
    }
}
