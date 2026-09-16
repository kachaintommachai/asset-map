CREATE DATABASE IF NOT EXISTS cctv_monitor CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'cctv_user'@'localhost' IDENTIFIED BY 'cctv_pass';
GRANT ALL PRIVILEGES ON cctv_monitor.* TO 'cctv_user'@'localhost';
FLUSH PRIVILEGES;
USE cctv_monitor;

CREATE TABLE IF NOT EXISTS departments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    department VARCHAR(100) UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS maps (
    id INT AUTO_INCREMENT PRIMARY KEY,
    map_name VARCHAR(200),
    map_url VARCHAR(500)
);

CREATE TABLE IF NOT EXISTS cameras (
    id INT AUTO_INCREMENT PRIMARY KEY,
    cam_id VARCHAR(50),
    eng_name VARCHAR(200),
    thai_name VARCHAR(200),
    type VARCHAR(50),
    brand VARCHAR(100),
    model VARCHAR(100),
    serial VARCHAR(100),
    in_out VARCHAR(20),
    department VARCHAR(100),
    recorder VARCHAR(100),
    recorder_ch VARCHAR(50),
    ip VARCHAR(50),
    mac_address VARCHAR(50),
    status VARCHAR(50) DEFAULT 'Active',
    account_no VARCHAR(100),
    image_url VARCHAR(500),
    go2rtc_link VARCHAR(500),
    map_id INT DEFAULT 1,
    x DECIMAL(8,4) NULL,
    y DECIMAL(8,4) NULL
);

CREATE OR REPLACE VIEW devices AS 
SELECT 
    id, 
    COALESCE(account_no, cam_id) AS asset_code, 
    eng_name AS asset_name, 
    thai_name AS holder, 
    type, 
    brand, 
    model, 
    serial, 
    department, 
    ip, 
    mac_address, 
    status, 
    image_url, 
    map_id, 
    x, 
    y 
FROM cameras;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    department VARCHAR(500),
    camera_user TEXT,
    map_user TEXT
);
