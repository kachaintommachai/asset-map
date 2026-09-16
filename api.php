<?php
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Content-Type: application/json; charset=utf-8');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$pdo = require 'db_config.php';
$table = $_GET['table'] ?? '';

function formatCameraRow($row) {
    $imageUrl = $row['image_url'] ?? '';
    if (empty($imageUrl) && !empty($row['go2rtc_link'])) {
        $imageUrl = $row['go2rtc_link'];
    }
    $code = !empty($row['account_no']) ? $row['account_no'] : ($row['cam_id'] ?? '');
    return [
        'asset_code' => $code,
        'id' => $code,
        'account_no' => $code,
        'asset_name' => $row['eng_name'] ?? '',
        'eng_name' => $row['eng_name'] ?? '',
        'holder' => $row['thai_name'] ?? '',
        'thai_name' => $row['thai_name'] ?? '',
        'type' => $row['type'] ?? 'Other',
        'brand' => $row['brand'] ?? '',
        'model' => $row['model'] ?? '',
        'serial' => $row['serial'] ?? '',
        'department' => $row['department'] ?? '',
        'ip' => $row['ip'] ?? '',
        'mac_address' => $row['mac_address'] ?? '',
        'status' => $row['status'] ?? 'Active',
        'image' => $imageUrl,
        'image_url' => $imageUrl,
        'go2rtc_link' => $imageUrl,
        'map_id' => (int)$row['map_id'],
        'x' => $row['x'] !== null ? (float)$row['x'] : null,
        'y' => $row['y'] !== null ? (float)$row['y'] : null,
        'in/out' => $row['in_out'] ?? '',
        'in_out' => $row['in_out'] ?? '',
        'recorder' => $row['recorder'] ?? '',
        'recorder_ch' => $row['recorder_ch'] ?? ''
    ];
}

function formatMapRow($row) {
    return [
        '_db_id' => (int)$row['id'],
        'map_id' => (int)$row['id'],
        'map_name' => $row['map_name'],
        'map_url' => $row['map_url'],
        'map_pic' => $row['map_url']
    ];
}

function formatUserRow($row) {
    return [
        'Name' => $row['name'],
        'password' => $row['password'],
        'department' => $row['department'],
        'camera_user' => $row['camera_user'],
        'map_user' => $row['map_user'] ?? ''
    ];
}

function formatDepartmentRow($row) {
    return [
        'department' => $row['department']
    ];
}

function getActualTableName($table) {
    if ($table === 'camera' || $table === 'cameras' || $table === 'device' || $table === 'devices') return 'cameras';
    if ($table === 'map' || $table === 'maps') return 'maps';
    if ($table === 'user' || $table === 'users') return 'users';
    if ($table === 'department' || $table === 'departments') return 'departments';
    return null;
}

$actualTable = getActualTableName($table);
if (!$actualTable) {
    echo json_encode(["error" => "Invalid table"]);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    if (($table === 'user' || $table === 'users') && isset($_GET['name']) && isset($_GET['password'])) {
        $stmt = $pdo->prepare("SELECT * FROM users WHERE name = ? AND password = ?");
        $stmt->execute([$_GET['name'], $_GET['password']]);
        $rows = $stmt->fetchAll();
        $records = [];
        foreach ($rows as $row) {
            $records[] = ["id" => (int)$row['id'], "fields" => formatUserRow($row)];
        }
        echo json_encode(["records" => $records]);
        exit;
    }

    $orderBy = "";
    if (($table === 'map' || $table === 'maps') && isset($_GET['sort']) && $_GET['sort'] === 'map_id') {
        $orderBy = " ORDER BY id ASC";
    }

    $stmt = $pdo->query("SELECT * FROM {$actualTable}{$orderBy}");
    $rows = $stmt->fetchAll();
    
    $records = [];
    foreach ($rows as $row) {
        if ($actualTable === 'cameras') $fields = formatCameraRow($row);
        elseif ($actualTable === 'maps') $fields = formatMapRow($row);
        elseif ($actualTable === 'users') $fields = formatUserRow($row);
        elseif ($actualTable === 'departments') $fields = formatDepartmentRow($row);
        
        $records[] = [
            "id" => (int)$row['id'],
            "fields" => $fields
        ];
    }
    
    echo json_encode(["records" => $records]);
    exit;
}

