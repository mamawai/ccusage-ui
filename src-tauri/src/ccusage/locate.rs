//! 找 ccusage：ccusage-ui 自带版、npm / pnpm / bun / yarn 的全局安装、PATH 上的第一个。
//! 找到包管理器装的那份后，直接用里面的原生 ccusage.exe，不经过 Node 启动壳（更快，也不闪黑框）。

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};

/// ccusage 是怎么装的，决定以后用什么方式更新
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Method {
    Npm,
    Pnpm,
    Bun,
    Yarn,
    /// ccusage-ui 自带版
    Bundled,
    /// PATH 上有，但认不出是哪种方式装的
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Install {
    pub method: Method,
    /// 实际要运行的文件
    pub exe: PathBuf,
    /// ccusage --version 的结果，跑不出来就是 None
    pub version: Option<String>,
    /// 是不是在终端里敲 ccusage 会跑到的那一份
    pub on_path: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Located {
    /// 选中在用的那一份；一份都没有就是 None
    pub active: Option<Install>,
    /// 本机找到的所有 ccusage
    pub all: Vec<Install>,
}

/// 某个包管理器的全局安装目录
struct Global {
    method: Method,
    /// 全局包所在的 node_modules
    root: PathBuf,
    /// 全局命令所在的目录
    bin: PathBuf,
}

pub fn locate(bundled: &Path) -> Located {
    // 每个包管理器问一次要 0.1～0.5 秒，并行问
    let (globals, hit) = std::thread::scope(|s| {
        let jobs = [
            s.spawn(npm_global),
            s.spawn(pnpm_global),
            s.spawn(bun_global),
            s.spawn(yarn_global),
        ];
        let hit = which("ccusage");
        (jobs.map(|job| job.join().ok().flatten()), hit)
    });
    let hit_dir = hit.as_deref().and_then(Path::parent);

    let mut all = Vec::new();
    if bundled.is_file() {
        all.push(Install {
            method: Method::Bundled,
            exe: bundled.to_path_buf(),
            version: None,
            on_path: false,
        });
    }
    for g in globals.into_iter().flatten() {
        if let Some(exe) = native_exe(&g.root.join("ccusage")) {
            let on_path = hit_dir.is_some_and(|dir| same_dir(dir, &g.bin));
            all.push(Install {
                method: g.method,
                exe,
                version: None,
                on_path,
            });
        }
    }
    // PATH 上有 ccusage，但不是上面哪种方式装的（比如手动放的），就直接用 PATH 上那个
    if let Some(hit) = hit
        && !all.iter().any(|i| i.on_path)
    {
        all.push(Install {
            method: Method::Unknown,
            exe: hit,
            version: None,
            on_path: true,
        });
    }

    std::thread::scope(|s| {
        for install in all.iter_mut() {
            s.spawn(move || install.version = version(&install.exe));
        }
    });

    // 在用的那份：终端里敲 ccusage 会跑到的优先，其次自带版，再其次找到的第一份
    let active = all
        .iter()
        .find(|i| i.on_path)
        .or_else(|| all.iter().find(|i| i.method == Method::Bundled))
        .or(all.first())
        .cloned();
    Located { active, all }
}

fn npm_global() -> Option<Global> {
    let npm = which("npm")?;
    let root = PathBuf::from(capture(&npm, &["root", "-g"])?);
    // Windows 上 npm 的全局命令就放在 prefix 根目录，root 是 prefix\node_modules
    let bin = root.parent()?.to_path_buf();
    Some(Global {
        method: Method::Npm,
        root,
        bin,
    })
}

fn pnpm_global() -> Option<Global> {
    let pnpm = which("pnpm")?;
    // 没跑过 pnpm setup 时这两个命令都会报错，这时 pnpm 也装不了全局包，直接当没有
    let root = PathBuf::from(capture(&pnpm, &["root", "-g"])?);
    let bin = PathBuf::from(capture(&pnpm, &["bin", "-g"])?);
    Some(Global {
        method: Method::Pnpm,
        root,
        bin,
    })
}

fn bun_global() -> Option<Global> {
    let bun = which("bun")?;
    let bin = PathBuf::from(capture(&bun, &["pm", "bin", "-g"])?);
    // bun 默认布局：命令在 <BUN_INSTALL>\bin，全局包在 <BUN_INSTALL>\install\global\node_modules
    let root = bin
        .parent()?
        .join("install")
        .join("global")
        .join("node_modules");
    Some(Global {
        method: Method::Bun,
        root,
        bin,
    })
}

fn yarn_global() -> Option<Global> {
    let yarn = which("yarn")?;
    // 只有 yarn 1 有 global 命令，新版 yarn 会报错，当没有
    let root = PathBuf::from(capture(&yarn, &["global", "dir"])?).join("node_modules");
    let bin = PathBuf::from(capture(&yarn, &["global", "bin"])?);
    Some(Global {
        method: Method::Yarn,
        root,
        bin,
    })
}

/// 这个包管理器能不能全局安装（问得到全局目录才行：pnpm 没跑过 pnpm setup、yarn 2 以上都问不到）
pub(super) fn global_ready(method: Method) -> bool {
    match method {
        Method::Npm => npm_global().is_some(),
        Method::Pnpm => pnpm_global().is_some(),
        Method::Bun => bun_global().is_some(),
        Method::Yarn => yarn_global().is_some(),
        Method::Bundled | Method::Unknown => false,
    }
}

/// 按 PATH 顺序找命令。Windows 上 Command 只会自动补 .exe，npm 这类是 .cmd，所以自己找
pub(super) fn which(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).find_map(|dir| {
        [".exe", ".bat", ".cmd"]
            .iter()
            .map(|ext| dir.join(format!("{name}{ext}")))
            .find(|p| p.is_file())
    })
}

/// 从 ccusage 包目录出发，按 Node 找依赖的规则逐级往上，找平台包里的原生 ccusage.exe。
/// npm 把它放在包自己的 node_modules 里，bun / pnpm 放在旁边，这样都能找到。
fn native_exe(pkg_dir: &Path) -> Option<PathBuf> {
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        _ => return None,
    };
    let rel = Path::new("@ccusage")
        .join(format!("ccusage-win32-{arch}"))
        .join("bin")
        .join("ccusage.exe");
    // pnpm 的包目录是链接，先解析成真实位置
    let real = std::fs::canonicalize(pkg_dir).ok()?;
    real.ancestors()
        .filter(|dir| {
            !dir.file_name()
                .is_some_and(|n| n.eq_ignore_ascii_case("node_modules"))
        })
        .map(|dir| dir.join("node_modules").join(&rel))
        .find(|p| p.is_file())
        .map(plain)
}

