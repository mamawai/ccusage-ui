//! 安装 / 更新 ccusage：用本机的包管理器（npm / pnpm / bun / yarn）全局安装，
//! 或者下载 ccusage-ui 自带版（直接从 npm 下载 ccusage 的 Windows 原生包，不需要 Node）。
//! 这里只负责装，装完由前端重新查找 ccusage。

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use base64::Engine;
use serde::Serialize;
use sha2::{Digest, Sha512};

use super::CcusageError;
use super::locate::{self, Method};

/// 本机的一个包管理器
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Manager {
    pub method: Method,
    pub version: Option<String>,
    /// 能不能全局安装：pnpm 没跑过 pnpm setup、yarn 2 以上都不行
    pub ready: bool,
}

/// 装一次最多等多久：npm 慢的时候要几分钟，再久就当卡住了，杀掉（不然一直占着锁，报表全排队）
const INSTALL_TIMEOUT: Duration = Duration::from_secs(10 * 60);

const MANAGERS: [(Method, &str); 4] = [
    (Method::Npm, "npm"),
    (Method::Pnpm, "pnpm"),
    (Method::Bun, "bun"),
    (Method::Yarn, "yarn"),
];

/// PATH 上找得到的包管理器，没装的不列
pub fn managers() -> Vec<Manager> {
    // 每个问一次要 0.1～0.5 秒，并行问
    std::thread::scope(|s| {
        let jobs = MANAGERS.map(|(method, name)| {
            s.spawn(move || {
                let exe = locate::which(name)?;
                Some(Manager {
                    method,
                    version: locate::version(&exe),
                    ready: locate::global_ready(method),
                })
            })
        });
        jobs.into_iter()
            .filter_map(|job| job.join().ok().flatten())
            .collect()
    })
}

/// 版本号只能是 latest 或者 20.0.31 这种（会拼进命令行，不收别的字符）
fn valid_version(version: &str) -> bool {
    version == "latest"
        || (!version.is_empty()
            && version
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-'))
}

/// 用包管理器全局安装指定版本的 ccusage，返回命令的输出（原样，给前端显示）
pub fn with_manager(method: Method, version: &str) -> Result<String, CcusageError> {
    if !valid_version(version) {
        return Err(CcusageError::BadRequest {
            message: format!("version: {version}"),
        });
    }
    let spec = format!("ccusage@{version}");
    let (name, args): (&str, Vec<&str>) = match method {
        Method::Npm => ("npm", vec!["install", "-g", &spec]),
        Method::Pnpm => ("pnpm", vec!["add", "-g", &spec]),
        Method::Bun => ("bun", vec!["add", "-g", &spec]),
        Method::Yarn => ("yarn", vec!["global", "add", &spec]),
        Method::Bundled | Method::Unknown => {
            return Err(CcusageError::BadRequest {
                message: format!("method: {method:?}"),
            });
        }
    };
    let exe = locate::which(name).ok_or(CcusageError::InstallFailed {
        message: format!("{name}: not found"),
    })?;

    let mut cmd = Command::new(exe);
    // 在临时目录跑：项目目录里的 package.json 可能指定了别的包管理器
    cmd.args(&args)
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::null());
    super::no_window(&mut cmd);
    let out = super::output_with_timeout(&mut cmd, INSTALL_TIMEOUT).map_err(|e| {
        CcusageError::InstallFailed {
            message: e.to_string(),
        }
    })?;

    let log = format!(
        "> {name} {}\n{}{}",
        args.join(" "),
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    )
    .trim_end()
    .to_string();
    if out.status.success() {
        Ok(log)
    } else {
        Err(CcusageError::InstallFailed { message: log })
    }
}

/// 只认 npm 官方仓库里 ccusage Windows x64 原生包的标准下载地址，整条逐字比对，版本号只能是数字、字母、点、横线
/// （带 .. 或 %2e 之类绕路径的都过不了）
fn official_tarball(url: &str) -> bool {
    const HEAD: &str = "https://registry.npmjs.org/@ccusage/ccusage-win32-x64/-/ccusage-win32-x64-";
    url.strip_prefix(HEAD)
        .and_then(|rest| rest.strip_suffix(".tgz"))
        .is_some_and(|version| version != "latest" && valid_version(version))
}

/// 自带版：下载 npm 上的 @ccusage/ccusage-win32-x64 包，校验 sha512，解压出 ccusage.exe 放到 dest。
/// 原来的 ccusage.exe 改名成 ccusage.exe.bak 留着回退。url 和 integrity 是 npm 仓库给的（前端查好传过来）
pub fn bundled(dest: &Path, url: &str, integrity: &str) -> Result<(), CcusageError> {
    if !official_tarball(url) {
        return Err(CcusageError::BadRequest {
            message: format!("url: {url}"),
        });
    }
    let expected = integrity
        .strip_prefix("sha512-")
        .and_then(|b64| base64::engine::general_purpose::STANDARD.decode(b64).ok())
        .ok_or_else(|| CcusageError::BadRequest {
            message: format!("integrity: {integrity}"),
        })?;

    let work = std::env::temp_dir().join(format!("ccusage-ui-download-{}", std::process::id()));
    let _ = fs::remove_dir_all(&work);
    fs::create_dir_all(&work).map_err(failed)?;
    let result = download_and_place(&work, dest, url, &expected);
    let _ = fs::remove_dir_all(&work);
    result
}

