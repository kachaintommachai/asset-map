<?php
$localConfig = __DIR__ . '/airtable.local.php';
if (file_exists($localConfig)) {
    $cfg = require $localConfig;
    $token = $cfg['token'] ?? '';
    $baseId = $cfg['base_id'] ?? '';
} else {
    $token = getenv('AIRTABLE_TOKEN') ?: 'YOUR_AIRTABLE_TOKEN';
    $baseId = getenv('AIRTABLE_BASE_ID') ?: 'YOUR_AIRTABLE_BASE_ID';
}

$headers = [
    "Authorization: Bearer $token",
];

function fetchAirtable($table) {
    global $baseId, $headers;
    $url = "https://api.airtable.com/v0/$baseId/" . rawurlencode($table);
    $records = [];
    $offset = '';
    
    do {
        $pageUrl = $url;
        if ($offset) {
            $pageUrl .= '?offset=' . $offset;
        }
        
        $ch = curl_init($pageUrl);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        $response = curl_exec($ch);
        curl_close($ch);
        
        $data = json_decode($response, true);
        if (isset($data['records'])) {
            $records = array_merge($records, $data['records']);
        }
        $offset = isset($data['offset']) ? $data['offset'] : null;
    } while ($offset);
    
    return $records;
}

@mkdir('asset/maps', 0777, true);

$sqlFile = fopen('import_data.sql', 'w');
fwrite($sqlFile, "USE cctv_monitor;\n\n");

function esc($str) {
    if ($str === null) return 'NULL';
    $str = str_replace(['\\', "\0", "\n", "\r", "'", '"', "\x1a"], ['\\\\', '\\0', '\\n', '\\r', "\\'", '\\"', '\\Z'], $str);
    return "'" . $str . "'";
}

echo "Fetching departments...\n";
$depts = fetchAirtable('department');
foreach ($depts as $r) {
    $f = $r['fields'];
    if (isset($f['department'])) {
        fwrite($sqlFile, "INSERT IGNORE INTO departments (department) VALUES (" . esc($f['department']) . ");\n");
    }
}

echo "Fetching maps...\n";
$maps = fetchAirtable('map');
foreach ($maps as $r) {
    $f = $r['fields'];
    $id = isset($f['map_id']) ? intval($f['map_id']) : 'NULL';
    $name = isset($f['map_name']) ? esc($f['map_name']) : 'NULL';
    $urlStr = 'NULL';
    $mapAttach = !empty($f['map_pic']) ? $f['map_pic'] : (!empty($f['map_url']) ? $f['map_url'] : null);
    if (!empty($mapAttach) && is_array($mapAttach) && isset($mapAttach[0]['url'])) {
        $attach = $mapAttach[0];
        $attachUrl = $attach['url'];
        $baseName = basename(parse_url($attachUrl, PHP_URL_PATH));
        if (!pathinfo($baseName, PATHINFO_EXTENSION)) {
            $baseName .= '.png';
        }
        $filename = 'asset/maps/' . $baseName;
        if (!file_exists($filename)) {
            echo "Downloading map $filename...\n";
            file_put_contents($filename, file_get_contents($attachUrl));
        }
        $urlStr = esc($filename);
    }
    
    fwrite($sqlFile, "INSERT INTO maps (id, map_name, map_url) VALUES ($id, $name, $urlStr) ON DUPLICATE KEY UPDATE map_name=VALUES(map_name), map_url=VALUES(map_url);\n");
}

echo "Fetching users...\n";
$users = fetchAirtable('user');
foreach ($users as $r) {
    $f = $r['fields'];
    $name = isset($f['Name']) ? esc($f['Name']) : 'NULL';
    $pass = isset($f['password']) ? esc($f['password']) : 'NULL';
    $dept = isset($f['department']) ? esc($f['department']) : 'NULL';
    $camUser = isset($f['camera_user']) ? esc($f['camera_user']) : 'NULL';
    
    fwrite($sqlFile, "INSERT IGNORE INTO users (name, password, department, camera_user) VALUES ($name, $pass, $dept, $camUser);\n");
}

echo "Fetching devices...\n";
$devices = fetchAirtable('device');
if (empty($devices)) {
    echo "Table 'device' not found or empty, falling back to 'camera'...\n";
    $devices = fetchAirtable('camera');
}
foreach ($devices as $r) {
    $f = $r['fields'];
    $cam_id = isset($f['asset_code']) ? esc($f['asset_code']) : (isset($f['id']) ? esc($f['id']) : (isset($f['account_no']) ? esc($f['account_no']) : 'NULL'));
    $eng = isset($f['asset_name']) ? esc($f['asset_name']) : (isset($f['eng_name']) ? esc($f['eng_name']) : 'NULL');
    $thai = isset($f['holder']) ? esc($f['holder']) : (isset($f['thai_name']) ? esc($f['thai_name']) : 'NULL');
    $type = isset($f['type']) ? esc($f['type']) : esc('Other');
    $brand = isset($f['brand']) ? esc($f['brand']) : 'NULL';
    $model = isset($f['model']) ? esc($f['model']) : 'NULL';
    $serial = isset($f['serial']) ? esc($f['serial']) : 'NULL';
    $in_out = isset($f['in/out']) ? esc($f['in/out']) : 'NULL';
    $dept = isset($f['department']) ? esc($f['department']) : 'NULL';
    $rec = isset($f['recorder']) ? esc($f['recorder']) : 'NULL';
    $rec_ch = isset($f['recorder_ch']) ? esc($f['recorder_ch']) : 'NULL';
    $ip = isset($f['ip']) ? esc($f['ip']) : 'NULL';
    $mac = isset($f['mac_address']) ? esc($f['mac_address']) : 'NULL';
    $status = isset($f['status']) ? esc($f['status']) : esc('Active');
    $imgUrlStr = 'NULL';
    if (!empty($f['image']) && is_array($f['image']) && isset($f['image'][0]['url'])) {
        @mkdir('asset/devices', 0777, true);
        $attach = $f['image'][0];
        $attachUrl = $attach['url'];
        $baseName = basename(parse_url($attachUrl, PHP_URL_PATH));
        if (!pathinfo($baseName, PATHINFO_EXTENSION)) {
            $baseName .= '.png';
        }
        $filename = 'asset/devices/' . $baseName;
        if (!file_exists($filename)) {
            echo "Downloading device image $filename...\n";
            file_put_contents($filename, file_get_contents($attachUrl));
        }
        $imgUrlStr = esc($filename);
    } elseif (!empty($f['image_url'])) {
        $imgUrlStr = esc($f['image_url']);
    }

    $go2rtc = isset($f['go2rtc_link']) ? esc($f['go2rtc_link']) : $imgUrlStr;
    $map_id = isset($f['map_id']) ? intval($f['map_id']) : 1;
    $x = isset($f['x']) ? floatval($f['x']) : 'NULL';
    $y = isset($f['y']) ? floatval($f['y']) : 'NULL';
    
    fwrite($sqlFile, "INSERT INTO cameras (cam_id, account_no, eng_name, thai_name, type, brand, model, serial, in_out, department, recorder, recorder_ch, ip, mac_address, status, go2rtc_link, image_url, map_id, x, y) VALUES ($cam_id, $cam_id, $eng, $thai, $type, $brand, $model, $serial, $in_out, $dept, $rec, $rec_ch, $ip, $mac, $status, $go2rtc, $imgUrlStr, $map_id, $x, $y);\n");
}

fclose($sqlFile);
echo "Export complete! SQL saved to import_data.sql\n";
