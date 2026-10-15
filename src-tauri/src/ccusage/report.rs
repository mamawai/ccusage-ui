//! 界面用到的几种 ccusage 报表，以及它们对应的命令行参数。
//! 前端只能从这几种里选，不能传任意参数（比如 --jq 会去启动别的程序）。

use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Report {
    /// ccusage claude daily；instances 为 true 时按项目分组
    ClaudeDaily {
        #[serde(default)]
        instances: bool,
    },
    /// ccusage claude weekly
    ClaudeWeekly { start_of_week: Option<WeekDay> },
    /// ccusage claude monthly
    ClaudeMonthly,
    /// ccusage claude session
    ClaudeSession,
    /// ccusage claude session --id：单个会话的逐次调用
    ClaudeSessionDetail { id: String },
    /// ccusage claude blocks：5 小时窗口。不传 --token-limit：限额用 Claude Code 给的官方数据，不用 ccusage 估的。
    /// sessionLength 是块的小时数，默认 5；填 1 就是按整点小时分桶（概览页"今天"按小时显示用）
    ClaudeBlocks { session_length: Option<u8> },
    /// 全部 Agent 的合并报表：ccusage <第一个 section> --by-agent --sections ...
    AllAgents { sections: Vec<Section> },
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WeekDay {
    Sunday,
    Monday,
    Tuesday,
    Wednesday,
    Thursday,
    Friday,
    Saturday,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Section {
    Daily,
    Weekly,
    Monthly,
    Session,
}

/// 各报表通用的选项
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Options {
    /// YYYYMMDD
    pub since: Option<String>,
    /// YYYYMMDD
    pub until: Option<String>,
    /// IANA 时区名，比如 Asia/Shanghai；不填就跟随系统
    pub timezone: Option<String>,
    /// 用 ccusage 内置的价格，不联网拉最新价格
    pub offline: bool,
}

impl WeekDay {
    fn as_str(self) -> &'static str {
        match self {
            Self::Sunday => "sunday",
            Self::Monday => "monday",
            Self::Tuesday => "tuesday",
            Self::Wednesday => "wednesday",
            Self::Thursday => "thursday",
            Self::Friday => "friday",
            Self::Saturday => "saturday",
        }
    }
}

impl Section {
    fn as_str(self) -> &'static str {
        match self {
            Self::Daily => "daily",
            Self::Weekly => "weekly",
            Self::Monthly => "monthly",
            Self::Session => "session",
        }
    }
}

/// 把报表请求翻译成 ccusage 的命令行参数，顺带检查前端传来的值
pub fn args(report: &Report, opts: &Options) -> Result<Vec<String>, String> {
    let mut args: Vec<String> = match report {
        Report::ClaudeDaily { instances } => {
            let mut a = vec!["claude".into(), "daily".into()];
            if *instances {
                a.push("--instances".into());
            }
            a
        }
        Report::ClaudeWeekly { start_of_week } => {
            let mut a = vec!["claude".into(), "weekly".into()];
            if let Some(day) = start_of_week {
                a.extend(["--start-of-week".into(), day.as_str().into()]);
            }
            a
        }
        Report::ClaudeMonthly => vec!["claude".into(), "monthly".into()],
        Report::ClaudeSession => vec!["claude".into(), "session".into()],
        Report::ClaudeSessionDetail { id } => {
            check(
                id,
                128,
                |c| c.is_ascii_alphanumeric() || c == '-' || c == '_',
                "id",
            )?;
            vec!["claude".into(), "session".into(), "--id".into(), id.clone()]
        }
        Report::ClaudeBlocks { session_length } => {
            let mut a = vec!["claude".into(), "blocks".into()];
            if let Some(hours) = session_length {
                if !(1..=24).contains(hours) {
                    return Err(format!("sessionLength: {hours}"));
                }
                a.extend(["--session-length".into(), hours.to_string()]);
            }
            a
        }
        Report::AllAgents { sections } => {
            let Some(first) = sections.first() else {
                return Err("sections: empty".into());
            };
            let mut a = vec![first.as_str().into(), "--by-agent".into()];
            if sections.len() > 1 {
                let all: Vec<&str> = sections.iter().map(|s| s.as_str()).collect();
                a.extend(["--sections".into(), all.join(",")]);
            }
            a
        }
    };

    args.push("--json".into());
    if let Some(since) = &opts.since {
        check_date(since)?;
        args.extend(["--since".into(), since.clone()]);
    }
    if let Some(until) = &opts.until {
        check_date(until)?;
        args.extend(["--until".into(), until.clone()]);
    }
    if let Some(tz) = &opts.timezone {
        check(
            tz,
            64,
            |c| c.is_ascii_alphanumeric() || "/_+-".contains(c),
            "timezone",
        )?;
        args.extend(["--timezone".into(), tz.clone()]);
    }
    if opts.offline {
        args.push("--offline".into());
    }
    Ok(args)
}