/// 程序的版本号：取 --version 输出的最后一个词（ccusage 输出 "ccusage 20.0.31"，npm 直接输出 "11.6.2"）
pub(super) fn version(exe: &Path) -> Option<String> {
    capture(exe, &["--version"])?
        .split_whitespace()
        .next_back()
        .map(str::to_string)
}

/// 跑一个命令，成功就返回输出的最后一个非空行
fn capture(program: &Path, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new(program);
    // 在临时目录跑：项目目录里的 package.json 可能指定了别的包管理器，yarn 会因此报错
    cmd.args(args)
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::null());
    super::no_window(&mut cmd);
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(str::trim)
        .rfind(|line| !line.is_empty())
        .map(str::to_string)
}

fn same_dir(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

/// canonicalize 在 Windows 上会带 \\?\ 前缀，去掉方便显示
fn plain(p: PathBuf) -> PathBuf {
    if let Some(rest) = p.to_str().and_then(|s| s.strip_prefix(r"\\?\"))
        && !rest.starts_with(r"UNC\")
    {
        return PathBuf::from(rest);
    }
    p
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_root(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("ccusage-ui-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn touch_native(node_modules: &Path) -> PathBuf {
        let bin = node_modules
            .join("@ccusage")
            .join("ccusage-win32-x64")
            .join("bin");
        fs::create_dir_all(&bin).unwrap();
        let exe = bin.join("ccusage.exe");
        fs::write(&exe, b"").unwrap();
        exe
    }

    #[test]
    fn native_exe_nested_like_npm() {
        let root = temp_root("npm");
        let pkg = root.join("node_modules").join("ccusage");
        let exe = touch_native(&pkg.join("node_modules"));
        assert_eq!(
            native_exe(&pkg).unwrap(),
            plain(fs::canonicalize(exe).unwrap())
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn native_exe_hoisted_like_bun() {
        let root = temp_root("bun");
        let node_modules = root.join("install").join("global").join("node_modules");
        let pkg = node_modules.join("ccusage");
        fs::create_dir_all(&pkg).unwrap();
        let exe = touch_native(&node_modules);
        assert_eq!(
            native_exe(&pkg).unwrap(),
            plain(fs::canonicalize(exe).unwrap())
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn native_exe_missing() {
        let root = temp_root("missing");
        let pkg = root.join("node_modules").join("ccusage");
        fs::create_dir_all(&pkg).unwrap();
        assert!(native_exe(&pkg).is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn plain_strips_verbatim_prefix() {
        assert_eq!(
            plain(PathBuf::from(r"\\?\D:\a\b")),
            PathBuf::from(r"D:\a\b")
        );
        assert_eq!(
            plain(PathBuf::from(r"\\?\UNC\srv\share")),
            PathBuf::from(r"\\?\UNC\srv\share")
        );
        assert_eq!(plain(PathBuf::from(r"D:\a")), PathBuf::from(r"D:\a"));
    }
}