if ($method === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $fields = $input['fields'] ?? [];
    
    if (empty($fields)) {
        echo json_encode(["error" => "No fields provided"]);
        exit;
    }
    
    $cols = [];
    $vals = [];
    $params = [];
    
    if ($actualTable === 'cameras') {
        if (isset($fields['asset_code'])) {
            $fields['account_no'] = $fields['asset_code'];
            $fields['id'] = $fields['asset_code'];
        } elseif (isset($fields['id']) && !isset($fields['account_no'])) {
            $fields['account_no'] = $fields['id'];
        } elseif (isset($fields['account_no']) && !isset($fields['id'])) {
            $fields['id'] = $fields['account_no'];
        } elseif (isset($fields['id']) && isset($fields['account_no'])) {
            $fields['account_no'] = $fields['id'];
        }
        if (isset($fields['asset_name']) && !isset($fields['eng_name'])) {
            $fields['eng_name'] = $fields['asset_name'];
        }
        if (isset($fields['holder']) && !isset($fields['thai_name'])) {
            $fields['thai_name'] = $fields['holder'];
        }
        if (isset($fields['image'])) {
            if (is_array($fields['image']) && isset($fields['image'][0]['url'])) {
                $fields['image_url'] = $fields['image'][0]['url'];
            } elseif (is_string($fields['image'])) {
                $fields['image_url'] = $fields['image'];
            }
        }
        $map = [
            'id' => 'cam_id', 'eng_name' => 'eng_name', 'thai_name' => 'thai_name',
            'type' => 'type', 'brand' => 'brand', 'model' => 'model', 'serial' => 'serial',
            'in/out' => 'in_out', 'department' => 'department', 'recorder' => 'recorder',
            'recorder_ch' => 'recorder_ch', 'ip' => 'ip', 'mac_address' => 'mac_address',
            'status' => 'status', 'account_no' => 'account_no', 'image_url' => 'image_url', 'go2rtc_link' => 'go2rtc_link',
            'map_id' => 'map_id', 'x' => 'x', 'y' => 'y'
        ];
        if (isset($fields['image_url']) && !isset($fields['go2rtc_link'])) {
            $fields['go2rtc_link'] = $fields['image_url'];
        }
        foreach ($map as $jsonKey => $dbCol) {
            if (isset($fields[$jsonKey])) {
                $cols[] = $dbCol;
                $vals[] = "?";
                $params[] = $fields[$jsonKey];
            }
        }
    } elseif ($actualTable === 'maps') {
        if (isset($fields['map_pic'])) {
            if (is_array($fields['map_pic']) && isset($fields['map_pic'][0]['url'])) {
                $fields['map_url'] = $fields['map_pic'][0]['url'];
            } elseif (is_string($fields['map_pic'])) {
                $fields['map_url'] = $fields['map_pic'];
            }
        }
        $map = ['map_name' => 'map_name', 'map_url' => 'map_url'];
        foreach ($map as $jsonKey => $dbCol) {
            if (isset($fields[$jsonKey])) {
                $cols[] = $dbCol;
                $vals[] = "?";
                $params[] = $fields[$jsonKey];
            }
        }
    } elseif ($actualTable === 'users') {
        $map = ['Name' => 'name', 'password' => 'password', 'department' => 'department', 'camera_user' => 'camera_user', 'map_user' => 'map_user'];
        foreach ($map as $jsonKey => $dbCol) {
            if (isset($fields[$jsonKey])) {
                $cols[] = $dbCol;
                $vals[] = "?";
                $params[] = $fields[$jsonKey];
            }
        }
    } elseif ($actualTable === 'departments') {
        if (isset($fields['department'])) {
            $cols[] = 'department';
            $vals[] = "?";
            $params[] = $fields['department'];
        }
    }
    
    $colStr = implode(", ", $cols);
    $valStr = implode(", ", $vals);
    
    $stmt = $pdo->prepare("INSERT INTO {$actualTable} ($colStr) VALUES ($valStr)");
    $stmt->execute($params);
    $insertId = (int)$pdo->lastInsertId();
    
    $stmt = $pdo->prepare("SELECT * FROM {$actualTable} WHERE id = ?");
    $stmt->execute([$insertId]);
    $row = $stmt->fetch();
    
    $outFields = [];
    if ($actualTable === 'cameras') $outFields = formatCameraRow($row);
    elseif ($actualTable === 'maps') $outFields = formatMapRow($row);
    elseif ($actualTable === 'users') $outFields = formatUserRow($row);
    elseif ($actualTable === 'departments') $outFields = formatDepartmentRow($row);
    
    echo json_encode(["id" => $insertId, "fields" => $outFields]);
    exit;
}

