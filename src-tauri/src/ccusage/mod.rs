//! ccusage 调用层：找到本机的 ccusage，按固定的几种报表去调用它，把 JSON 原样交给前端。
//! 数字一律以 ccusage 的输出为准，这里不做任何计算。

mod install;
mod locate;
mod report;

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use tokio::sync::RwLock;

use install::Manager as PackageManager;
use locate::{Install, Located, Method};
use report::{Options, Report};

#[derive(Default)]
pub struct CcusageState {
    /// 当前在用的那份 ccusage，找过一次就缓存，免得每次调用都重新找
    active: Mutex<Option<Install>>,
    /// 安装 / 更新时要换掉 ccusage.exe，它正在跑时 Windows 不让换。
    /// 跑报表拿读锁、安装拿写锁：安装会等正在跑的报表结束，装的时候新来的报表排队，装完再跑
    gate: RwLock<()>,
}

/// 返回给前端的错误，code 用来区分该显示什么（比如 notFound 就显示"安装 ccusage"）。
/// message 只放原始细节（系统报错、ccusage 的 stderr 等），整句话由前端按当前语言拼
#[derive(Debug, Serialize)]
#[serde(tag = "code", rename_all = "camelCase")]
pub enum CcusageError {
    /// 本机没找到 ccusage
    NotFound,
    /// 前端传来的参数不合法
    BadRequest { message: String },
    /// ccusage 没跑成功
    Failed { message: String },
    /// ccusage 输出的不是 JSON
    BadOutput { message: String },
    /// 安装 / 更新 / 回退没成功；message 是命令的输出或系统报错
    InstallFailed { message: String },
}

/// 找本机所有的 ccusage，并选出在用的那份。启动时和设置页"重新检测"时调用
#[tauri::command]
pub async fn ccusage_locate(
    app: AppHandle,
    state: State<'_, CcusageState>,
) -> Result<Located, CcusageError> {
    let located = locate_now(&app).await?;
    *state.active.lock().expect("ccusage 状态锁") = located.active.clone();
    Ok(located)
}

/// 本机能用来装 ccusage 的包管理器（安装页、设置页用）
#[tauri::command]
pub async fn ccusage_managers() -> Result<Vec<PackageManager>, CcusageError> {
    tauri::async_runtime::spawn_blocking(install::managers)
        .await
        .map_err(|e| CcusageError::Failed {
            message: e.to_string(),
        })
}

/// 用包管理器全局安装 / 更新 / 回退到某个版本（version 填 latest 或具体版本号），返回命令输出
#[tauri::command]
pub async fn ccusage_install(
    state: State<'_, CcusageState>,
    method: Method,
    version: String,
) -> Result<String, CcusageError> {
    let _updating = state.gate.write().await;
    let result =
        tauri::async_runtime::spawn_blocking(move || install::with_manager(method, &version))
            .await
            .map_err(|e| CcusageError::InstallFailed {
                message: e.to_string(),
            })?;
    // 装完在用的那份可能变了，下次调用重新找
    *state.active.lock().expect("ccusage 状态锁") = None;
    result
}

/// 下载自带版（url 和 integrity 是 npm 仓库里 @ccusage/ccusage-win32-x64 那个版本的 dist 信息）
#[tauri::command]
pub async fn ccusage_install_bundled(
    app: AppHandle,
    state: State<'_, CcusageState>,
    url: String,
    integrity: String,
) -> Result<(), CcusageError> {
    let dest = bundled_exe(&app);
    let _updating = state.gate.write().await;
    let result =
        tauri::async_runtime::spawn_blocking(move || install::bundled(&dest, &url, &integrity))
            .await
            .map_err(|e| CcusageError::InstallFailed {
                message: e.to_string(),
            })?;
    *state.active.lock().expect("ccusage 状态锁") = None;
    result
}

/// 自带版回退到更新前的那份
#[tauri::command]
pub async fn ccusage_rollback_bundled(
    app: AppHandle,
    state: State<'_, CcusageState>,
) -> Result<(), CcusageError> {
    let dest = bundled_exe(&app);
    let _updating = state.gate.write().await;
    let result = tauri::async_runtime::spawn_blocking(move || install::rollback_bundled(&dest))
        .await
        .map_err(|e| CcusageError::InstallFailed {
            message: e.to_string(),
        })?;
    *state.active.lock().expect("ccusage 状态锁") = None;
    result
}

