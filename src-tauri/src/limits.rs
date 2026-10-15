//! 官方的 5 小时 / 7 天用量限额。
//!
//! Anthropic 不公开具体额度，ccusage 只能拿历史最高窗口去估，和官方对不上。准的数只有 Claude Code 自己有：
//! 它每次刷新状态栏，都会把 rate_limits（用了百分之几、几点重置）从 stdin 传给状态栏命令（只有 Pro / Max 订阅有）。
//! 所以把 Claude Code 的状态栏命令换成我们自己（ccusage-ui.exe --ccusage-ui-statusline）：
//! 读到的限额存进文件，再照原样运行用户原来的状态栏命令、把它的输出交回去，终端里看到的状态栏不变。
//! 同一份数据顺便算生成速度（见 speed.rs）。
//!
//! 文件都放在程序的数据目录（%APPDATA%\com.ccusageui.dock）：
//! - official-limits.json：最近一次读到的限额，大 Dock、小 Dock 读它
//! - limits-history.json：过去几轮 7 天窗口结束时的百分比（换轮时由状态栏这边记下），5h 窗口页估每一轮的额度用
//! - statusline-hook.json：接入前用户原来的 statusLine 设置，断开时原样放回。
//!   在 Claude Code 的配置目录里另存一份（ccusage-ui-statusline.json）：卸载时勾了"删除应用数据"也找得回来
//! - claude-settings.backup.json：接入时 Claude Code 的 settings.json 备份
//!
//! 卸载前安装包会运行 `ccusage-ui.exe --ccusage-ui-unhook`（见 windows/hooks.nsh），先把状态栏恢复原样，
//! 不然 settings.json 里的命令指向一个已经删掉的 exe，Claude Code 的状态栏就空了

use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter};

use crate::{data_dir, write_atomic};

/// Claude Code 运行我们当状态栏时带的参数
pub const FLAG: &str = "--ccusage-ui-statusline";
/// 卸载前安装包运行我们时带的参数：把状态栏恢复原样
pub const UNHOOK_FLAG: &str = "--ccusage-ui-unhook";
/// 状态栏存的数据（限额、生成速度）变了，通知前端
pub const EVENT: &str = "statusline-changed";

const LIMITS_FILE: &str = "official-limits.json";
/// 过去几轮 7 天窗口结束时的百分比
const HISTORY_FILE: &str = "limits-history.json";
/// 历史记多少轮（大半年）
const HISTORY_KEEP: usize = 30;
const HOOK_FILE: &str = "statusline-hook.json";
/// 原来的 statusLine 在 Claude Code 配置目录里另存的那份
const HOOK_COPY: &str = "ccusage-ui-statusline.json";
const BACKUP_FILE: &str = "claude-settings.backup.json";

/// 一个限额窗口
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    /// 用了百分之几，0–100
    pub used_percentage: f64,
    /// 几点重置，Unix 秒
    pub resets_at: i64,
}

/// 最近一次读到的官方限额；哪个窗口从没读到过就是 None。过了重置时间的窗口也留着，由前端判断（显示"已重置"）
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Limits {
    pub five_hour: Option<Window>,
    pub seven_day: Option<Window>,
}

// ---------- 被 Claude Code 当状态栏运行 ----------

/// 状态栏入口：读 stdin 里的会话数据，存下限额，再跑用户原来的状态栏命令。返回退出码
pub fn statusline() -> i32 {
    let mut input = Vec::new();
    if io::stdin().read_to_end(&mut input).is_err() {
        return 1;
    }
    let dir = data_dir();
    let json = serde_json::from_slice::<Value>(&input).ok();
    // 有回复却没带限额的会话记成非订阅（API key、中转），估订阅额度时把它们剔除（见 plans.rs）
    if let Some(json) = &json {
        crate::plans::record(json, limits_from(json).is_some());
    }
    if let (Some(dir), Some(json)) = (&dir, &json)
        && let Some(fresh) = limits_from(json)
    {
        // 这次没给的窗口沿用原来存的：中转 / API 会话不带限额，不能把订阅会话读到的清掉；
        // 刚过重置时间时 Claude Code 也会先不给，留着让前端显示"已重置"。存不下也不能影响状态栏显示
        let old = read_limits(dir);
        record_finished_week(dir, old.as_ref(), &fresh);
        let _ = save(dir, &merge(old, fresh));
    }
    // 顺便记生成速度（见 speed.rs）
    if let Some(json) = &json {
        crate::speed::record(json);
    }

    let claude_dir = home_dir().map(|home| claude_dir(&home));
    match dir
        .as_deref()
        .and_then(|dir| original_command(dir, claude_dir.as_deref()))
    {
        Some(command) => match run_original(&command, input) {
            Ok(out) => {
                let _ = io::stdout().write_all(&out.stdout);
                let _ = io::stderr().write_all(&out.stderr);
                out.status.code().unwrap_or(1)
            }
            Err(e) => {
                eprintln!("ccusage-ui: {e}");
                1
            }
        },
        // 用户原来没有状态栏：显示一行限额，比空着有用
        None => {
            let line = json
                .as_ref()
                .and_then(limits_from)
                .map(|l| summary(&l))
                .unwrap_or_default();
            println!("{line}");
            0
        }
    }
}

