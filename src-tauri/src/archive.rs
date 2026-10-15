//! 按天存档：Claude Code 默认会删 30 天前的日志，删了 ccusage 就读不到了。
//! 前端每次完整取完账本，都和存档合一遍再存回来（合并规则在 src/ccusage/archive.ts），日志删了那几天的数也还在。
//! 这里只管读写文件，内容是什么由前端定。Claude Code 的账本和全部 Agent 的账本分两个文件，各写各的，互不覆盖

use std::fs;

use serde::Deserialize;
use serde_json::Value;

use crate::limits::{claude_dir, home_dir};
use crate::{data_dir, write_atomic};

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Section {
    /// Claude Code 的日报行（按项目拆开）
    Claude,
    /// 全部 Agent 的日报行
    Agents,
}

impl Section {
    fn file(self) -> &'static str {
        match self {
            Self::Claude => "archive-claude.json",
            Self::Agents => "archive-agents.json",
        }
    }
}

/// 读存档；还没有就是 None。存档有几百 KB，几个命令都用 async，读写放到后台线程，不占界面的主线程
#[tauri::command]
pub async fn archive_read(section: Section) -> Result<Option<Value>, String> {
    let path = data_dir().ok_or("APPDATA")?.join(section.file());
    match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text)
            .map(Some)
            .map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn archive_write(section: Section, data: Value) -> Result<(), String> {
    let dir = data_dir().ok_or("APPDATA")?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string(&data).map_err(|e| e.to_string())?;
    write_atomic(&dir.join(section.file()), text.as_bytes()).map_err(|e| e.to_string())
}

/// Claude Code 保留几天的日志：settings.json 里的 cleanupPeriodDays，没设就是 30 天。
/// 这几天里的日志是全的，直接用 ccusage 的数；更早的日子可能被删掉了一部分，才用存档补
#[tauri::command]
pub async fn claude_log_days() -> u32 {
    let days = home_dir()
        .map(|home| claude_dir(&home).join("settings.json"))
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|settings| settings.get("cleanupPeriodDays")?.as_u64());
    days.map_or(30, |d| d.clamp(1, 100_000) as u32)
}
