USE web_user_system;

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS about;
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS client_links;
DROP TABLE IF EXISTS active_sessions;
DROP TABLE IF EXISTS activity_logs;
DROP TABLE IF EXISTS login_logs;
DROP TABLE IF EXISTS password_resets;
DROP TABLE IF EXISTS email_verifications;
DROP TABLE IF EXISTS users;

SET FOREIGN_KEY_CHECKS = 1;


CREATE TABLE users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) DEFAULT NULL,
    role ENUM('admin','user') NOT NULL DEFAULT 'user',
    status ENUM('pending','active','suspended','disabled')
        NOT NULL DEFAULT 'pending',
    email_verified_at DATETIME DEFAULT NULL,
    last_login_at DATETIME DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uk_users_email (email),
    KEY idx_users_role (role),
    KEY idx_users_status (status),
    KEY idx_users_created_at (created_at)
) ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci;


CREATE TABLE email_verifications (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    token_hash VARCHAR(255) NOT NULL,
    expires_at DATETIME NOT NULL,
    verified_at DATETIME DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_email_verifications_user_id (user_id),
    KEY idx_email_verifications_expires_at (expires_at),

    CONSTRAINT fk_email_verifications_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
) ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci;


CREATE TABLE password_resets (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    token_hash VARCHAR(255) NOT NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_password_resets_user_id (user_id),
    KEY idx_password_resets_expires_at (expires_at),

    CONSTRAINT fk_password_resets_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
) ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci;


CREATE TABLE login_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED DEFAULT NULL,
    email_attempted VARCHAR(255) DEFAULT NULL,

    login_status ENUM('success','failed') NOT NULL,
    failure_reason VARCHAR(255) DEFAULT NULL,

    ip_address VARCHAR(45) DEFAULT NULL,
    user_agent TEXT DEFAULT NULL,
    browser VARCHAR(100) DEFAULT NULL,
    operating_system VARCHAR(100) DEFAULT NULL,
    device_type VARCHAR(50) DEFAULT NULL,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_login_logs_user_id (user_id),
    KEY idx_login_logs_email (email_attempted),
    KEY idx_login_logs_status (login_status),
    KEY idx_login_logs_ip (ip_address),
    KEY idx_login_logs_created_at (created_at),

    CONSTRAINT fk_login_logs_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
) ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci;


CREATE TABLE activity_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED DEFAULT NULL,

    action VARCHAR(100) NOT NULL,
    module VARCHAR(100) DEFAULT NULL,
    description TEXT DEFAULT NULL,

    target_type VARCHAR(100) DEFAULT NULL,
    target_id VARCHAR(100) DEFAULT NULL,

    ip_address VARCHAR(45) DEFAULT NULL,
    user_agent TEXT DEFAULT NULL,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_activity_logs_user_id (user_id),
    KEY idx_activity_logs_action (action),
    KEY idx_activity_logs_module (module),
    KEY idx_activity_logs_target (target_type, target_id),
    KEY idx_activity_logs_created_at (created_at),

    CONSTRAINT fk_activity_logs_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
) ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci;


CREATE TABLE active_sessions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,

    session_token_hash VARCHAR(255) NOT NULL,

    ip_address VARCHAR(45) DEFAULT NULL,
    user_agent TEXT DEFAULT NULL,

    browser VARCHAR(100) DEFAULT NULL,
    operating_system VARCHAR(100) DEFAULT NULL,
    device_type VARCHAR(50) DEFAULT NULL,

    login_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_activity_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    logout_at DATETIME DEFAULT NULL,
    revoked_at DATETIME DEFAULT NULL,

    status ENUM('active','logged_out','revoked')
        NOT NULL DEFAULT 'active',

    PRIMARY KEY (id),
    KEY idx_active_sessions_user_id (user_id),
    KEY idx_active_sessions_status (status),
    KEY idx_active_sessions_last_activity (last_activity_at),

    CONSTRAINT fk_active_sessions_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
) ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci;


CREATE TABLE client_links (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    name VARCHAR(150) NOT NULL,
    url VARCHAR(500) NOT NULL,
    description TEXT DEFAULT NULL,

    status ENUM('active','inactive')
        NOT NULL DEFAULT 'active',

    created_by BIGINT UNSIGNED DEFAULT NULL,

    sort_order INT NOT NULL DEFAULT 0,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_client_links_status (status),
    KEY idx_client_links_sort_order (sort_order),
    KEY idx_client_links_created_by (created_by),

    CONSTRAINT fk_client_links_created_by
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
) ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci;


CREATE TABLE settings (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    setting_key VARCHAR(150) NOT NULL,
    setting_value LONGTEXT DEFAULT NULL,

    updated_by BIGINT UNSIGNED DEFAULT NULL,

    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uk_settings_key (setting_key),
    KEY idx_settings_updated_by (updated_by),

    CONSTRAINT fk_settings_updated_by
        FOREIGN KEY (updated_by)
        REFERENCES users(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
) ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci;


CREATE TABLE about (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    source VARCHAR(100) DEFAULT NULL,
    data_json LONGTEXT DEFAULT NULL,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_about_source (source),
    KEY idx_about_created_at (created_at)
) ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci;
