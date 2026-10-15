//! 大 Dock 的每日冷知识：EasyAPI（api.baiwumm.com）的 /api/cold-fact，随机一条中文冷知识，不用密钥。
//! 一天只请求一次：请求过的日子和取到的那条记在数据目录的 cold-fact.json，同一天再问直接给记下的。
//! 接口不允许网页跨域，所以在这边用系统自带的 curl.exe 取

use std::fs;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{data_dir, write_atomic};

const URL: &str = "https://api.baiwumm.com/api/cold-fact";
const FILE: &str = "cold-fact.json";

/// 一条冷知识
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ColdFact {
    content: String,
    /// 分类，比如"食物"；接口没给就是空的
    category: String,
}

/// 存下来的：最近一次请求是哪天（YYYY-MM-DD，前端给的本地日期），最近取到的那条
#[derive(Debug, Default, Serialize, Deserialize)]
struct Saved {
    date: String,
    fact: Option<ColdFact>,
}

/// 两处同时来问（刚打开时页面加载和窗口获得焦点几乎同时）时排队，免得同一天请求两次
static ASKING: Mutex<()> = Mutex::new(());

/// 今天的冷知识。今天还没请求过就请求一次：不管成不成功都记下今天问过了，当天不再请求；没取到就接着给上一条
#[tauri::command]
pub async fn cold_fact(today: String) -> Option<ColdFact> {
    let _queue = ASKING.lock().unwrap_or_else(|e| e.into_inner());
    let dir = data_dir()?;
    let path = dir.join(FILE);
    let mut saved: Saved = fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    if saved.date != today {
        if let Some(fact) = fetch() {
            saved.fact = Some(fact);
        }
        saved.date = today;
        let _ = fs::create_dir_all(&dir);
        if let Ok(text) = serde_json::to_string(&saved) {
            let _ = write_atomic(&path, text.as_bytes());
        }
    }
    saved.fact
}

/// 请求一次接口；连不上、超时（10 秒）、返回不对都是 None
fn fetch() -> Option<ColdFact> {
    let mut cmd = Command::new("curl.exe");
    cmd.args(["-fsS", "--max-time", "10", URL])
        .stdin(Stdio::null());
    crate::ccusage::no_window(&mut cmd);
    let out = crate::ccusage::output_with_timeout(&mut cmd, Duration::from_secs(15)).ok()?;
    if !out.status.success() {
        return None;
    }
    parse(&out.stdout)
}

/// 接口返回 { code, msg, data: { content, category, source }, timestamp }，code 为 200 才算成功
fn parse(body: &[u8]) -> Option<ColdFact> {
    let v: Value = serde_json::from_slice(body).ok()?;
    if v.get("code")?.as_i64()? != 200 {
        return None;
    }
    let data = v.get("data")?;
    let content = data.get("content")?.as_str()?.trim();
    if content.is_empty() {
        return None;
    }
    Some(ColdFact {
        content: content.to_string(),
        category: data
            .get("category")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_api_response() {
        // 2026-10-15 实际请求到的一条
        let body = r#"{"data":{"content":"蜂蜜永远不会变质，考古学家在古埃及金字塔中发现过3000年仍可食用的蜂蜜。","category":"食物","source":"食品科学"},"msg":"请求成功","code":200,"timestamp":1792029725724}"#;
        assert_eq!(
            parse(body.as_bytes()),
            Some(ColdFact {
                content: "蜂蜜永远不会变质，考古学家在古埃及金字塔中发现过3000年仍可食用的蜂蜜。"
                    .into(),
                category: "食物".into(),
            })
        );
    }

    #[test]
    fn rejects_failures() {
        // 失败时 data 为 null；限流时返回的是纯文本
        assert_eq!(parse(br#"{"data":null,"msg":"failed","code":500}"#), None);
        assert_eq!(parse(b"Too Many Requests"), None);
        assert_eq!(parse(br#"{"data":{"content":"  "},"code":200}"#), None);
    }
}
