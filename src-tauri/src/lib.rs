// KOVA Design Lab para macOS: la misma app web dentro de WKWebView, con diálogos y archivos nativos.
// Toda la lógica vive en el frontend; aquí solo se registran los plugins.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .run(tauri::generate_context!())
    .expect("no se pudo iniciar KOVA Design Lab");
}
