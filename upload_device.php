<?php
header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

if (!isset($_FILES['file'])) {
    echo json_encode(["success" => false, "error" => "No file uploaded"]);
    exit;
}

$file = $_FILES['file'];
$record_id = isset($_POST['record_id']) && $_POST['record_id'] !== '' ? intval($_POST['record_id']) : null;

if ($file['error'] !== UPLOAD_ERR_OK) {
    echo json_encode(["success" => false, "error" => "Upload error code: " . $file['error']]);
    exit;
}

// ตรวจสอบนามสกุลไฟล์
$ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
$allowed = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];
if (!in_array($ext, $allowed)) {
    echo json_encode(["success" => false, "error" => "Invalid file format. Allowed: " . implode(', ', $allowed)]);
    exit;
}

$uploadDir = 'asset/devices/';
if (!is_dir($uploadDir)) {
    mkdir($uploadDir, 0777, true);
}

$filename = uniqid('dev_') . '.' . $ext;
$targetPath = $uploadDir . $filename;

if (move_uploaded_file($file['tmp_name'], $targetPath)) {
    if ($record_id) {
        try {
            $pdo = require 'db_config.php';
            $stmt = $pdo->prepare("UPDATE cameras SET image_url = ?, go2rtc_link = ? WHERE id = ?");
            $stmt->execute([$targetPath, $targetPath, $record_id]);
        } catch (\Exception $e) {
            echo json_encode(["success" => false, "error" => "Database error: " . $e->getMessage()]);
            exit;
        }
    }
    echo json_encode(["success" => true, "url" => $targetPath]);
} else {
    echo json_encode(["success" => false, "error" => "Failed to move uploaded file"]);
}
