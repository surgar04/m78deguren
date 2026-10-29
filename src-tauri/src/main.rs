// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
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
