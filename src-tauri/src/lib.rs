// KOVA Design Lab para macOS: la misma app web dentro de WKWebView, con diálogos y archivos nativos.
// Toda la lógica vive en el frontend; aquí solo se registran los plugins y se crea la ventana.

use tauri::webview::NewWindowResponse;
use tauri::WebviewWindowBuilder;

/// Abre una dirección http(s) en el navegador predeterminado de macOS.
fn open_external(url: &tauri::Url) {
  if matches!(url.scheme(), "http" | "https" | "mailto") {
    let _ = std::process::Command::new("/usr/bin/open").arg(url.as_str()).spawn();
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .setup(|app| {
      // la ventana se crea aquí (create: false en tauri.conf.json) para que los enlaces con
      // target="_blank" (fuentes, licencias de modelos) se abran en el navegador y no en la app
      let config = app.config().app.windows.iter().find(|w| w.label == "main").cloned().expect("falta la ventana main");
      WebviewWindowBuilder::from_config(app.handle(), &config)?
        .on_new_window(|url, _features| {
          open_external(&url);
          NewWindowResponse::Deny
        })
        .build()?;
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("no se pudo iniciar KOVA Design Lab");
}