fn check_date(value: &str) -> Result<(), String> {
    if value.len() == 8 && value.chars().all(|c| c.is_ascii_digit()) {
        Ok(())
    } else {
        Err(format!("date (YYYYMMDD): {value}"))
    }
}

// 报错里只写是哪个字段、值是什么，整句话由前端按语言拼
fn check(value: &str, max_len: usize, ok: impl Fn(char) -> bool, what: &str) -> Result<(), String> {
    if !value.is_empty() && value.len() <= max_len && value.chars().all(ok) {
        Ok(())
    } else {
        Err(format!("{what}: {value}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> Report {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn claude_daily_with_options() {
        let opts = Options {
            since: Some("20261001".into()),
            timezone: Some("Asia/Shanghai".into()),
            offline: true,
            ..Default::default()
        };
        let a = args(&parse(r#"{"kind":"claudeDaily"}"#), &opts).unwrap();
        assert_eq!(
            a,
            [
                "claude",
                "daily",
                "--json",
                "--since",
                "20261001",
                "--timezone",
                "Asia/Shanghai",
                "--offline"
            ]
        );
    }

    #[test]
    fn claude_daily_by_project() {
        let a = args(
            &parse(r#"{"kind":"claudeDaily","instances":true}"#),
            &Options::default(),
        )
        .unwrap();
        assert_eq!(a, ["claude", "daily", "--instances", "--json"]);
    }

    #[test]
    fn claude_weekly_start_of_week() {
        let a = args(
            &parse(r#"{"kind":"claudeWeekly","startOfWeek":"monday"}"#),
            &Options::default(),
        )
        .unwrap();
        assert_eq!(
            a,
            ["claude", "weekly", "--start-of-week", "monday", "--json"]
        );
    }

    #[test]
    fn claude_blocks() {
        let a = args(&parse(r#"{"kind":"claudeBlocks"}"#), &Options::default()).unwrap();
        assert_eq!(a, ["claude", "blocks", "--json"]);
    }

    #[test]
    fn claude_blocks_hourly() {
        let opts = Options {
            since: Some("20261014".into()),
            ..Default::default()
        };
        let a = args(
            &parse(r#"{"kind":"claudeBlocks","sessionLength":1}"#),
            &opts,
        )
        .unwrap();
        assert_eq!(
            a,
            [
                "claude",
                "blocks",
                "--session-length",
                "1",
                "--json",
                "--since",
                "20261014"
            ]
        );
        for bad in [0, 25] {
            let json = format!(r#"{{"kind":"claudeBlocks","sessionLength":{bad}}}"#);
            assert!(args(&parse(&json), &Options::default()).is_err());
        }
    }

    #[test]
    fn claude_session_detail() {
        let id = "0af42152-6e8f-4239-a4ca-ff83ac89dae4";
        let a = args(
            &parse(&format!(r#"{{"kind":"claudeSessionDetail","id":"{id}"}}"#)),
            &Options::default(),
        )
        .unwrap();
        assert_eq!(a, ["claude", "session", "--id", id, "--json"]);
        assert!(
            args(
                &parse(r#"{"kind":"claudeSessionDetail","id":"a b"}"#),
                &Options::default()
            )
            .is_err()
        );
        assert!(
            args(
                &parse(r#"{"kind":"claudeSessionDetail","id":""}"#),
                &Options::default()
            )
            .is_err()
        );
    }

    #[test]
    fn all_agents_sections() {
        let a = args(
            &parse(r#"{"kind":"allAgents","sections":["daily","session"]}"#),
            &Options::default(),
        )
        .unwrap();
        assert_eq!(
            a,
            [
                "daily",
                "--by-agent",
                "--sections",
                "daily,session",
                "--json"
            ]
        );
        let a = args(
            &parse(r#"{"kind":"allAgents","sections":["monthly"]}"#),
            &Options::default(),
        )
        .unwrap();
        assert_eq!(a, ["monthly", "--by-agent", "--json"]);
        assert!(
            args(
                &parse(r#"{"kind":"allAgents","sections":[]}"#),
                &Options::default()
            )
            .is_err()
        );
    }

    #[test]
    fn unknown_values_rejected() {
        assert!(serde_json::from_str::<Report>(r#"{"kind":"claudeStatusline"}"#).is_err());
        assert!(
            serde_json::from_str::<Report>(r#"{"kind":"allAgents","sections":["blocks"]}"#)
                .is_err()
        );
        let bad_date = Options {
            since: Some("2026-10-01".into()),
            ..Default::default()
        };
        assert!(args(&parse(r#"{"kind":"claudeMonthly"}"#), &bad_date).is_err());
        let bad_tz = Options {
            timezone: Some("Asia/Shang hai".into()),
            ..Default::default()
        };
        assert!(args(&parse(r#"{"kind":"claudeMonthly"}"#), &bad_tz).is_err());
    }
}
