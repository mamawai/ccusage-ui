//! 生成速度（tok/s），算法照 claude-hud：一条回复的输出 token ÷ 这条回复花掉的 API 时间。
//! 两个数都来自 Claude Code 给状态栏的数据：current_usage.output_tokens 只在一条回复结束时变，
//! cost.total_api_duration_ms 同时加上这次请求的耗时，两次之间的差就是这条回复的 API 时间。
//! 子代理的请求不改主对话的 usage，它们的 API 时间只并进基准，不算到下一条回复头上。
//!
//! 状态栏是 Claude Code 每个窗口各跑各的，所以每个会话一个文件（数据目录下 speed\<会话 id>.json），
//! 互不覆盖；程序读的时候把所有会话最近的样本合起来

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{data_dir, write_atomic};

/// 短于这个 API 时间的样本基本是噪声（claude-hud 也是这么定的）
const MIN_API_MS: f64 = 500.0;
/// 平均速度看多久以内的回复；更早的样本删掉
const RECENT_MS: i64 = 60 * 60_000;
/// 每个会话最多留几个样本，只是防止文件无限变大（一小时远到不了这么多条）
const MAX_SAMPLES: usize = 2000;
/// 多久没动的会话文件删掉
const STALE: Duration = Duration::from_secs(7 * 24 * 3600);

/// 一条回复：什么时候结束、输出了多少 token、花了多少 API 时间
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Sample {
    at: i64,
    tokens: f64,
    ms: f64,
}

/// 一个会话的记录：上次看到的 API 总耗时和 usage（判断有没有新回复），以及最近的样本
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct State {
    api_ms: f64,
    usage_key: String,
    samples: Vec<Sample>,
}

fn speed_dir() -> Option<PathBuf> {
    data_dir().map(|d| d.join("speed"))
}

/// 状态栏入口里调用：有新回复就记一个样本
pub fn record(input: &Value) {
    let Some(dir) = speed_dir() else { return };
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
    let path = dir.join(format!("{name}.json"));
    let previous = fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok());
    if let Some(next) = step(previous, input, now_ms()) {
        let _ = fs::create_dir_all(&dir);
        if let Ok(text) = serde_json::to_string(&next) {
            let _ = write_atomic(&path, text.as_bytes());
        }
    }
}

/// 算下一步的记录；None 表示不用写（数据不全，或者和上次一样）
fn step(previous: Option<State>, input: &Value, now: i64) -> Option<State> {
    let api_ms = input
        .pointer("/cost/total_api_duration_ms")
        .and_then(Value::as_f64)?;
    // 会话刚开始、还没有回复时 current_usage 是 null：按 0 记个起点，不然第一条回复只能拿来当起点、算不进去
    let usage = input
        .pointer("/context_window/current_usage")
        .filter(|u| u.is_object());
    let count = |key: &str| {
        usage
            .and_then(|u| u.get(key))
            .and_then(Value::as_f64)
            .filter(|v| *v >= 0.0)
            .unwrap_or(0.0)
    };
    let output = count("output_tokens");
    let usage_key = [
        "input_tokens",
        "output_tokens",
        "cache_creation_input_tokens",
        "cache_read_input_tokens",
    ]
    .map(|k| count(k).to_string())
    .join(":");

    let Some(mut state) = previous else {
        // 第一次见到这个会话：只记起点
        return Some(State {
            api_ms,
            usage_key,
            samples: Vec::new(),
        });
    };
    if api_ms == state.api_ms {
        return None;
    }
    // 计数变小了（比如 resume 进了新进程，从 0 开始算）：只重新记起点，已有的样本留着
    if api_ms > state.api_ms {
        let delta = api_ms - state.api_ms;
        if usage_key != state.usage_key && output > 0.0 && delta >= MIN_API_MS {
            state.samples.push(Sample {
                at: now,
                tokens: output,
                ms: delta,
            });
        }
    }
    // 只留近 1 小时的
    state.samples.retain(|s| now - s.at <= RECENT_MS);
    let extra = state.samples.len().saturating_sub(MAX_SAMPLES);
    state.samples.drain(..extra);
    state.api_ms = api_ms;
    state.usage_key = usage_key;
    Some(state)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Speed {
    /// 最近一条回复的速度
    last: f64,
    /// 近 1 小时所有回复合起来的平均速度（总 token ÷ 总 API 时间）
    avg: f64,
}

/// 近 1 小时的生成速度；这段时间没有回复就是 None。async：读文件放到后台线程，不占界面的主线程
#[tauri::command]
pub async fn speed_read() -> Option<Speed> {
    let dir = speed_dir()?;
    let mut samples = Vec::new();
    for entry in fs::read_dir(&dir).ok()?.flatten() {
        let path = entry.path();
        // 只读会话文件；写到一半被打断留下的 .tmp 不算，不然样本会重复
        if path.extension().is_none_or(|ext| ext != "json") {
            continue;
        }
        let age = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok());
        // 一周没动的会话文件顺手清掉；一小时没动的里面不会有近 1 小时的样本，不用读
        if age.is_some_and(|age| age > STALE) {
            let _ = fs::remove_file(&path);
            continue;
        }
        if age.is_some_and(|age| age.as_millis() > RECENT_MS as u128) {
            continue;
        }
        if let Some(state) = read_state(&path) {
            samples.extend(state.samples);
        }
    }
    summarize(&samples, now_ms())
}

