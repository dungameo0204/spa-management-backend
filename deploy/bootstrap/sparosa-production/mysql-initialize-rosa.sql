-- Execute as a MySQL administrator after replacing ROSA_BACKEND_PASSWORD locally.
-- Do not save the completed file with a real password in source control or the bootstrap ZIP.
CREATE DATABASE IF NOT EXISTS `db_system_master` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS `db_spa_template` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'rosa'@'127.0.0.1' IDENTIFIED BY 'ROSA_BACKEND_PASSWORD';
ALTER USER 'rosa'@'127.0.0.1' IDENTIFIED BY 'ROSA_BACKEND_PASSWORD';
GRANT ALL PRIVILEGES ON `db_system_master`.* TO 'rosa'@'127.0.0.1';
GRANT ALL PRIVILEGES ON `db_spa_template`.* TO 'rosa'@'127.0.0.1';
-- Escape underscores: this grants only the db_spa_<timestamp>_<hex> namespace, not dbXspaX.
GRANT ALL PRIVILEGES ON `db\_spa\_%`.* TO 'rosa'@'127.0.0.1';
-- tenantService creates the tenant database. DROP is deliberately not granted because the service does not drop databases.
GRANT CREATE ON *.* TO 'rosa'@'127.0.0.1';
FLUSH PRIVILEGES;
SHOW GRANTS FOR 'rosa'@'127.0.0.1';