if ($method === 'PATCH') {
    $id = $_GET['id'] ?? null;
    if (!$id) {
        echo json_encode(["error" => "No id provided"]);
        exit;
    }
    
    $input = json_decode(file_get_contents('php://input'), true);
    $fields = $input['fields'] ?? [];
    
    $updates = [];
    $params = [];
    
    if ($actualTable === 'cameras') {
        if (isset($fields['asset_code'])) {
            $fields['account_no'] = $fields['asset_code'];
            $fields['id'] = $fields['asset_code'];
        } elseif (isset($fields['id']) && !isset($fields['account_no'])) {
            $fields['account_no'] = $fields['id'];
        } elseif (isset($fields['account_no']) && !isset($fields['id'])) {
            $fields['id'] = $fields['account_no'];
        } elseif (isset($fields['id']) && isset($fields['account_no'])) {
            $fields['account_no'] = $fields['id'];
        }
        if (isset($fields['asset_name']) && !isset($fields['eng_name'])) {
            $fields['eng_name'] = $fields['asset_name'];
        }
        if (isset($fields['holder']) && !isset($fields['thai_name'])) {
            $fields['thai_name'] = $fields['holder'];
        }
        if (isset($fields['image'])) {
            if (is_array($fields['image']) && isset($fields['image'][0]['url'])) {
                $fields['image_url'] = $fields['image'][0]['url'];
            } elseif (is_string($fields['image'])) {
                $fields['image_url'] = $fields['image'];
            }
        }
        $map = [
            'id' => 'cam_id', 'eng_name' => 'eng_name', 'thai_name' => 'thai_name',
            'type' => 'type', 'brand' => 'brand', 'model' => 'model', 'serial' => 'serial',
            'in/out' => 'in_out', 'department' => 'department', 'recorder' => 'recorder',
            'recorder_ch' => 'recorder_ch', 'ip' => 'ip', 'mac_address' => 'mac_address',
            'status' => 'status', 'account_no' => 'account_no', 'image_url' => 'image_url', 'go2rtc_link' => 'go2rtc_link',
            'map_id' => 'map_id', 'x' => 'x', 'y' => 'y'
        ];
        if (isset($fields['image_url']) && !isset($fields['go2rtc_link'])) {
            $fields['go2rtc_link'] = $fields['image_url'];
        }
        foreach ($map as $jsonKey => $dbCol) {
            if (isset($fields[$jsonKey])) {
                $updates[] = "$dbCol = ?";
                $params[] = $fields[$jsonKey];
            }
        }
    } elseif ($actualTable === 'maps') {
        if (isset($fields['map_pic'])) {
            if (is_array($fields['map_pic']) && isset($fields['map_pic'][0]['url'])) {
                $fields['map_url'] = $fields['map_pic'][0]['url'];
            } elseif (is_string($fields['map_pic'])) {
                $fields['map_url'] = $fields['map_pic'];
            }
        }
        $map = ['map_name' => 'map_name', 'map_url' => 'map_url'];
        foreach ($map as $jsonKey => $dbCol) {
            if (isset($fields[$jsonKey])) {
                $updates[] = "$dbCol = ?";
                $params[] = $fields[$jsonKey];
            }
        }
    } elseif ($actualTable === 'users') {
        $map = ['Name' => 'name', 'password' => 'password', 'department' => 'department', 'camera_user' => 'camera_user', 'map_user' => 'map_user'];
        foreach ($map as $jsonKey => $dbCol) {
            if (isset($fields[$jsonKey])) {
                $updates[] = "$dbCol = ?";
                $params[] = $fields[$jsonKey];
            }
        }
    } elseif ($actualTable === 'departments') {
        if (isset($fields['department'])) {
            $updates[] = "department = ?";
            $params[] = $fields['department'];
        }
    }
    
    if (!empty($updates)) {
        $params[] = $id;
        $updStr = implode(", ", $updates);
        $stmt = $pdo->prepare("UPDATE {$actualTable} SET $updStr WHERE id = ?");
        $stmt->execute($params);
    }
    
    $stmt = $pdo->prepare("SELECT * FROM {$actualTable} WHERE id = ?");
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    
    if (!$row) {
        echo json_encode(["error" => "Record not found"]);
        exit;
    }
    
    $outFields = [];
    if ($actualTable === 'cameras') $outFields = formatCameraRow($row);
    elseif ($actualTable === 'maps') $outFields = formatMapRow($row);
    elseif ($actualTable === 'users') $outFields = formatUserRow($row);
    elseif ($actualTable === 'departments') $outFields = formatDepartmentRow($row);
    
    echo json_encode(["id" => (int)$id, "fields" => $outFields]);
    exit;
}

if ($method === 'DELETE') {
    $id = $_GET['id'] ?? null;
    if (!$id) {
        echo json_encode(["error" => "No id provided"]);
        exit;
    }
    
    $stmt = $pdo->prepare("DELETE FROM {$actualTable} WHERE id = ?");
    $stmt->execute([$id]);
    
    echo json_encode(["deleted" => true, "id" => (int)$id]);
    exit;
}
