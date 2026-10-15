//! 窗口和托盘：大 Dock（main）、小 Dock（dock）、托盘菜单，以及前端用的几个窗口命令。
//! 小 Dock 显不显示、关闭时收不收到托盘这些设置存在前端，这里只照着做

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, Wry,
};

/// 前端事件：托盘菜单点了"显示 / 隐藏小 Dock"（发给小 Dock：它改设置，再按设置显示或隐藏自己）
const TOGGLE_DOCK: &str = "tray-toggle-dock";
/// 前端事件：大 Dock 切到某个页签（小 Dock 上点"可更新"时去设置页）
const NAVIGATE: &str = "navigate";
/// 前端事件：鼠标进出小 Dock 的卡片（true 是进来了）
const DOCK_HOVER: &str = "dock-hover";
/// 小 Dock 的宽度（逻辑像素），和 tauri.conf.json 里一样
const DOCK_WIDTH: f64 = 260.0;
/// 多久看一次鼠标在不在卡片上
const HOVER_POLL: Duration = Duration::from_millis(40);
/// 鼠标离开卡片多久后让小 Dock 少占内存：等收起动画放完，免得收起时卡
const MEMORY_LOW_AFTER: Duration = Duration::from_secs(3);

/// 小 Dock 卡片在窗口里的位置（逻辑像素，相对窗口内容区左上角），前端量好告诉这里
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct HitRect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Default)]
pub struct DockHit(Mutex<Option<HitRect>>);

/// 前端告诉卡片现在占哪一块（展开、收起、内容变了都会重新告诉）
#[tauri::command]
pub fn set_dock_hit(hit: State<'_, DockHit>, rect: HitRect) {
    *hit.0.lock().expect("小 Dock 卡片位置锁") = Some(rect);
}

/// 小 Dock 的悬停。窗口一直是展开后的高度（上面没用到的部分透明），悬停时不改窗口大小——改大小会闪。
/// 这里每 40ms 看一次鼠标在不在卡片上：不在就让窗口对鼠标透明（点击穿到后面的程序），
/// 在就恢复响应；进出时通知前端展开、收起。
/// 顺带管小 Dock 的内存：平时只是摆着，鼠标离开一会儿（或整个藏起来）就让 WebView2 少占内存，鼠标进来再恢复
pub fn start_dock_hover(app: AppHandle) {
    std::thread::spawn(move || {
        let mut inside: Option<bool> = None;
        // 鼠标最近一次进出卡片（或大 Dock 刚关掉）的时间
        let mut since = Instant::now();
        let mut low = false;
        let mut main_open = false;
        loop {
            std::thread::sleep(HOVER_POLL);
            let Some(w) = app.get_webview_window("dock") else {
                continue;
            };
            // 大 Dock 刚关掉：它用过的 GPU 进程这些共用进程的内存，要再整理一次才还给系统。
            // WebView2 只在切换的那一刻整理，所以先把小 Dock 切回正常、重新计时，过一会儿再切过去
            let open = app.get_webview_window("main").is_some();
            if main_open && !open && low {
                low = false;
                set_memory_low(&w, false);
                since = Instant::now();
            }
            main_open = open;
            let now = if w.is_visible().unwrap_or(false) {
                let Some(now) = card_hovered(&app, &w) else {
                    continue;
                };
                if inside != Some(now) {
                    inside = Some(now);
                    since = Instant::now();
                    let _ = w.set_ignore_cursor_events(!now);
                    let _ = app.emit_to("dock", DOCK_HOVER, now);
                }
                now
            } else {
                // 藏起来的时候不管悬停，再显示时重新判断一次；它还在后台取数，内存照样让它少占
                inside = None;
                false
            };
            // 鼠标进来马上恢复正常；离开（或藏起来）满 3 秒才让它少占内存
            let want_low = !now && (low || since.elapsed() >= MEMORY_LOW_AFTER);
            if want_low != low {
                low = want_low;
                set_memory_low(&w, low);
            }
        }
    });
}

