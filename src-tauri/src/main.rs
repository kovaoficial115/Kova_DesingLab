// Evita una consola adicional en Windows en release; en macOS no tiene efecto.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  kova_lib::run();
}
