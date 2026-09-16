<?php
header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

if (!isset($_FILES['file']) || !isset($_POST['record_id'])) {
    echo json_encode(["success" => false, "error" => "Missing file or record_id"]);
    exit;
}

$file = $_FILES['file'];
$record_id = intval($_POST['record_id']);

if ($file['error'] !== UPLOAD_ERR_OK) {
    echo json_encode(["success" => false, "error" => "Upload error code: " . $file['error']]);
    exit;
}

$uploadDir = 'asset/maps/';
if (!is_dir($uploadDir)) {
    mkdir($uploadDir, 0777, true);
}

$ext = pathinfo($file['name'], PATHINFO_EXTENSION);
$filename = uniqid('map_') . '.' . $ext;
$targetPath = $uploadDir . $filename;

if (move_uploaded_file($file['tmp_name'], $targetPath)) {
    try {
        $pdo = require 'db_config.php';
        $stmt = $pdo->prepare("UPDATE maps SET map_url = ? WHERE id = ?");
        $stmt->execute([$targetPath, $record_id]);
        
        echo json_encode(["success" => true, "url" => $targetPath]);
    } catch (\Exception $e) {
        echo json_encode(["success" => false, "error" => "Database error: " . $e->getMessage()]);
    }
} else {
    echo json_encode(["success" => false, "error" => "Failed to move uploaded file"]);
}
