//! 从 CC Switch 导入历史用量。CC Switch 会定期把 Claude Code 等工具的日志同步进自己的库（~/.cc-switch/cc-switch.db），
//! 所以 Claude Code 删掉的旧日志它那里还有。这里只读（不改）它的库，按"天、工具、模型"汇总成 token 和费用交给前端，
//! 怎么并进存档由前端定（src/ccusage/archive.ts）。
//!
//! 用到两张表：proxy_request_logs 是最近的逐条记录（created_at 是 Unix 秒），usage_daily_rollups 是更早的按天汇总。
//! input_token_semantics = 1 的记录，输入 token 里含了缓存读取（OpenAI 那种算法），减掉，和 ccusage 的口径一致

use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use tauri::{AppHandle, Manager};

/// CC Switch 里某一天、某个工具、某个模型的用量
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchUsage {
    /// YYYY-MM-DD（本地日期）
    date: String,
    /// CC Switch 的工具名：claude、codex、gemini、grokbuild……
    app: String,
    model: String,
    input_tokens: i64,
    output_tokens: i64,
    cache_creation_tokens: i64,
    cache_read_tokens: i64,
    /// CC Switch 记下的费用（美元）
    cost: f64,
}

const QUERY: &str = "
SELECT d, app, model,
       COALESCE(SUM(i), 0), COALESCE(SUM(o), 0), COALESCE(SUM(cw), 0), COALESCE(SUM(cr), 0), TOTAL(c)
FROM (
  SELECT date(created_at, 'unixepoch', 'localtime') AS d, app_type AS app, COALESCE(model, '') AS model,
         CASE WHEN input_token_semantics = 1 THEN MAX(input_tokens - cache_read_tokens, 0) ELSE input_tokens END AS i,
         output_tokens AS o, cache_creation_tokens AS cw, cache_read_tokens AS cr,
         CAST(total_cost_usd AS REAL) AS c
  FROM proxy_request_logs
  UNION ALL
  SELECT date, app_type, COALESCE(model, ''),
         CASE WHEN input_token_semantics = 1 THEN MAX(input_tokens - cache_read_tokens, 0) ELSE input_tokens END,
         output_tokens, cache_creation_tokens, cache_read_tokens,
         CAST(total_cost_usd AS REAL)
  FROM usage_daily_rollups
)
GROUP BY d, app, model
HAVING SUM(i) + SUM(o) + SUM(cw) + SUM(cr) > 0
ORDER BY d, app, model";

fn db_path(home: &Path) -> PathBuf {
    home.join(".cc-switch").join("cc-switch.db")
}

/// 本机装了 CC Switch 就返回它的库的路径
#[tauri::command]
pub async fn ccswitch_detect(app: AppHandle) -> Option<String> {
    let path = db_path(&app.path().home_dir().ok()?);
    path.is_file().then(|| path.to_string_lossy().into_owned())
}

/// async：汇总整个库要一会儿，CC Switch 正在写时还会等它最多 3 秒，放到后台线程，不卡两个窗口
#[tauri::command]
pub async fn ccswitch_read(app: AppHandle) -> Result<Vec<SwitchUsage>, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    read(&db_path(&home)).map_err(|e| e.to_string())
}

fn read(path: &Path) -> rusqlite::Result<Vec<SwitchUsage>> {
    // 只读打开：CC Switch 开着也没关系，不会锁它、改它
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    conn.busy_timeout(Duration::from_secs(3))?;
    query(&conn)
}

fn query(conn: &Connection) -> rusqlite::Result<Vec<SwitchUsage>> {
    let mut stmt = conn.prepare(QUERY)?;
    let rows = stmt.query_map([], |r| {
        Ok(SwitchUsage {
            date: r.get(0)?,
            app: r.get(1)?,
            model: r.get(2)?,
            input_tokens: r.get(3)?,
            output_tokens: r.get(4)?,
            cache_creation_tokens: r.get(5)?,
            cache_read_tokens: r.get(6)?,
            cost: r.get(7)?,
        })
    })?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 建两张和 CC Switch 一样的表（只建用到的列），塞几条记录，看汇总对不对
    #[test]
    fn sums_logs_and_rollups() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE proxy_request_logs (app_type TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER,
               cache_read_tokens INTEGER, cache_creation_tokens INTEGER, total_cost_usd TEXT, created_at INTEGER,
               input_token_semantics INTEGER);
             CREATE TABLE usage_daily_rollups (date TEXT, app_type TEXT, model TEXT, request_count INTEGER, input_tokens INTEGER,
               output_tokens INTEGER, cache_read_tokens INTEGER, cache_creation_tokens INTEGER, total_cost_usd TEXT,
               input_token_semantics INTEGER);
             -- 2026-10-01 12:00 UTC 前后各一条，同一天同一个模型要合成一行
             INSERT INTO proxy_request_logs VALUES ('claude', 'claude-opus-5-5', 10, 100, 1000, 50, '1.5', 1790856000, 0);
             INSERT INTO proxy_request_logs VALUES ('claude', 'claude-opus-5-5', 5, 20, 300, 0, '0.5', 1790856060, 0);
             -- 输入里含缓存读取的：要减掉
             INSERT INTO proxy_request_logs VALUES ('grokbuild', 'grok-4', 800, 10, 600, 0, '0.1', 1790856000, 1);
             -- 早的按天汇总
             INSERT INTO usage_daily_rollups VALUES ('2026-01-07', 'claude', 'claude-opus-4-5', 30, 7, 70, 7000, 700, '12.25', 0);
             -- 全是 0 的不要
             INSERT INTO usage_daily_rollups VALUES ('2026-01-08', 'codex', 'gpt-5', 3, 0, 0, 0, 0, '0', 2);",
        )
        .unwrap();
        let rows = query(&conn).unwrap();
        assert_eq!(rows.len(), 3);
        let old = &rows[0];
        assert_eq!(
            (old.date.as_str(), old.app.as_str()),
            ("2026-01-07", "claude")
        );
        assert_eq!(old.cost, 12.25);
        let opus = rows.iter().find(|r| r.model == "claude-opus-5-5").unwrap();
        assert_eq!(
            (
                opus.input_tokens,
                opus.output_tokens,
                opus.cache_read_tokens
            ),
            (15, 120, 1300)
        );
        assert_eq!(opus.cost, 2.0);
        let grok = rows.iter().find(|r| r.app == "grokbuild").unwrap();
        assert_eq!((grok.input_tokens, grok.cache_read_tokens), (200, 600));
    }

    /// 读本机真实的 CC Switch 库，打印 Claude Code 的合计：cargo test real_ccswitch -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_ccswitch() {
        let home = PathBuf::from(std::env::var_os("USERPROFILE").unwrap());
        let rows = read(&db_path(&home)).unwrap();
        let claude = rows.iter().filter(|r| r.app == "claude");
        let (tokens, cost) = claude.fold((0i64, 0f64), |(t, c), r| {
            (
                t + r.input_tokens
                    + r.output_tokens
                    + r.cache_creation_tokens
                    + r.cache_read_tokens,
                c + r.cost,
            )
        });
        println!("rows {} · claude {tokens} tokens · ${cost:.2}", rows.len());
        assert!(tokens > 0);
    }
}
