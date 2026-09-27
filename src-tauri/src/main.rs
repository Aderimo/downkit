// DownKit — © 2026 aderimo — MIT — https://github.com/Aderimo/downkit

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    downkit_lib::run()
}