/// 鼠标现在在不在小 Dock 的卡片上；前端还没告诉卡片在哪、或者问不到位置时是 None
fn card_hovered(app: &AppHandle, w: &WebviewWindow) -> Option<bool> {
    let rect = (*app.state::<DockHit>().0.lock().expect("小 Dock 卡片位置锁"))?;
    let (Ok(cursor), Ok(pos), Ok(scale)) =
        (w.cursor_position(), w.inner_position(), w.scale_factor())
    else {
        return None;
    };
    Some(rect_contains(
        rect,
        (cursor.x - pos.x as f64) / scale,
        (cursor.y - pos.y as f64) / scale,
    ))
}

fn rect_contains(r: HitRect, x: f64, y: f64) -> bool {
    x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h
}

/// WebView2 的"内存目标"：low 时它把这个页面闲着的内存交给系统（挪到页面文件 / 压缩内存），脚本照常跑；
/// 用户要看、要操作时调回正常。WebView2 太旧（114 以前）时什么也不做
pub fn set_memory_low(w: &WebviewWindow, low: bool) {
    #[cfg(windows)]
    let _ = w.with_webview(move |pw| {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
            ICoreWebView2_19,
        };
        use windows_core::Interface;
        let level = if low {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
        } else {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
        };
        unsafe {
            if let Ok(core) = pw.controller().CoreWebView2()
                && let Ok(core) = core.cast::<ICoreWebView2_19>()
            {
                let _ = core.SetMemoryUsageTargetLevel(level);
            }
        }
    });
}