fn download_and_place(
    work: &Path,
    dest: &Path,
    url: &str,
    expected: &[u8],
) -> Result<(), CcusageError> {
    // Windows 10 起系统自带 curl.exe 和 tar.exe，不用另外带下载、解压的库。
    // 连不上 15 秒放弃；连上了但 30 秒里每秒不到 1KB（网络半断）也放弃，免得一直卡着
    let tgz = work.join("package.tgz");
    run_tool(
        "curl.exe",
        &[
            "-fsSL",
            "--retry",
            "2",
            "--connect-timeout",
            "15",
            "--speed-limit",
            "1024",
            "--speed-time",
            "30",
            "-o",
            &tgz.to_string_lossy(),
            url,
        ],
    )?;

    let bytes = fs::read(&tgz).map_err(failed)?;
    if Sha512::digest(&bytes).as_slice() != expected {
        return Err(CcusageError::InstallFailed {
            message: "sha512 mismatch".into(),
        });
    }

    run_tool(
        "tar.exe",
        &[
            "-xzf",
            &tgz.to_string_lossy(),
            "-C",
            &work.to_string_lossy(),
        ],
    )?;
    // npm 包解压出来都在 package 目录下
    let fresh = work.join("package").join("bin").join("ccusage.exe");
    // 先确认新的能跑，再替换
    if locate::version(&fresh).is_none() {
        return Err(CcusageError::InstallFailed {
            message: format!("{}: --version failed", fresh.display()),
        });
    }

    if let Some(dir) = dest.parent() {
        fs::create_dir_all(dir).map_err(failed)?;
    }
    if dest.is_file() {
        let bak = backup_path(dest);
        let _ = fs::remove_file(&bak);
        fs::rename(dest, &bak).map_err(failed)?;
    }
    fs::copy(&fresh, dest).map_err(failed)?;
    Ok(())
}

/// 自带版回退：用留着的 ccusage.exe.bak 换回去
pub fn rollback_bundled(dest: &Path) -> Result<(), CcusageError> {
    let bak = backup_path(dest);
    if !bak.is_file() {
        return Err(CcusageError::InstallFailed {
            message: format!("{}: not found", bak.display()),
        });
    }
    if dest.is_file() {
        fs::remove_file(dest).map_err(failed)?;
    }
    fs::rename(&bak, dest).map_err(failed)
}

fn backup_path(dest: &Path) -> PathBuf {
    let mut name = dest.as_os_str().to_owned();
    name.push(".bak");
    PathBuf::from(name)
}

fn run_tool(program: &str, args: &[&str]) -> Result<(), CcusageError> {
    let mut cmd = Command::new(program);
    cmd.args(args).stdin(Stdio::null());
    super::no_window(&mut cmd);
    let out = super::output_with_timeout(&mut cmd, INSTALL_TIMEOUT).map_err(|e| {
        CcusageError::InstallFailed {
            message: format!("{program}: {e}"),
        }
    })?;
    if out.status.success() {
        Ok(())
    } else {
        Err(CcusageError::InstallFailed {
            message: format!("{program}: {}", String::from_utf8_lossy(&out.stderr).trim()),
        })
    }
}

fn failed(e: std::io::Error) -> CcusageError {
    CcusageError::InstallFailed {
        message: e.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_must_be_plain() {
        assert!(valid_version("latest"));
        assert!(valid_version("20.0.31"));
        assert!(valid_version("21.0.0-beta.1"));
        assert!(!valid_version(""));
        assert!(!valid_version("20.0.31 && calc"));
        assert!(!valid_version("1.0.0;x"));
    }

    #[test]
    fn bundled_rejects_other_urls() {
        let dest = std::env::temp_dir().join("ccusage-ui-test-never.exe");
        let err = bundled(&dest, "https://example.com/x.tgz", "sha512-AAAA").unwrap_err();
        assert!(matches!(err, CcusageError::BadRequest { .. }));
        assert!(official_tarball(
            "https://registry.npmjs.org/@ccusage/ccusage-win32-x64/-/ccusage-win32-x64-20.0.31.tgz"
        ));
        // 用 .. 绕到别的包
        assert!(!official_tarball(
            "https://registry.npmjs.org/@ccusage/ccusage-win32-x64/../../evil/-/evil-1.0.0.tgz"
        ));
        assert!(!official_tarball(
            "https://registry.npmjs.org/@ccusage/ccusage-win32-x64/-/ccusage-win32-x64-1.0/../../x.tgz"
        ));
        assert!(!official_tarball(
            "https://registry.npmjs.org/@ccusage/ccusage-win32-x64/-/ccusage-win32-x64-%2e%2e.tgz"
        ));
    }

    #[test]
    fn rollback_restores_backup() {
        let dir =
            std::env::temp_dir().join(format!("ccusage-ui-test-rollback-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let dest = dir.join("ccusage.exe");
        fs::write(&dest, b"new").unwrap();
        fs::write(backup_path(&dest), b"old").unwrap();
        rollback_bundled(&dest).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), b"old");
        assert!(!backup_path(&dest).is_file());
        fs::remove_dir_all(dir).unwrap();
    }
}