/// 从状态栏输入里取限额；一个窗口都没有就是 None（不是订阅、还没收到回复、或者刚过重置时间），原来存的不动
fn limits_from(input: &Value) -> Option<Limits> {
    let window = |key: &str| input.get("rate_limits")?.get(key).and_then(parse_window);
    let limits = Limits {
        five_hour: window("five_hour"),
        seven_day: window("seven_day"),
    };
    (limits.five_hour.is_some() || limits.seven_day.is_some()).then_some(limits)
}

/// 新读到的窗口替换旧的，没读到的窗口留着旧的
fn merge(old: Option<Limits>, fresh: Limits) -> Limits {
    let old = old.unwrap_or_default();
    Limits {
        five_hour: fresh.five_hour.or(old.five_hour),
        seven_day: fresh.seven_day.or(old.seven_day),
    }
}

fn read_limits(dir: &Path) -> Option<Limits> {
    serde_json::from_str(&fs::read_to_string(dir.join(LIMITS_FILE)).ok()?).ok()
}

/// 过去几轮 7 天窗口结束时的百分比，按重置时间从早到晚
fn read_history(dir: &Path) -> Vec<Window> {
    fs::read_to_string(dir.join(HISTORY_FILE))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// 7 天窗口进了新的一轮（重置时间往后跳了一天以上）：把上一轮最后读到的百分比记进历史，
/// 5h 窗口页估"每一轮用满约多少钱"要用。同一轮的重置时间偶尔差几秒，不算换轮
fn record_finished_week(dir: &Path, old: Option<&Limits>, fresh: &Limits) {
    let (Some(prev), Some(now)) = (
        old.and_then(|l| l.seven_day.as_ref()),
        fresh.seven_day.as_ref(),
    ) else {
        return;
    };
    if now.resets_at - prev.resets_at < 86_400 {
        return;
    }
    let mut history = read_history(dir);
    if history
        .iter()
        .any(|w| (w.resets_at - prev.resets_at).abs() < 86_400)
    {
        return;
    }
    history.push(prev.clone());
    history.sort_by_key(|w| w.resets_at);
    let keep = &history[history.len().saturating_sub(HISTORY_KEEP)..];
    if let Ok(text) = serde_json::to_string(keep) {
        let _ = write_atomic(&dir.join(HISTORY_FILE), text.as_bytes());
    }
}

fn parse_window(v: &Value) -> Option<Window> {
    Some(Window {
        used_percentage: v.get("used_percentage")?.as_f64()?,
        resets_at: v.get("resets_at")?.as_f64()?.round() as i64,
    })
}

/// 没有原来的状态栏时显示的那一行，比如 "5h 23% · 7d 41%"
fn summary(limits: &Limits) -> String {
    [("5h", &limits.five_hour), ("7d", &limits.seven_day)]
        .iter()
        .filter_map(|(name, w)| {
            w.as_ref()
                .map(|w| format!("{name} {:.0}%", w.used_percentage))
        })
        .collect::<Vec<_>>()
        .join(" · ")
}

/// 内容没变就不写：状态栏每条回复都会刷新，不必每次都碰文件（也免得大 Dock、小 Dock 白白重读）
fn save(dir: &Path, limits: &Limits) -> io::Result<()> {
    let path = dir.join(LIMITS_FILE);
    let text = serde_json::to_string(limits)?;
    if fs::read_to_string(&path).is_ok_and(|old| old == text) {
        return Ok(());
    }
    fs::create_dir_all(dir)?;
    write_atomic(&path, text.as_bytes())
}

/// 用户主目录。被 Claude Code 当状态栏运行、被卸载程序调用时都没有 Tauri，直接看环境变量
pub(crate) fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

/// 接入前用户原来的 statusLine。存在两处：数据目录、Claude Code 配置目录（数据目录被删了也还在），先看数据目录。
/// 原来就没有状态栏时是 None
fn saved_line(dir: &Path, claude_dir: Option<&Path>) -> Option<Value> {
    [
        Some(dir.join(HOOK_FILE)),
        claude_dir.map(|d| d.join(HOOK_COPY)),
    ]
    .into_iter()
    .flatten()
    .find_map(|path| serde_json::from_str::<Value>(&fs::read_to_string(path).ok()?).ok())
    .and_then(|saved| saved.get("statusLine").cloned())
    .filter(|line| !line.is_null())
}

/// 接入前用户原来的状态栏命令
fn original_command(dir: &Path, claude_dir: Option<&Path>) -> Option<String> {
    let line = saved_line(dir, claude_dir)?;
    let command = line.get("command")?.as_str()?.trim();
    (!command.is_empty()).then(|| command.to_string())
}

/// 和 Claude Code 一样运行原来的命令：有 Git Bash 用 Git Bash，没有用 PowerShell。stdin 原样喂进去
fn run_original(command: &str, input: Vec<u8>) -> io::Result<std::process::Output> {
    let mut cmd = match git_bash() {
        Some(bash) => {
            let mut c = Command::new(bash);
            c.arg("-c").arg(command);
            c
        }
        None => {
            let mut c = Command::new("powershell.exe");
            c.args(["-NoProfile", "-Command", command]);
            c
        }
    };
    no_window(&mut cmd);
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    // 另开线程写 stdin，同时这边读输出：两边都不会因为管道满了卡住
    let mut stdin = child.stdin.take().expect("stdin 是 piped");
    let writer = std::thread::spawn(move || stdin.write_all(&input));
    let out = child.wait_with_output()?;
    let _ = writer.join();
    Ok(out)
}

/// 照 Claude Code 在 Windows 上找 Git Bash 的顺序：先看 CLAUDE_CODE_GIT_BASH_PATH（得是 bash.exe 或 sh.exe），
/// 再看 Git 的默认安装位置，最后从 PATH 里的 git.exe 往上找 <Git>\bin\bash.exe。顺序不一样的话，
/// 我们可能用 PowerShell 去跑一条 bash 写法的原命令，状态栏就坏了
fn git_bash() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("CLAUDE_CODE_GIT_BASH_PATH").map(PathBuf::from)
        && path.is_file()
        && path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.eq_ignore_ascii_case("bash.exe") || n.eq_ignore_ascii_case("sh.exe"))
    {
        return Some(path);
    }
    for var in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(root) = std::env::var_os(var) {
            let bash = PathBuf::from(root).join("Git").join("bin").join("bash.exe");
            if bash.is_file() {
                return Some(bash);
            }
        }
    }
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        if !dir.join("git.exe").is_file() {
            continue;
        }
        // git.exe 在 <Git>\cmd、<Git>\bin 或 <Git>\mingw64\bin 里
        for root in dir.ancestors().skip(1).take(2) {
            let bash = root.join("bin").join("bash.exe");
            if bash.is_file() {
                return Some(bash);
            }
        }
    }
    None
}

