CREATE TABLE IF NOT EXISTS folders (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    parent_id BIGINT UNSIGNED DEFAULT NULL,
    name VARCHAR(180) NOT NULL,
    status ENUM('active','inactive') NOT NULL DEFAULT 'active',
    created_by BIGINT UNSIGNED DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_folders_parent_name (parent_id, name),
    KEY idx_folders_status (status),
    CONSTRAINT fk_folders_parent FOREIGN KEY (parent_id) REFERENCES folders(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_folders_created_by FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS files (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    folder_id BIGINT UNSIGNED NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    storage_key VARCHAR(255) NOT NULL,
    size BIGINT UNSIGNED NOT NULL DEFAULT 0,
    mime_type VARCHAR(180) NOT NULL DEFAULT 'application/octet-stream',
    checksum CHAR(64) DEFAULT NULL,
    uploaded_by BIGINT UNSIGNED DEFAULT NULL,
    status ENUM('active','inactive') NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_files_storage_key (storage_key),
    KEY idx_files_folder_status (folder_id, status),
    CONSTRAINT fk_files_folder FOREIGN KEY (folder_id) REFERENCES folders(id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_files_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users(id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS file_permissions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    folder_id BIGINT UNSIGNED DEFAULT NULL,
    file_id BIGINT UNSIGNED DEFAULT NULL,
    permission ENUM('read','download') NOT NULL DEFAULT 'download',
    created_by BIGINT UNSIGNED DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_file_permissions_user (user_id),
    KEY idx_file_permissions_folder (folder_id),
    KEY idx_file_permissions_file (file_id),
    CONSTRAINT fk_file_permissions_user FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_file_permissions_folder FOREIGN KEY (folder_id) REFERENCES folders(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_file_permissions_file FOREIGN KEY (file_id) REFERENCES files(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_file_permissions_created_by FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_file_permissions_one_target CHECK (
        (folder_id IS NOT NULL AND file_id IS NULL) OR
        (folder_id IS NULL AND file_id IS NOT NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS command_definitions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    command_text VARCHAR(80) NOT NULL,
    display_name VARCHAR(180) NOT NULL,
    action_type ENUM('download_folder','download_file') NOT NULL,
    target_folder_id BIGINT UNSIGNED DEFAULT NULL,
    target_file_id BIGINT UNSIGNED DEFAULT NULL,
    description TEXT DEFAULT NULL,
    status ENUM('active','inactive') NOT NULL DEFAULT 'active',
    created_by BIGINT UNSIGNED DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_command_definitions_text (command_text),
    KEY idx_command_definitions_status (status),
    CONSTRAINT fk_commands_folder FOREIGN KEY (target_folder_id) REFERENCES folders(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_commands_file FOREIGN KEY (target_file_id) REFERENCES files(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_commands_created_by FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_commands_target CHECK (
        (action_type = 'download_folder' AND target_folder_id IS NOT NULL AND target_file_id IS NULL) OR
        (action_type = 'download_file' AND target_folder_id IS NULL AND target_file_id IS NOT NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;