/// 跑一种报表，把 ccusage 的 JSON 原样返回
#[tauri::command]
pub async fn ccusage_report(
    app: AppHandle,
    state: State<'_, CcusageState>,
    report: Report,
    opts: Options,
) -> Result<Value, CcusageError> {
    let args =
        report::args(&report, &opts).map_err(|message| CcusageError::BadRequest { message })?;

    // 正在安装 / 更新时在这里等着，装完再跑
    let _running = state.gate.read().await;

    let cached = state.active.lock().expect("ccusage 状态锁").clone();
    let install = match cached {
        Some(install) => install,
        None => {
            let active = locate_now(&app).await?.active;
            *state.active.lock().expect("ccusage 状态锁") = active.clone();
            active.ok_or(CcusageError::NotFound)?
        }
    };

    let result = tauri::async_runtime::spawn_blocking(move || run(&install.exe, &args))
        .await
        .map_err(|e| CcusageError::Failed {
            message: e.to_string(),
        })?;
    // 缓存的那份已经不在了（比如被卸载），清掉缓存，下次重新找
    if matches!(result, Err(CcusageError::NotFound)) {
        *state.active.lock().expect("ccusage 状态锁") = None;
    }
    result
}

async fn locate_now(app: &AppHandle) -> Result<Located, CcusageError> {
    let bundled = bundled_exe(app);
    tauri::async_runtime::spawn_blocking(move || locate::locate(&bundled))
        .await
        .map_err(|e| CcusageError::Failed {
            message: e.to_string(),
        })
}

/// ccusage-ui 自带版放的位置（没装 Node 的用户用这个）
fn bundled_exe(app: &AppHandle) -> PathBuf {
    app.path()
        .app_local_data_dir()
        .map(|dir| dir.join("bin").join("ccusage.exe"))
        .unwrap_or_default()
}

/// 一次报表最多跑多久：正常几秒，卡住了就杀掉，免得一直占着锁、后面的报表全排队
const REPORT_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// 跑一次 ccusage，成功就把输出按 JSON 解析后原样返回
fn run(exe: &Path, args: &[String]) -> Result<Value, CcusageError> {
    let mut cmd = Command::new(exe);
    // 在临时目录跑，免得读到某个项目目录里的 ccusage 配置；再指定一个空配置，
    // ~/.claude/ccusage.json 这类全局配置里的默认值（时区、筛选、jq……）也不会改掉报表的口径
    cmd.args(args)
        .arg("--config")
        .arg(empty_config())
        .current_dir(std::env::temp_dir())
        .env("NO_COLOR", "1")
        .stdin(Stdio::null());
    no_window(&mut cmd);

    let out = output_with_timeout(&mut cmd, REPORT_TIMEOUT).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => CcusageError::NotFound,
        _ => CcusageError::Failed {
            message: e.to_string(),
        },
    })?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let message = if stderr.is_empty() {
            out.status.to_string()
        } else {
            stderr
        };
        return Err(CcusageError::Failed { message });
    }
    serde_json::from_slice(&out.stdout).map_err(|e| CcusageError::BadOutput {
        message: e.to_string(),
    })
}

/// 内容只有 {} 的配置文件，每次调用 ccusage 都指定它
fn empty_config() -> PathBuf {
    let path = std::env::temp_dir().join("ccusage-ui-empty-config.json");
    if !path.is_file() {
        let _ = std::fs::write(&path, "{}");
    }
    path
}

/// 跑子进程拿输出，超过 limit 就杀掉并报超时。输出另开线程读，不然输出多、管道满了子进程会卡住
pub(crate) fn output_with_timeout(cmd: &mut Command, limit: Duration) -> std::io::Result<Output> {
    let mut child = cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
    let read_all = |mut pipe: Box<dyn Read + Send>| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = pipe.read_to_end(&mut buf);
            buf
        })
    };
    let stdout = read_all(Box::new(child.stdout.take().expect("stdout 是 piped")));
    let stderr = read_all(Box::new(child.stderr.take().expect("stderr 是 piped")));
    let deadline = Instant::now() + limit;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                format!("timed out after {}s", limit.as_secs()),
            ));
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    Ok(Output {
        status,
        stdout: stdout.join().unwrap_or_default(),
        stderr: stderr.join().unwrap_or_default(),
    })
}

/// GUI 程序里起命令行程序，Windows 默认会闪一下黑框，这里关掉
#[cfg_attr(not(windows), allow(unused_variables))]
pub(crate) fn no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 拿本机真实的 ccusage 跑一遍：cargo test -- --ignored
    #[test]
    #[ignore]
    fn smoke_real_ccusage() {
        let located = locate::locate(Path::new(""));
        println!("{located:#?}");
        let active = located.active.expect("本机应该装了 ccusage");

        let args = report::args(
            &Report::ClaudeDaily { instances: false },
            &Options {
                offline: true,
                ..Default::default()
            },
        )
        .unwrap();
        let json = run(&active.exe, &args).expect("ccusage 应该能跑通");
        assert!(json.get("daily").is_some_and(Value::is_array));
        assert!(json.get("totals").is_some_and(Value::is_object));
    }
}