#[cfg_attr(not(windows), allow(unused_variables))]
fn no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

// ---------- 程序里：读限额、接入 / 断开 ----------

/// 最近一次读到的限额；还没读到过就是 None。async：读文件放到后台线程，不占界面的主线程
#[tauri::command]
pub async fn limits_read() -> Option<Limits> {
    read_limits(&data_dir()?)
}

/// 过去几轮 7 天窗口结束时的百分比，按重置时间从早到晚；没有就是空的
#[tauri::command]
pub async fn limits_history() -> Vec<Window> {
    data_dir().map(|dir| read_history(&dir)).unwrap_or_default()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookStatus {
    /// Claude Code 的状态栏现在是不是接到了我们这里
    connected: bool,
    /// 用户原来的状态栏命令（接入后由我们代为运行）；原来没有就是 None
    original: Option<String>,
}

/// 两个窗口（小 Dock 常驻跟着设置接、大 Dock 打开时拿状态给设置页看）可能同时来接，排队一个个改 settings.json
static HOOKING: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// 接入或断开 Claude Code 的状态栏，让它和设置一致。启动时也调一次：程序换了位置会把命令里的路径改过来
#[tauri::command]
pub async fn limits_hook(enabled: bool) -> Result<HookStatus, String> {
    let _queue = HOOKING.lock().unwrap_or_else(|e| e.into_inner());
    let home = home_dir().ok_or("USERPROFILE")?;
    let dir = data_dir().ok_or("APPDATA")?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    hook(&claude_dir(&home), &dir, &exe, enabled).map_err(|e| e.to_string())
}

/// 卸载前安装包调用：把 Claude Code 的状态栏恢复原样。返回退出码
pub fn unhook() -> i32 {
    let (Some(home), Some(dir)) = (home_dir(), data_dir()) else {
        return 1;
    };
    // 断开时用不到 exe 的路径
    match hook(&claude_dir(&home), &dir, Path::new(""), false) {
        Ok(_) => 0,
        Err(e) => {
            eprintln!("ccusage-ui: {e}");
            1
        }
    }
}

/// Claude Code 的配置目录：设了 CLAUDE_CONFIG_DIR 就是它，否则是 ~/.claude
pub(crate) fn claude_dir(home: &Path) -> PathBuf {
    match std::env::var("CLAUDE_CONFIG_DIR") {
        Ok(dir) if !dir.trim().is_empty() => PathBuf::from(dir.trim()),
        _ => home.join(".claude"),
    }
}

/// claude：Claude Code 的配置目录（settings.json 在它下面）；dir：程序的数据目录
fn hook(claude: &Path, dir: &Path, exe: &Path, enabled: bool) -> io::Result<HookStatus> {
    let settings = claude.join("settings.json");
    let settings = settings.as_path();
    let text = match fs::read_to_string(settings) {
        Ok(text) => Some(text),
        Err(e) if e.kind() == io::ErrorKind::NotFound => None,
        Err(e) => return Err(e),
    };
    // 解析不了（用户手改坏了）就不碰，免得把整个文件覆盖掉
    let mut root: Map<String, Value> = match &text {
        Some(text) => serde_json::from_str(text).map_err(io::Error::other)?,
        None => Map::new(),
    };
    let current = root.get("statusLine").cloned();
    let ours = current
        .as_ref()
        .and_then(|s| s.get("command"))
        .and_then(Value::as_str)
        .is_some_and(|c| c.contains(FLAG));
    let hook_paths = [dir.join(HOOK_FILE), claude.join(HOOK_COPY)];

    if enabled {
        let command = hook_command(exe);
        let mut line = if ours {
            current.clone().unwrap_or_default()
        } else {
            // 第一次接入（或者用户后来自己换过状态栏）：备份 settings.json，记下原来的 statusLine（存两处）
            fs::create_dir_all(dir)?;
            if let Some(text) = &text {
                fs::write(dir.join(BACKUP_FILE), text)?;
            }
            let saved = serde_json::to_string_pretty(
                &serde_json::json!({ "statusLine": current.clone() }),
            )?;
            for path in &hook_paths {
                write_atomic(path, saved.as_bytes())?;
            }
            // 原来的 padding 之类的设置留着，只换命令
            match &current {
                Some(Value::Object(_)) => current.clone().unwrap_or_default(),
                _ => serde_json::json!({ "type": "command" }),
            }
        };
        if line.get("command").and_then(Value::as_str) != Some(command.as_str()) {
            line["command"] = Value::String(command);
            root.insert("statusLine".into(), line);
            write_settings(settings, &root)?;
        }
    } else {
        if ours {
            match saved_line(dir, Some(claude)) {
                Some(line) => root.insert("statusLine".into(), line),
                None => root.remove("statusLine"),
            };
            write_settings(settings, &root)?;
        }
        for path in &hook_paths {
            let _ = fs::remove_file(path);
        }
        // 关着的时候不该显示限额和生成速度：之前存的也删掉（不然限额要等到重置时间过了、速度要等一小时才消失）
        let _ = fs::remove_file(dir.join(LIMITS_FILE));
        let _ = fs::remove_dir_all(dir.join("speed"));
    }

    Ok(HookStatus {
        connected: enabled,
        original: original_command(dir, Some(claude)),
    })
}

/// 写成和 Claude Code 自己写的一样：两个空格缩进，末尾一个换行
fn write_settings(path: &Path, root: &Map<String, Value>) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut text = serde_json::to_string_pretty(root)?;
    text.push('\n');
    write_atomic(path, text.as_bytes())
}