fn read_state(path: &Path) -> Option<State> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

fn summarize(samples: &[Sample], now: i64) -> Option<Speed> {
    let recent: Vec<&Sample> = samples.iter().filter(|s| now - s.at <= RECENT_MS).collect();
    let last = recent.iter().max_by_key(|s| s.at)?;
    let tokens: f64 = recent.iter().map(|s| s.tokens).sum();
    let ms: f64 = recent.iter().map(|s| s.ms).sum();
    Some(Speed {
        last: last.tokens / (last.ms / 1000.0),
        avg: tokens / (ms / 1000.0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn input(output: u64, cache_read: u64, api_ms: u64) -> Value {
        json!({
            "context_window": { "current_usage": {
                "input_tokens": 3, "output_tokens": output, "cache_creation_input_tokens": 10, "cache_read_input_tokens": cache_read
            }},
            "cost": { "total_api_duration_ms": api_ms }
        })
    }

    #[test]
    fn records_one_sample_per_response() {
        // 第一次：只记基准
        let s = step(None, &input(100, 1000, 10_000), 1).unwrap();
        assert!(s.samples.is_empty());
        // 新回复：输出 400 token，API 时间多了 4 秒 → 100 tok/s
        let s = step(Some(s), &input(400, 1100, 14_000), 2).unwrap();
        assert_eq!(
            s.samples,
            vec![Sample {
                at: 2,
                tokens: 400.0,
                ms: 4000.0
            }]
        );
        // 状态栏又刷了一次但没有新回复：不用写
        assert!(step(Some(s), &input(400, 1100, 14_000), 3).is_none());
    }

    #[test]
    fn subagent_time_only_moves_the_baseline() {
        let s = step(None, &input(100, 1000, 10_000), 1).unwrap();
        // usage 没变、API 时间多了（子代理在跑）：不记样本，只挪基准
        let s = step(Some(s), &input(100, 1000, 30_000), 2).unwrap();
        assert!(s.samples.is_empty() && s.api_ms == 30_000.0);
        // 太短的不算
        let s = step(Some(s), &input(50, 1200, 30_300), 3).unwrap();
        assert!(s.samples.is_empty());
    }

    #[test]
    fn first_reply_of_a_new_session_counts() {
        // 会话刚开始：current_usage 还是 null，API 时间 0
        let fresh = json!({ "context_window": { "current_usage": null }, "cost": { "total_api_duration_ms": 0 } });
        let s = step(None, &fresh, 1).unwrap();
        // 第一条回复：300 token、3 秒
        let s = step(Some(s), &input(300, 0, 3_000), 2).unwrap();
        assert_eq!(
            s.samples,
            vec![Sample {
                at: 2,
                tokens: 300.0,
                ms: 3000.0
            }]
        );
    }

    #[test]
    fn reset_keeps_samples_and_old_ones_expire() {
        let s = step(None, &input(100, 1000, 10_000), 1).unwrap();
        let s = step(Some(s), &input(400, 1100, 14_000), 2).unwrap();
        // 计数变小（resume 进了新进程）：只重新记起点，样本留着
        let s = step(Some(s), &input(80, 0, 1_000), 3).unwrap();
        assert_eq!(s.samples.len(), 1);
        assert_eq!(s.api_ms, 1_000.0);
        // 一小时以前的样本删掉（这次 usage 没变，只是子代理花了时间，不算新回复）
        let s = step(Some(s), &input(80, 0, 2_000), RECENT_MS + 10).unwrap();
        assert!(s.samples.is_empty());
    }

    #[test]
    fn summary_uses_the_last_hour() {
        let samples = [
            Sample {
                at: 0,
                tokens: 999.0,
                ms: 1000.0,
            },
            Sample {
                at: RECENT_MS,
                tokens: 300.0,
                ms: 3000.0,
            },
            Sample {
                at: RECENT_MS + 10,
                tokens: 600.0,
                ms: 3000.0,
            },
        ];
        let speed = summarize(&samples, RECENT_MS + 20).unwrap();
        assert_eq!(
            speed,
            Speed {
                last: 200.0,
                avg: 150.0
            }
        );
        assert!(summarize(&samples, 10 * RECENT_MS).is_none());
    }
}
