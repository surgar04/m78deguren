// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(debug_assertions)]
    if std::env::args_os()
        .nth(1)
        .is_some_and(|arg| arg == "--verify-music-sandbox")
    {
        if let Err(cause) = zhenjing_lib::verify_music_sandbox() {
            eprintln!("Music verification failed: {cause}");
            std::process::exit(1);
        }
        return;
    }
    match zhenjing_lib::handle_uninstall() {
        Ok(true) => {}
        Ok(false) => zhenjing_lib::run(),
        Err(cause) => {
            eprintln!("无法启动卸载：{cause}");
            rfd::MessageDialog::new()
                .set_title("臻境无法启动卸载")
                .set_level(rfd::MessageLevel::Error)
                .set_description(format!("{cause}\n未删除应用或用户数据。"))
                .show();
            std::process::exit(1);
        }
    }
}