/// 写进 settings.json 的命令。路径用正斜杠（Git Bash 会吃掉反斜杠）；带空格要加引号，
/// PowerShell 里带引号的路径前面还得加 &
fn hook_command(exe: &Path) -> String {
    let exe = exe.to_string_lossy().replace('\\', "/");
    if !exe.contains(' ') {
        format!("{exe} {FLAG}")
    } else if git_bash().is_some() {
        format!("\"{exe}\" {FLAG}")
    } else {
        format!("& \"{exe}\" {FLAG}")
    }
}

// ---------- 程序里：盯着限额文件 ----------

/// 每 2 秒看一眼限额文件和生成速度文件的修改时间，变了就通知前端（状态栏是 Claude Code 跑的另一个进程写的，没法直接发事件）
pub fn watch(app: AppHandle) {
    std::thread::spawn(move || {
        // 限额文件和生成速度目录里最新的修改时间
        let stamp = || -> Option<(Option<SystemTime>, Option<SystemTime>)> {
            let dir = data_dir()?;
            let modified = |p: &Path| fs::metadata(p).ok()?.modified().ok();
            let speed = fs::read_dir(dir.join("speed"))
                .ok()
                .and_then(|entries| entries.flatten().filter_map(|e| modified(&e.path())).max());
            Some((modified(&dir.join(LIMITS_FILE)), speed))
        };
        let mut last = stamp();
        loop {
            std::thread::sleep(Duration::from_secs(2));
            let now = stamp();
            if now != last {
                last = now;
                let _ = app.emit(EVENT, ());
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_rate_limits() {
        let input = json!({
            "cost": { "total_api_duration_ms": 2300 },
            "rate_limits": {
                "five_hour": { "used_percentage": 23.5, "resets_at": 1738425600 },
                "seven_day": { "used_percentage": 41.2, "resets_at": 1738857600 }
            }
        });
        let limits = limits_from(&input).unwrap();
        assert_eq!(
            limits.five_hour,
            Some(Window {
                used_percentage: 23.5,
                resets_at: 1738425600
            })
        );
        assert_eq!(limits.seven_day.unwrap().used_percentage, 41.2);
        assert_eq!(summary(&limits_from(&input).unwrap()), "5h 24% · 7d 41%");
    }

    #[test]
    fn missing_rate_limits() {
        // 没有限额（还没收到回复、API / 中转会话、刚过重置时间）：说明不了什么，原来存的不动
        assert_eq!(
            limits_from(&json!({ "cost": { "total_api_duration_ms": 0 } })),
            None
        );
        assert_eq!(
            limits_from(&json!({ "cost": { "total_api_duration_ms": 1200 } })),
            None
        );
        assert_eq!(limits_from(&json!({})), None);
        // 只有一个窗口
        let only = limits_from(
            &json!({ "rate_limits": { "seven_day": { "used_percentage": 3, "resets_at": 1 } } }),
        )
        .unwrap();
        assert!(only.five_hour.is_none() && only.seven_day.is_some());
    }

    #[test]
    fn keeps_windows_that_were_not_sent() {
        let w = |p: f64, at: i64| Window {
            used_percentage: p,
            resets_at: at,
        };
        let old = Limits {
            five_hour: Some(w(80.0, 100)),
            seven_day: Some(w(30.0, 900)),
        };
        // 过了 5h 重置时间，Claude Code 只给了 7 天的：5h 留着旧的（前端显示"已重置"）
        let fresh = Limits {
            five_hour: None,
            seven_day: Some(w(31.0, 900)),
        };
        assert_eq!(
            merge(Some(old), fresh),
            Limits {
                five_hour: Some(w(80.0, 100)),
                seven_day: Some(w(31.0, 900))
            }
        );
        // 新窗口开始：换成新的
        let fresh = Limits {
            five_hour: Some(w(2.0, 400)),
            seven_day: None,
        };
        assert_eq!(merge(None, fresh.clone()), fresh);
    }

    /// 7 天窗口换轮时记下上一轮最后的百分比；同一轮重置时间差几秒不算换轮，同一次换轮不重复记
    #[test]
    fn records_finished_week() {
        let dir = std::env::temp_dir().join(format!("ccusage-ui-history-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let week = |pct: f64, at: i64| Limits {
            five_hour: None,
            seven_day: Some(Window {
                used_percentage: pct,
                resets_at: at,
            }),
        };
        record_finished_week(&dir, Some(&week(40.0, 1_000_000)), &week(41.0, 1_000_003));
        assert!(read_history(&dir).is_empty());
        record_finished_week(&dir, Some(&week(87.0, 1_000_000)), &week(2.0, 1_604_800));
        record_finished_week(&dir, Some(&week(87.0, 1_000_000)), &week(3.0, 1_604_800));
        assert_eq!(
            read_history(&dir),
            vec![Window {
                used_percentage: 87.0,
                resets_at: 1_000_000
            }]
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// 在临时目录里走一遍：接入 → 再接入（不重复备份）→ 断开，settings.json 要原样回来
    #[test]
    fn hook_round_trip() {
        let tmp = std::env::temp_dir().join(format!("ccusage-ui-hook-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let claude = tmp.join("claude");
        fs::create_dir_all(&claude).unwrap();
        let settings = claude.join("settings.json");
        let dir = tmp.join("data");
        let exe = Path::new(r"D:\apps\ccusage-ui.exe");
        let original = "{\n  \"model\": \"opus\",\n  \"statusLine\": {\n    \"type\": \"command\",\n    \"command\": \"exec ~/hud.sh\",\n    \"padding\": 0\n  },\n  \"theme\": \"dark\"\n}\n";
        fs::write(&settings, original).unwrap();

        let status = hook(&claude, &dir, exe, true).unwrap();
        assert!(status.connected);
        assert_eq!(status.original.as_deref(), Some("exec ~/hud.sh"));
        let hooked = fs::read_to_string(&settings).unwrap();
        assert!(hooked.contains(&format!("D:/apps/ccusage-ui.exe {FLAG}")));
        // 别的设置、顺序、padding 都还在
        assert!(hooked.starts_with("{\n  \"model\": \"opus\",\n  \"statusLine\""));
        assert!(hooked.contains("\"padding\": 0") && hooked.ends_with("}\n"));
        // 原来的命令存了两份
        assert!(dir.join(HOOK_FILE).is_file() && claude.join(HOOK_COPY).is_file());

        // 已经接上了：再调一次什么都不变，原来的命令也还记得
        hook(&claude, &dir, exe, true).unwrap();
        assert_eq!(fs::read_to_string(&settings).unwrap(), hooked);
        assert_eq!(
            original_command(&dir, Some(&claude)).as_deref(),
            Some("exec ~/hud.sh")
        );

        // 数据目录被删了（卸载时勾了删除应用数据）：靠 Claude 配置目录里那份也能恢复；限额和速度一起删掉
        fs::remove_dir_all(&dir).unwrap();
        fs::create_dir_all(dir.join("speed")).unwrap();
        fs::write(dir.join(LIMITS_FILE), "{}").unwrap();
        let status = hook(&claude, &dir, exe, false).unwrap();
        assert!(!status.connected && status.original.is_none());
        assert_eq!(fs::read_to_string(&settings).unwrap(), original);
        assert!(!dir.join(LIMITS_FILE).exists() && !dir.join("speed").exists());
        assert!(!claude.join(HOOK_COPY).exists());

        // 原来没有状态栏：断开后 statusLine 整个去掉
        fs::write(&settings, "{\n  \"model\": \"opus\"\n}\n").unwrap();
        hook(&claude, &dir, exe, true).unwrap();
        hook(&claude, &dir, exe, false).unwrap();
        assert_eq!(
            fs::read_to_string(&settings).unwrap(),
            "{\n  \"model\": \"opus\"\n}\n"
        );
        let _ = fs::remove_dir_all(&tmp);
    }

    /// 本机真实的 Claude Code settings.json 用 serde_json 读进来再写出去，要和原文一字不差（只读，不写回）
    #[test]
    #[ignore]
    fn real_settings_round_trip() {
        let home = PathBuf::from(std::env::var_os("USERPROFILE").unwrap());
        let text = fs::read_to_string(claude_dir(&home).join("settings.json")).unwrap();
        let root: Map<String, Value> = serde_json::from_str(&text).unwrap();
        let mut out = serde_json::to_string_pretty(&root).unwrap();
        out.push('\n');
        assert!(out == text, "写回去的格式和原文不一样");
    }
}
