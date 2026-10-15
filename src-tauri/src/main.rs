// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    match std::env::args().nth(1).as_deref() {
        // Claude Code 把我们当状态栏命令运行：只读官方限额、转给原来的状态栏，不开窗口（见 limits.rs）
        Some(ccusage_ui_lib::STATUSLINE_FLAG) => std::process::exit(ccusage_ui_lib::statusline()),
        // 卸载前安装包调用：把 Claude Code 的状态栏恢复原样（见 windows/hooks.nsh）
        Some(ccusage_ui_lib::UNHOOK_FLAG) => std::process::exit(ccusage_ui_lib::unhook()),
        _ => ccusage_ui_lib::run(),
    }
}