/// 托盘菜单里的几项，留着按界面语言改文字
pub struct TrayMenu {
    open: MenuItem<Wry>,
    dock: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    // 先放中文，前端起来后按界面语言改
    let open = MenuItem::with_id(app, "open", "打开大 Dock", true, None::<&str>)?;
    let dock = MenuItem::with_id(app, "dock", "显示 / 隐藏小 Dock", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &dock, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("ccusage-ui")
        .menu(&menu)
        // 左键打开大 Dock，右键才出菜单
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main_window(app, None),
            "dock" => {
                let _ = app.emit_to("dock", TOGGLE_DOCK, ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle(), None);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    app.manage(TrayMenu { open, dock, quit });
    Ok(())
}

/// 把大 Dock 拿到最前面。大 Dock 收到托盘时整个窗口是关掉的（省内存，取账本这些常驻的事在小 Dock 里），
/// 开机自启时也没建：窗口不在就照 tauri.conf.json 里的配置新建一个。
/// tab 是要切到的页签：窗口开着就发事件让它切；新建的放在地址里（index.html?tab=settings），页面加载完自己切
pub fn show_main_window(app: &AppHandle, tab: Option<&str>) {
    // 页签名只有小写字母，别的不往地址里放
    let tab = tab.filter(|t| !t.is_empty() && t.chars().all(|c| c.is_ascii_lowercase()));
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        if let Some(tab) = tab {
            let _ = app.emit_to("main", NAVIGATE, tab);
        }
        return;
    }
    let Some(mut config) = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .cloned()
    else {
        return;
    };
    if let Some(tab) = tab {
        config.url = WebviewUrl::App(format!("index.html?tab={tab}").into());
    }
    // 配置里是隐藏的：建好再显示（窗口状态插件会在建好时恢复上次的位置和大小）
    match WebviewWindowBuilder::from_config(app, &config).and_then(|b| b.build()) {
        Ok(w) => {
            let _ = w.show();
            let _ = w.set_focus();
        }
        Err(e) => eprintln!("ccusage-ui: open main window: {e}"),
    }
}

/// 打开大 Dock；带 tab 时顺便切到那个页签。
/// 要 async：可能要新建窗口，同步命令里建窗口在 Windows 上会卡死
#[tauri::command]
pub async fn show_main(app: AppHandle, tab: Option<String>) {
    show_main_window(&app, tab.as_deref());
}

/// 显示或隐藏小 Dock；place 为 true 时（第一次显示）放到主屏幕右下角
#[tauri::command]
pub fn set_dock_visible(app: AppHandle, visible: bool, place: bool) {
    let Some(w) = app.get_webview_window("dock") else {
        return;
    };
    if !visible {
        let _ = w.hide();
        return;
    }
    if place {
        place_bottom_right(&w);
    }
    let _ = w.show();
}

/// 主屏幕右下角，任务栏上面，离边 16 像素
fn place_bottom_right(w: &WebviewWindow) {
    let (Ok(Some(monitor)), Ok(size)) = (w.primary_monitor(), w.outer_size()) else {
        return;
    };
    let area = monitor.work_area();
    let margin = (16.0 * monitor.scale_factor()).round() as i32;
    let x = area.position.x + area.size.width as i32 - size.width as i32 - margin;
    let y = area.position.y + area.size.height as i32 - size.height as i32 - margin;
    let _ = w.set_position(PhysicalPosition::new(x, y));
}

/// 小 Dock 拖动开始时窗口在哪、鼠标在哪（物理像素）。
/// 不用 Windows 自带的拖动：它不让窗口上沿拖出屏幕，而小 Dock 的窗口在卡片上面有一大块透明的，
/// 用它的话卡片永远拖不到屏幕顶上去。所以自己挪：鼠标从按下到现在挪了多少，窗口就挪多少。
/// 鼠标位置直接问系统要，不用网页里的坐标（窗口在动的时候，网页对自己在屏幕上的位置更新不及时，会越拖越偏）
#[derive(Default)]
pub struct DockDrag(Mutex<Option<(PhysicalPosition<i32>, PhysicalPosition<f64>)>>);

#[tauri::command]
pub fn dock_drag_start(window: WebviewWindow, drag: State<'_, DockDrag>) {
    *drag.0.lock().expect("小 Dock 拖动锁") =
        match (window.outer_position(), window.cursor_position()) {
            (Ok(origin), Ok(cursor)) => Some((origin, cursor)),
            _ => None,
        };
}

/// 拖动中，前端每一帧调一次
#[tauri::command]
pub fn dock_drag_move(window: WebviewWindow, drag: State<'_, DockDrag>) {
    let Some((origin, start)) = *drag.0.lock().expect("小 Dock 拖动锁") else {
        return;
    };
    let Ok(cursor) = window.cursor_position() else {
        return;
    };
    let _ = window.set_position(PhysicalPosition::new(
        origin.x + (cursor.x - start.x).round() as i32,
        origin.y + (cursor.y - start.y).round() as i32,
    ));
}

/// 小 Dock 的明细往哪边展开
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Dir {
    Up,
    Down,
}

/// 小 Dock 的布局（逻辑像素）：现在往哪边展开、卡片收起时多高、明细多高、下面趣味句多高、上下给阴影留的边
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockLayout {
    dir: Dir,
    card: f64,
    details: f64,
    quip: f64,
    pad_top: f64,
    pad_bottom: f64,
}

/// 卡片收起时在屏幕上的上沿、高度，明细高度，下面趣味句的高度，屏幕可用区域的上下沿（都是物理像素）。
/// 趣味句总是在那一行下面；明细上面放得下就往上展开（默认），放不下而下面放得下（连趣味句一起）就往下，
/// 两边都放不下还是往上
fn choose_dir(
    card_top: f64,
    card_h: f64,
    details: f64,
    below: f64,
    area_top: f64,
    area_bottom: f64,
) -> Dir {
    if card_top - details >= area_top {
        Dir::Up
    } else if card_top + card_h + below + details <= area_bottom {
        Dir::Down
    } else {
        Dir::Up
    }
}

/// 按小 Dock 现在在屏幕上的位置，定明细往哪边展开（拖到屏幕顶上时往下展开，不然会跑出屏幕）。
/// 窗口里卡片的位置跟着方向变（往上展开时卡片下面还留着趣味句的地方，往下时卡片贴顶边），
/// 换方向时把窗口挪一下，卡片在屏幕上不动
#[tauri::command]
pub fn orient_dock(window: WebviewWindow, layout: DockLayout) -> Dir {
    let current = layout.dir;
    let (Ok(scale), Ok(pos), Ok(size), Ok(Some(monitor))) = (
        window.scale_factor(),
        window.outer_position(),
        window.inner_size(),
        window.current_monitor(),
    ) else {
        return current;
    };
    let height = size.height as f64;
    let card_h = layout.card * scale;
    // 卡片（收起时那一行）上沿离窗口上沿多远
    let offset = |dir: Dir| match dir {
        Dir::Up => height - (layout.pad_bottom + layout.quip) * scale - card_h,
        Dir::Down => layout.pad_top * scale,
    };
    let card_top = pos.y as f64 + offset(current);
    let area = monitor.work_area();
    let area_top = area.position.y as f64;
    let next = choose_dir(
        card_top,
        card_h,
        layout.details * scale,
        layout.quip * scale,
        area_top,
        area_top + area.size.height as f64,
    );
    if next != current {
        let y = (card_top - offset(next)).round() as i32;
        let _ = window.set_position(PhysicalPosition::new(pos.x, y));
    }
    next
}

/// 小 Dock 的内容高度变了（5h 窗口开始或结束）：调窗口高度。往上展开时底边不动，往下展开时顶边不动（keep_top）。
/// 无边框窗口的外框比内容多一圈看不见的边：高度、宽度按内容（inner）算，底边按外框（outer）算，
/// 混着用的话每调一次就差一圈边，越调越歪
#[tauri::command]
pub fn fit_dock(window: WebviewWindow, height: f64, keep_top: bool) {
    let (Ok(scale), Ok(pos), Ok(outer), Ok(inner)) = (
        window.scale_factor(),
        window.outer_position(),
        window.outer_size(),
        window.inner_size(),
    ) else {
        return;
    };
    // 宽度固定（和 tauri.conf.json 里一样），顺便纠正窗口状态插件记下的不对的宽度
    let width = (DOCK_WIDTH * scale).round() as u32;
    let target = (height * scale).round() as u32;
    if target == inner.height && width == inner.width {
        return;
    }
    let _ = window.set_size(PhysicalSize::new(width, target));
    if keep_top {
        return;
    }
    let border = outer.height.saturating_sub(inner.height);
    let bottom = pos.y + outer.height as i32;
    let _ = window.set_position(PhysicalPosition::new(
        pos.x,
        bottom - (target + border) as i32,
    ));
}

/// 托盘菜单的文字，跟着界面语言
#[tauri::command]
pub fn set_tray_labels(menu: State<'_, TrayMenu>, open: String, dock: String, quit: String) {
    let _ = menu.open.set_text(open);
    let _ = menu.dock.set_text(dock);
    let _ = menu.quit.set_text(quit);
}

/// 真正退出（关掉大 Dock、小 Dock 和托盘）
#[tauri::command]
pub fn app_quit(app: AppHandle) {
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hit_rect_edges() {
        let r = HitRect {
            x: 12.0,
            y: 100.0,
            w: 236.0,
            h: 62.0,
        };
        assert!(rect_contains(r, 12.0, 100.0));
        assert!(rect_contains(r, 130.0, 150.0));
        // 右边、下边不算在里面，透明的留边也不算
        assert!(!rect_contains(r, 248.0, 150.0));
        assert!(!rect_contains(r, 130.0, 162.0));
        assert!(!rect_contains(r, 5.0, 150.0));
        assert!(!rect_contains(r, 130.0, 60.0));
    }

    #[test]
    fn expands_up_unless_no_room() {
        // 屏幕可用区域 0～1000，卡片高 60，明细高 250，下面趣味句高 90
        assert_eq!(choose_dir(700.0, 60.0, 250.0, 90.0, 0.0, 1000.0), Dir::Up);
        // 卡片靠近屏幕顶上：往上放不下，往下展开
        assert_eq!(choose_dir(100.0, 60.0, 250.0, 90.0, 0.0, 1000.0), Dir::Down);
        // 屏幕太矮，两边都放不下：还是往上
        assert_eq!(choose_dir(100.0, 60.0, 250.0, 90.0, 0.0, 300.0), Dir::Up);
        // 往下要连趣味句一起放得下：100 + 60 + 90 + 250 = 500 > 450
        assert_eq!(choose_dir(100.0, 60.0, 250.0, 90.0, 0.0, 450.0), Dir::Up);
    }
}
