use std::time::Duration;
pub mod hardware;
pub mod home;
pub mod hud;
pub mod onboarding;
pub mod other_games;
pub mod quick_launch;
pub mod settings;
pub mod steam;
pub mod tools;

/// 共享连接池；后续网络服务通过 State 注入，避免每个请求重新构造客户端。
pub struct AppState {
    pub _http: reqwest::Client,
}

impl AppState {
    pub fn new() -> Result<Self, reqwest::Error> {
        Ok(Self {
            _http: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(30))
                .user_agent(concat!("zhenjing/", env!("CARGO_PKG_VERSION")))
                .build()?,
        })
    }
}
