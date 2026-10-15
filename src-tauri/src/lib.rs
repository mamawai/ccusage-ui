mod archive;
mod ccswitch;
mod ccusage;
mod coldfact;
mod limits;
mod plans;
mod shell;
mod speed;
mod usage_watch;

use std::path::{Path, PathBuf};

use tauri::{Emitter, Manager};
use tauri_plugin_window_state::StateFlags;

pub use limits::{FLAG as STATUSLINE_FLAG, UNHOOK_FLAG, statusline, unhook};

/// 开机自启时带的参数：带了就只在后台常驻（显示小 Dock），不弹大 Dock
const AUTOSTART_ARG: &str = "--autostart";

/// 和 tauri.conf.json 的 identifier 一致：Tauri 的数据目录就是 %APPDATA%\<identifier>。
/// 被 Claude Code 当状态栏运行时不启动 Tauri，只能自己拼出同一个目录，所以这里统一自己拼
const IDENTIFIER: &str = "com.ccusageui.dock";

/// 程序的数据目录：官方限额、按天存档都放这里
pub(crate) fn data_dir() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|dir| PathBuf::from(dir).join(IDENTIFIER))
}

/// 先写临时文件再改名，读的一方不会读到写了一半的文件。几个进程同时写时临时文件名按进程分开。
/// 目标是符号链接（比如 settings.json 链到 dotfiles 仓库）时写到它指向的文件，链接本身不动；
/// 改名失败时把临时文件删掉，不留垃圾
pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let target = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let tmp = target.with_extension(format!("{}.tmp", std::process::id()));
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, &target).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 必须第一个注册：再双击打开时，不开第二个，而是把已经开着的大 Dock 拿到前面
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            shell::show_main_window(app, None);
        }))
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .arg(AUTOSTART_ARG)
                .build(),
        )
        // 记住两个窗口的位置和大小；显不显示由设置决定，不记
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .build(),
        )
        .manage(ccusage::CcusageState::default())
        .manage(shell::DockHit::default())
        .manage(shell::DockDrag::default())
        .setup(|app| {
            // 日志一有变化就通知前端重新取数据
            usage_watch::start(app.handle().clone());
            limits::watch(app.handle().clone());
            shell::create_tray(app.handle())?;
            shell::start_dock_hover(app.handle().clone());
            // 大 Dock 在配置里不随启动建（要用时才建，关到托盘就关掉，省内存）：不是开机自启就建出来显示
            if !std::env::args().any(|arg| arg == AUTOSTART_ARG) {
                shell::show_main_window(app.handle(), None);
            }
            Ok(())
        })
        // 小 Dock 拿到焦点时按 Alt+F4 之类会关窗口：不真的关（它一直开着，取账本这些常驻的事都在它里面），
        // 只藏起来，再让它自己把"显示小 Dock"的设置改成关，托盘、设置页都能再打开
        .on_window_event(|window, event| match (window.label(), event) {
            ("dock", tauri::WindowEvent::CloseRequested { api, .. }) => {
                api.prevent_close();
                let _ = window.hide();
                let _ = window.emit_to("dock", "dock-closed", ());
            }
            // 大 Dock 切到后台时让 WebView2 少占内存，回到前台再恢复
            ("main", tauri::WindowEvent::Focused(focused)) => {
                if let Some(w) = window.app_handle().get_webview_window("main") {
                    shell::set_memory_low(&w, !focused);
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            ccusage::ccusage_locate,
            ccusage::ccusage_report,
            ccusage::ccusage_managers,
            ccusage::ccusage_install,
            ccusage::ccusage_install_bundled,
            ccusage::ccusage_rollback_bundled,
            limits::limits_read,
            limits::limits_history,
            plans::non_subscription_sessions,
            limits::limits_hook,
            speed::speed_read,
            archive::archive_read,
            archive::archive_write,
            archive::claude_log_days,
            ccswitch::ccswitch_detect,
            ccswitch::ccswitch_read,
            coldfact::cold_fact,
            shell::show_main,
            shell::set_dock_visible,
            shell::fit_dock,
            shell::orient_dock,
            shell::set_dock_hit,
            shell::dock_drag_start,
            shell::dock_drag_move,
            shell::set_tray_labels,
            shell::app_quit
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
