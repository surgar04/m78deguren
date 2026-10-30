use super::*;
fn session() -> Session {
    Session {
        id: uuid::Uuid::new_v4().to_string(),
        game_id: uuid::Uuid::new_v4().to_string(),
        game_name: "测试国服游戏".into(),
        phase: Phase::Waiting,
        message: String::new(),
        created_at: 100,
        confirmed_at: None,
        client_instance: Some((10, 20)),
        game_path: "D:\\Game\\Game.exe".into(),
        launch_target: ("D:\\Game\\Game.exe".into(), None),
        client: Client {
            path: "D:\\QuickFox\\QuickFox.exe".into(),
            version: "1".into(),
            publisher: "厦门科臻赛科技有限公司".into(),
            sha256: "a".repeat(64),
        },
        misses: 0,
    }
}
fn rows() -> native::Processes {
    vec![("D:\\QuickFox\\QuickFox.exe".into(), 10, 20)]
}
#[test]
fn client_process_is_not_confirmation_or_acceleration() {
    let mut value = session();
    advance(&mut value, &rows(), 101);
    assert_eq!(value.phase, Phase::Waiting);
    assert!(value.confirmed_at.is_none());
}
#[test]
fn client_restart_and_timeout_invalidate_preparation() {
    let mut value = session();
    let mut changed = rows();
    changed[0].2 = 21;
    advance(&mut value, &changed, 101);
    assert_eq!(value.phase, Phase::Failed);
    let mut value = session();
    advance(&mut value, &rows(), 701);
    assert_eq!(value.phase, Phase::Failed);
}
#[test]
fn process_names_from_other_directories_never_count_as_game() {
    let mut value = session();
    value.phase = Phase::LaunchRequested;
    value.confirmed_at = Some(101);
    let mut processes = rows();
    processes.push(("E:\\Fake\\Game.exe".into(), 30, 100));
    advance(&mut value, &processes, 110);
    assert_eq!(value.phase, Phase::LaunchRequested);
    processes.push((value.game_path.clone(), 31, 102));
    advance(&mut value, &processes, 111);
    assert_eq!(value.phase, Phase::Playing);
    advance(&mut value, &rows(), 112);
    advance(&mut value, &rows(), 114);
    assert_eq!(value.phase, Phase::Playing);
    advance(&mut value, &rows(), 116);
    assert_eq!(value.phase, Phase::Finished);
}
#[test]
fn cancelled_ticket_never_advances_even_if_game_appears() {
    let mut value = session();
    value.phase = Phase::Cancelled;
    let mut processes = rows();
    processes.push((value.game_path.clone(), 31, 102));
    advance(&mut value, &processes, 110);
    assert_eq!(value.phase, Phase::Cancelled);
}
#[test]
fn request_rejects_arbitrary_paths_and_extra_arguments() {
    use crate::commands::acceleration::Request;
    assert!(
        serde_json::from_value::<Request>(
            serde_json::json!({"operation":"prepare","gameId":"test","path":"D:\\evil.exe"})
        )
        .is_err()
    );
    assert!(
        serde_json::from_value::<Request>(serde_json::json!({"operation":"open","args":"--evil"}))
            .is_err()
    );
}
