//! 哪些会话不是订阅：Claude Code 只在订阅（Pro / Max）会话里给状态栏传 rate_limits（5h / 7 天限额），
//! 状态栏每刷新一次看一眼——已经有回复（花过 API 时间）却没带限额，就是 API key 或中转。
//! 估订阅额度值多少钱时把这些会话花的钱剔除，别的会话都当订阅算（前端见 ccusage/plans.ts）。
//!
//! 每个会话一个空文件：数据目录下 plans\<会话 id>.api（非订阅）或 .sub（带过限额），
//! 几个 Claude Code 窗口同时写也不会互相覆盖，已经记过就不再写。订阅优先：刚过重置时间那一会儿
//! Claude Code 也会先不给限额，之后再给时改记成订阅，.api 删掉

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde_json::Value;

use crate::data_dir;

/// 多久以前的记录删掉：估额度最多往前看五周
const KEEP: Duration = Duration::from_secs(60 * 24 * 3600);

fn plans_dir() -> Option<PathBuf> {
    data_dir().map(|d| d.join("plans"))
}

/// 状态栏入口里调用。has_limits：这次的数据里带了 5h / 7 天限额
pub fn record(input: &Value, has_limits: bool) {
    if let Some(dir) = plans_dir() {
        record_in(&dir, input, has_limits);
    }
}

fn record_in(dir: &Path, input: &Value, has_limits: bool) {
    let Some(session) = input.get("session_id").and_then(Value::as_str) else {
        return;
    };
    // 会话 id 是 UUID，只留安全字符当文件名
    let name: String = session
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect();
    if name.is_empty() {
        return;
    }
    let replied = input
        .pointer("/cost/total_api_duration_ms")
        .and_then(Value::as_f64)
        .is_some_and(|ms| ms > 0.0);
    let kind = if has_limits {
        "sub"
    } else if replied {
        "api"
    } else {
        // 还没有回复：订阅会话这时也没有限额，看不出来
        return;
    };
    let path = dir.join(format!("{name}.{kind}"));
    if dir.join(format!("{name}.sub")).exists() || path.exists() {
        return;
    }
    let _ = fs::create_dir_all(dir);
    let _ = fs::write(&path, b"");
    if kind == "sub" {
        let _ = fs::remove_file(dir.join(format!("{name}.api")));
    }
}

/// 认出来的非订阅会话 id。顺便删掉太久以前的记录
#[tauri::command]
pub async fn non_subscription_sessions() -> Vec<String> {
    plans_dir()
        .map(|dir| non_subscription_in(&dir))
        .unwrap_or_default()
}

fn non_subscription_in(dir: &Path) -> Vec<String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| SystemTime::now().duration_since(t).ok())
            .is_some_and(|age| age > KEEP);
        if old {
            let _ = fs::remove_file(&path);
            continue;
        }
        if path.extension().is_some_and(|e| e == "api")
            && let Some(id) = path.file_stem().and_then(|s| s.to_str())
            && !path.with_extension("sub").exists()
        {
            out.push(id.to_string());
        }
    }
    out.sort();
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn tells_subscription_from_api() {
        let dir = std::env::temp_dir().join(format!("ccusage-ui-plans-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let input = |id: &str, api_ms: f64| json!({ "session_id": id, "cost": { "total_api_duration_ms": api_ms } });

        // 还没回复：不记
        record_in(&dir, &input("a", 0.0), false);
        // 有回复、没限额：非订阅
        record_in(&dir, &input("b", 1200.0), false);
        // 带限额：订阅
        record_in(&dir, &input("c", 1200.0), true);
        // 先没限额（刚过重置时间），后来带了：改记成订阅
        record_in(&dir, &input("d", 800.0), false);
        record_in(&dir, &input("d", 2000.0), true);
        // 记成订阅以后又没带限额：还是订阅
        record_in(&dir, &input("c", 3000.0), false);

        assert_eq!(non_subscription_in(&dir), vec!["b".to_string()]);
        let _ = fs::remove_dir_all(&dir);
    }
}
