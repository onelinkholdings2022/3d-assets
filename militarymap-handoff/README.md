# MilitaryMap — GLB handoff

Bản 3D của component Framer `MilitaryMap` (Globe2.tsx), bake sẵn theo config
trên canvas: ocean `#000000`, land `#383838`, borders `#5E5E5E`, grid
`#5B636A` @ 0.18, stars/atmosphere tắt, marker labels tắt.

## Files

| File | Nội dung |
| --- | --- |
| `militarymap.glb` | Model tự chứa: sphere + texture bản đồ 4096×2048 (kèm chấm đảo Hoàng Sa / Trường Sa) + 3 marker `#22C55E`: China (35.86, 104.20), Vietnam (16.05, 108.20), Hong Kong (22.32, 114.17). Mở được ở mọi trình xem glTF. |
| `militarymap-viewer.html` | Viewer web: auto-rotate 5°/s, drag xoay sens 0.4 (kẹp ±85°), nghỉ 1.2s sau khi thả chuột, default view Asia, đèn mô phỏng Globe Shadow. |
| `export-militarymap.mjs` | Script tạo lại GLB — `node export-militarymap.mjs` (cần `three` + `canvas` trong node_modules, chạy từ thư mục gốc dự án hoặc copy node_modules). Config cứng ở đầu file. |
| `militarymap-texture-debug.png` | Bản texture đã bake, để kiểm tra nhanh. |

## Xem thử

```sh
cd militarymap-handoff
python3 -m http.server 8000
# mở http://localhost:8000/militarymap-viewer.html
```

Không mở viewer bằng `file://` — GLB fetch qua HTTP nên cần một server tĩnh.

## Không nằm trong GLB

Tooltip hover tên nước và hover highlight cần raycast per-country (mỗi nước
một mesh riêng) — GLB hiện bake cả bản đồ thành 1 texture nên không có.
