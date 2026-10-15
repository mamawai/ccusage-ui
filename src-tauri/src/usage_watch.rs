//! 盯着 Claude Code 的日志：每 2 秒看一眼日志文件的数量、大小和修改时间，变了就通知前端重新取数据。
//! 只看文件信息，不读内容、不联网，一次只要几毫秒。
//! 去哪找日志和 ccusage 保持一致（见 ccusage 的 adapters/claude/src/paths.rs）
//!
//! 通知的节奏也在这里定：发现变化后等 1.5 秒（让这一轮写完）再通知，两次通知至少隔 5 秒。
//! 不放在前端做，是因为大 Dock 收到托盘后网页里的定时器会被系统节流，等待可能被拖到一分钟；
//! 前端收到事件就直接取，不用定时器

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager};

/// 前端监听的事件名
pub const EVENT: &str = "usage-changed";

const SCAN_EVERY: Duration = Duration::from_secs(2);
const SETTLE: Duration = Duration::from_millis(1500);
const MIN_GAP: Duration = Duration::from_secs(5);

pub fn start(app: AppHandle) {
    let home = app.path().home_dir().ok();
    std::thread::spawn(move || {
        // 目录每次都重新找：第一次用 Claude Code 之前目录可能还不存在
        let mut last = signature(&project_dirs(home.as_deref()));
        let mut next_scan = Instant::now() + SCAN_EVERY;
        let mut last_emit: Option<Instant> = None;
        // 发现变化后，什么时候通知
        let mut due: Option<Instant> = None;
        loop {
            let wake = due.map_or(next_scan, |d| d.min(next_scan));
            std::thread::sleep(wake.saturating_duration_since(Instant::now()));
            let now = Instant::now();
            if now >= next_scan {
                next_scan = now + SCAN_EVERY;
                let sig = signature(&project_dirs(home.as_deref()));
                if sig != last {
                    last = sig;
                    // 已经在等了就不往后推：一直在写的时候也能每 5 秒左右通知一次
                    due.get_or_insert_with(|| notify_at(now, last_emit));
                }
            }
            if due.is_some_and(|d| now >= d) {
                due = None;
                last_emit = Some(now);
                let _ = app.emit(EVENT, ());
            }
        }
    });
}

/// 刚发现变化时，定下什么时候通知：至少等 1.5 秒，并且离上次通知满 5 秒
fn notify_at(now: Instant, last_emit: Option<Instant>) -> Instant {
    let settled = now + SETTLE;
    match last_emit {
        Some(last) => settled.max(last + MIN_GAP),
        None => settled,
    }
}

/// Claude Code 存日志的 projects 目录：设了 CLAUDE_CONFIG_DIR 就只看它（逗号分隔，
/// 每项是 Claude 配置目录或者它下面的 projects），否则看 ~/.config/claude 和 ~/.claude
fn project_dirs(home: Option<&Path>) -> Vec<PathBuf> {
    let candidates: Vec<PathBuf> = match std::env::var("CLAUDE_CONFIG_DIR") {
        Ok(list) if !list.trim().is_empty() => list
            .split(',')
            .map(str::trim)
            .filter(|raw| !raw.is_empty())
            .map(|raw| expand_home(raw, home))
            .collect(),
        _ => {
            let Some(home) = home else {
                return Vec::new();
            };
            let xdg = std::env::var_os("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".config"));
            vec![xdg.join("claude"), home.join(".claude")]
        }
    };
    let mut dirs = Vec::new();
    for path in candidates {
        let projects = if path.file_name().is_some_and(|name| name == "projects") {
            path
        } else {
            path.join("projects")
        };
        if projects.is_dir() && !dirs.contains(&projects) {
            dirs.push(projects);
        }
    }
    dirs
}

fn expand_home(raw: &str, home: Option<&Path>) -> PathBuf {
    match (raw.strip_prefix("~"), home) {
        (Some(rest), Some(home)) => home.join(rest.trim_start_matches(['/', '\\'])),
        _ => PathBuf::from(raw),
    }
}

/// 所有 .jsonl 日志合起来的"指纹"：文件数、总大小、最新的修改时间。有新内容写进来，至少有一项会变
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct Signature {
    files: u64,
    bytes: u64,
    newest: u128,
}

fn signature(dirs: &[PathBuf]) -> Signature {
    let mut sig = Signature::default();
    let mut stack = dirs.to_vec();
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            // DirEntry::metadata 不跟随链接，不会绕进链接造成的死循环
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            if meta.is_dir() {
                stack.push(entry.path());
            } else if entry.path().extension().is_some_and(|ext| ext == "jsonl") {
                sig.files += 1;
                sig.bytes += meta.len();
                if let Some(modified) = meta
                    .modified()
                    .ok()
                    .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
                {
                    sig.newest = sig.newest.max(modified.as_nanos());
                }
            }
        }
    }
    sig
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    fn temp_root(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("ccusage-ui-watch-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn signature_changes_when_a_log_grows() {
        let root = temp_root("grow");
        let project = root.join(".claude").join("projects").join("p");
        fs::create_dir_all(project.join("subagents")).unwrap();
        fs::write(project.join("a.jsonl"), "{}\n").unwrap();
        fs::write(project.join("subagents").join("b.jsonl"), "{}\n").unwrap();
        fs::write(project.join("notes.txt"), "不算").unwrap();

        let dirs = project_dirs(Some(&root));
        assert_eq!(dirs, vec![root.join(".claude").join("projects")]);
        let before = signature(&dirs);
        assert_eq!(before.files, 2);

        let mut file = fs::OpenOptions::new()
            .append(true)
            .open(project.join("a.jsonl"))
            .unwrap();
        file.write_all(b"{}\n").unwrap();
        drop(file);
        assert_ne!(signature(&dirs), before);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn missing_dirs_are_skipped() {
        let root = temp_root("missing");
        assert!(project_dirs(Some(&root)).is_empty());
        assert_eq!(signature(&[]), Signature::default());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn notify_waits_to_settle_and_keeps_a_gap() {
        let now = Instant::now();
        // 第一次：等 1.5 秒
        assert_eq!(notify_at(now, None), now + SETTLE);
        // 上次通知是 1 秒前：要等到离上次满 5 秒
        let recent = now - Duration::from_secs(1);
        assert_eq!(notify_at(now, Some(recent)), recent + MIN_GAP);
        // 上次通知是很久以前：还是只等 1.5 秒
        let long_ago = now - Duration::from_secs(60);
        assert_eq!(notify_at(now, Some(long_ago)), now + SETTLE);
    }

    #[test]
    fn expands_home_prefix() {
        let home = Path::new(r"C:\Users\me");
        assert_eq!(expand_home("~/.claude", Some(home)), home.join(".claude"));
        assert_eq!(
            expand_home(r"D:\claude", Some(home)),
            PathBuf::from(r"D:\claude")
        );
    }
}
