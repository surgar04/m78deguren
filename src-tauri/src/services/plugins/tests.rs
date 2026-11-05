//! 验证真实边界：不可信归档、签名替换、权限升级、损坏索引及声明式界面。
use super::*;
use ed25519_dalek::{Signer, SigningKey};
use std::io::{Cursor, Write};

fn manifest() -> Result<Manifest> {
    serde_json::from_str(include_str!(
        "../../../../plugins/examples/rust/manifest.json"
    ))
    .map_err(|_| error("fixture"))
}
fn record() -> Result<Record> {
    Ok(Record {
        manifest: manifest()?,
        digest: "a".repeat(64),
        publisher_key: Some("b".repeat(64)),
        grants: vec!["storage".to_owned()],
        enabled: true,
        quarantined: false,
        failures: 0,
        previous: None,
    })
}
#[tokio::test]
async fn uninstall_without_purge_keeps_data_and_recovery_backups() -> Result<()> {
    let temporary = tempfile::tempdir().map_err(io_error)?;
    let state = PluginState::new(temporary.path())?;
    let record = record()?;
    let id = record.manifest.id.clone();
    state
        .registry
        .lock()
        .await
        .records
        .insert(id.clone(), record);
    let active = state.root.join("data").join(&id).join("counter.json");
    let backup = state
        .root
        .join("backups")
        .join(&id)
        .join("a".repeat(64))
        .join("counter.json");
    storage::atomic_write(&active, b"1")?;
    storage::atomic_write(&backup, b"0")?;
    state.uninstall(&id, false, 0, true).await?;
    assert_eq!(storage::read_bounded(&active, 10)?, b"1");
    assert_eq!(storage::read_bounded(&backup, 10)?, b"0");
    Ok(())
}
#[cfg(windows)]
#[tokio::test]
#[ignore = "需要已构建的独立插件宿主"]
async fn native_workflow_parent_group_closure_terminates_host() -> Result<()> {
    use std::process::Stdio;
    let group = isolation::ProcessGroup::new()?;
    let mut command = tokio::process::Command::new(runtime::host_path()?);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .creation_flags(0x08000000);
    let mut child = command.spawn().map_err(io_error)?;
    group.attach(&child)?;
    // stdin 仍保持打开；退出必须由 Job 句柄关闭触发，不能把普通管道 EOF 误当作进程回收证明。
    let input = child
        .stdin
        .take()
        .ok_or_else(|| error("TEST_PROCESS_PIPE"))?;
    assert!(child.try_wait().map_err(io_error)?.is_none());
    drop(group);
    let _status = tokio::time::timeout(Duration::from_secs(5), child.wait())
        .await
        .map_err(|_| error("TEST_PROCESS_GUARD_TIMEOUT"))?
        .map_err(io_error)?;
    // Job 终止可使用成功状态码；判据是 stdin 仍打开时进程已退出，而不是某个特定退出码。
    drop(input);
    Ok(())
}
#[tokio::test]
async fn abandoned_startup_notification_cannot_permanently_block_retries() -> Result<()> {
    let temporary = tempfile::tempdir().map_err(io_error)?;
    let state = PluginState::new(temporary.path())?;
    let record = record()?;
    let id = record.manifest.id.clone();
    let (completion, receiver) = tokio::sync::watch::channel(());
    state.starting.lock().await.insert(
        id.clone(),
        Starting {
            cancellation: CancellationToken::new(),
            completion: receiver,
        },
    );
    drop(completion);
    assert!(state.session(&record).await.is_err());
    assert!(!state.starting.lock().await.contains_key(&id));
    Ok(())
}
#[tokio::test]
async fn cancelled_future_does_not_release_an_inflight_io_lock() -> Result<()> {
    let temporary = tempfile::tempdir().map_err(io_error)?;
    let state = Arc::new(PluginState::new(temporary.path())?);
    let (entered, started) = tokio::sync::oneshot::channel();
    let (release, finish) = std::sync::mpsc::channel();
    let worker = state.clone();
    let pending = tokio::spawn(async move {
        worker
            .data_io(move || {
                let _ = entered.send(());
                finish.recv().map_err(|_| error("TEST_CHANNEL"))?;
                Ok(())
            })
            .await
    });
    started.await.map_err(|_| error("TEST_CHANNEL"))?;
    pending.abort();
    let _ = pending.await;
    assert!(state.data_gate.try_lock().is_err());
    release.send(()).map_err(|_| error("TEST_CHANNEL"))?;
    let _guard = tokio::time::timeout(Duration::from_secs(5), state.data_gate.lock())
        .await
        .map_err(|_| error("TEST_IO_DRAIN"))?;
    Ok(())
}

#[tokio::test]
async fn unrecoverable_transaction_blocks_calls_even_without_index_commit() -> Result<()> {
    let temporary = tempfile::tempdir().map_err(io_error)?;
    let state = PluginState::new(temporary.path())?;
    storage::atomic_write(
        &state.root.join("transactions/test.plugin/journal.json"),
        b"broken",
    )?;
    assert!(state.recover_data().await.is_err());
    assert!(state.snapshot().await.safe_mode);
    assert!(state.available("test.plugin").is_err());
    assert!(state.root.join("safe-mode").is_file());
    Ok(())
}

/// 显式验收测试：界面事件使用 Tauri MockRuntime，安装器、签名、磁盘事务与 Wasm 子进程均为真实实现。
/// 需要先通过 CLI 构建 Rust 示例与独立宿主；不启动系统工具或接触普通用户档案。
#[tokio::test]
#[ignore = "需要 plugins:host 与 plugins:cli build --project plugins/examples/rust"]
async fn native_workflow_install_revoke_migrate_rollback_and_purge() -> Result<()> {
    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .map_err(|_| error("TEST_APP"))?;
    let temporary = tempfile::tempdir().map_err(io_error)?;
    let state = PluginState::new(temporary.path())?;
    let wasm = storage::read_bounded(
        &Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../.cache/plugins-build/org.zhenjing.example-rust/component.wasm"),
        MAX_PACKAGE,
    )?;
    let key = SigningKey::from_bytes(&[9; 32]);
    let build = |manifest: &Manifest| -> Result<Vec<u8>> {
        let metadata = encode(manifest)?;
        let integrity = encode(&BTreeMap::from([(
            "component.wasm",
            package::digest(&wasm),
        )]))?;
        let to_hex = |bytes: &[u8]| bytes.iter().map(|v| format!("{v:02x}")).collect::<String>();
        let seal = encode(
            &json!({"publicKey":to_hex(key.verifying_key().as_bytes()),"signature":to_hex(&key.sign(&package::signed_message(&metadata,&integrity)).to_bytes())}),
        )?;
        let mut archive = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in [
            ("manifest.json", metadata.as_slice()),
            ("integrity.json", integrity.as_slice()),
            ("signature.json", seal.as_slice()),
            ("component.wasm", wasm.as_slice()),
        ] {
            archive
                .start_file(name, zip::write::SimpleFileOptions::default())
                .map_err(|_| error("TEST_ZIP"))?;
            archive.write_all(bytes).map_err(io_error)?;
        }
        Ok(archive
            .finish()
            .map_err(|_| error("TEST_ZIP"))?
            .into_inner())
    };
    let mut manifest = manifest()?;
    manifest.permissions.push(model::Permission {
        id: "background".to_owned(),
        reason: "验证任务执行边界".to_owned(),
        optional: true,
        origins: vec![],
    });
    manifest.tasks.push(model::Task {
        id: "tick".to_owned(),
        command: "background-check".to_owned(),
        interval_seconds: 60,
    });
    let id = manifest.id.clone();
    let grants = vec!["storage".to_owned()];
    let preview = state.preview(build(&manifest)?, false).await?;
    state
        .install(app.handle(), &preview.ticket, grants.clone(), 0, true)
        .await?;
    assert!(!state.snapshot().await.items[0].record.enabled);
    state
        .configure(
            &id,
            true,
            grants.clone(),
            state.snapshot().await.revision,
            true,
            &state.snapshot().await.items[0].record.digest,
        )
        .await?;
    let (first, second) = tokio::join!(
        state.invoke(app.handle(), &id, "render", Value::Null),
        state.invoke(app.handle(), &id, "render", Value::Null)
    );
    assert!(
        first.is_ok() && second.is_ok(),
        "并发界面应共享同一次宿主启动"
    );
    assert!(
        state
            .invoke(app.handle(), &id, "background-check", Value::Null)
            .await
            .is_err()
    );
    state
        .invoke(app.handle(), &id, "increment", Value::Null)
        .await?;
    assert!(
        state
            .invoke(app.handle(), &id, "render", Value::Null)
            .await?
            .to_string()
            .contains("\"value\":\"1\"")
    );
    state
        .configure(
            &id,
            false,
            vec![],
            state.snapshot().await.revision,
            false,
            &state.snapshot().await.items[0].record.digest,
        )
        .await?;
    assert!(
        state
            .invoke(app.handle(), &id, "render", Value::Null)
            .await
            .is_err()
    );
    manifest.version = "1.1.0".to_owned();
    manifest.data_version = 2;
    let preview = state.preview(build(&manifest)?, false).await?;
    state
        .install(
            app.handle(),
            &preview.ticket,
            grants.clone(),
            state.snapshot().await.revision,
            true,
        )
        .await?;
    assert_eq!(
        state.snapshot().await.items[0].record.manifest.data_version,
        2
    );
    state
        .configure(
            &id,
            true,
            grants.clone(),
            state.snapshot().await.revision,
            true,
            &state.snapshot().await.items[0].record.digest,
        )
        .await?;
    state
        .invoke(app.handle(), &id, "increment", Value::Null)
        .await?;
    assert!(
        state
            .invoke(app.handle(), &id, "render", Value::Null)
            .await?
            .to_string()
            .contains("\"value\":\"2\"")
    );
    state
        .rollback(&id, state.snapshot().await.revision, true)
        .await?;
    state
        .configure(
            &id,
            true,
            grants,
            state.snapshot().await.revision,
            true,
            &state.snapshot().await.items[0].record.digest,
        )
        .await?;
    assert!(
        state
            .invoke(app.handle(), &id, "render", Value::Null)
            .await?
            .to_string()
            .contains("\"value\":\"1\"")
    );
    state.safe_mode(true, true).await?;
    assert!(
        state
            .invoke(app.handle(), &id, "render", Value::Null)
            .await
            .is_err()
    );
    state
        .uninstall(&id, true, state.snapshot().await.revision, true)
        .await?;
    assert!(state.snapshot().await.items.is_empty());
    assert!(!state.root.join("data").join(&id).exists());
    Ok(())
}

#[tokio::test]
async fn safe_mode_persists_and_failed_calls_are_quarantined() -> Result<()> {
    let temporary = tempfile::tempdir().map_err(io_error)?;
    let state = PluginState::new(temporary.path())?;
    let record = record()?;
    let id = record.manifest.id.clone();
    state
        .registry
        .lock()
        .await
        .records
        .insert(id.clone(), record.clone());
    for _ in 0..3 {
        state.outcome(&record, true).await?;
    }
    assert!(state.registry.lock().await.records[&id].quarantined);
    state.safe_mode(true, true).await?;
    let restarted = PluginState::new(temporary.path())?;
    assert!(restarted.snapshot().await.safe_mode);
    assert!(restarted.available(&id).is_err());
    restarted.safe_mode(false, true).await?;
    assert!(restarted.available(&id).is_ok());
    Ok(())
}

#[tokio::test]
async fn uninstall_purges_data_and_backups_but_preserves_publisher() -> Result<()> {
    let temporary = tempfile::tempdir().map_err(io_error)?;
    let state = PluginState::new(temporary.path())?;
    let record = record()?;
    let id = record.manifest.id.clone();
    {
        let mut registry = state.registry.lock().await;
        registry.records.insert(id.clone(), record.clone());
        registry.publishers.insert(id.clone(), record.publisher_key);
        registry.data_versions.insert(id.clone(), 1);
    }
    storage::atomic_write(
        &state.root.join("data").join(&id).join("counter.json"),
        b"1",
    )?;
    storage::atomic_write(
        &state
            .root
            .join("backups")
            .join(&id)
            .join("a".repeat(64))
            .join("counter.json"),
        b"0",
    )?;
    assert!(state.uninstall(&id, true, 1, true).await.is_err());
    state.uninstall(&id, true, 0, true).await?;
    assert!(!state.root.join("data").join(&id).exists());
    assert!(!state.root.join("backups").join(&id).exists());
    let registry = state.registry.lock().await;
    assert!(!registry.records.contains_key(&id));
    assert!(registry.publishers.contains_key(&id));
    assert!(!registry.data_versions.contains_key(&id));
    Ok(())
}

#[tokio::test]
async fn file_tickets_are_owner_bound_one_time_and_do_not_overwrite() -> Result<()> {
    let temporary = tempfile::tempdir().map_err(io_error)?;
    let state = PluginState::new(temporary.path())?;
    let path = temporary.path().join("export.txt");
    let ticket = uuid::Uuid::new_v4().to_string();
    state.files.lock().await.insert(
        ticket.clone(),
        files::Grant {
            owner: "test.plugin".to_owned(),
            digest: "a".repeat(64),
            created: Instant::now(),
            target: files::Target::Write(path.clone()),
        },
    );
    assert!(
        state
            .file_call(
                "another.plugin",
                &"a".repeat(64),
                "file.write",
                json!({"ticket":ticket,"base64":"eA=="})
            )
            .await
            .is_err()
    );
    state
        .file_call(
            "test.plugin",
            &"a".repeat(64),
            "file.write",
            json!({"ticket":ticket,"base64":"aGVsbG8="}),
        )
        .await?;
    assert_eq!(std::fs::read(&path).map_err(io_error)?, b"hello");
    assert!(
        state
            .file_call(
                "test.plugin",
                &"a".repeat(64),
                "file.write",
                json!({"ticket":ticket,"base64":"aGVsbG8="})
            )
            .await
            .is_err()
    );
    let ticket = uuid::Uuid::new_v4().to_string();
    state.files.lock().await.insert(
        ticket.clone(),
        files::Grant {
            owner: "test.plugin".to_owned(),
            digest: "a".repeat(64),
            created: Instant::now(),
            target: files::Target::Write(path.clone()),
        },
    );
    assert!(
        state
            .file_call(
                "test.plugin",
                &"a".repeat(64),
                "file.write",
                json!({"ticket":ticket,"base64":"eA=="})
            )
            .await
            .is_err()
    );
    assert_eq!(std::fs::read(path).map_err(io_error)?, b"hello");
    Ok(())
}
fn archive(signed: bool, tamper: bool, extra: bool) -> Result<Vec<u8>> {
    let manifest = encode(&manifest()?)?;
    let component = b"\0asm\x0d\0\x01\0";
    let integrity = encode(&BTreeMap::from([(
        "component.wasm",
        package::digest(component),
    )]))?;
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default();
    for (name, bytes) in [
        ("manifest.json", manifest.as_slice()),
        ("integrity.json", integrity.as_slice()),
        ("component.wasm", component.as_slice()),
    ] {
        zip.start_file(name, options)
            .map_err(|_| error("fixture"))?;
        zip.write_all(bytes).map_err(io_error)?;
    }
    if signed {
        let key = SigningKey::from_bytes(&[7; 32]);
        let message = package::signed_message(&manifest, &integrity);
        let mut signature = key.sign(&message).to_bytes();
        if tamper {
            signature[0] ^= 1;
        }
        let to_hex = |bytes: &[u8]| bytes.iter().map(|v| format!("{v:02x}")).collect::<String>();
        let seal = json!({"publicKey":to_hex(key.verifying_key().as_bytes()),"signature":to_hex(&signature)});
        zip.start_file("signature.json", options)
            .map_err(|_| error("fixture"))?;
        zip.write_all(&encode(&seal)?).map_err(io_error)?;
    }
    if extra {
        zip.start_file("unlisted.json", options)
            .map_err(|_| error("fixture"))?;
        zip.write_all(b"{}").map_err(io_error)?;
    }
    Ok(zip.finish().map_err(|_| error("fixture"))?.into_inner())
}
#[test]
fn verifies_signatures_and_full_file_coverage() -> Result<()> {
    assert!(package::read(&archive(true, false, false)?, false).is_ok());
    assert!(package::read(&archive(true, true, false)?, false).is_err());
    assert!(package::read(&archive(true, false, true)?, false).is_err());
    assert!(package::read(&archive(false, false, false)?, false).is_err());
    assert!(package::read(&archive(false, false, false)?, true).is_ok());
    Ok(())
}
#[test]
fn grants_are_declared_unique_and_complete() -> Result<()> {
    let manifest = manifest()?;
    assert!(PluginState::validate_grants(&manifest, &[]).is_err());
    assert!(PluginState::validate_grants(&manifest, &["storage".to_owned()]).is_ok());
    assert!(PluginState::validate_grants(&manifest, &["network".to_owned()]).is_err());
    assert!(
        PluginState::validate_grants(&manifest, &["storage".to_owned(), "storage".to_owned()])
            .is_err()
    );
    Ok(())
}
#[test]
fn views_cannot_inject_markup_urls_or_unknown_commands() -> Result<()> {
    let manifest = manifest()?;
    assert!(
        model::validate_view(
            &json!({"type":"text","text":"<script>普通文字</script>"}),
            &manifest.contributions
        )
        .is_ok()
    );
    for value in [
        json!({"type":"html","text":"x"}),
        json!({"type":"text","text":"x","url":"https://example.com"}),
        json!({"type":"button","text":"x","command":"undeclared"}),
    ] {
        assert!(model::validate_view(&value, &manifest.contributions).is_err());
    }
    let mut tree = json!({"type":"text","text":"x"});
    for _ in 0..10 {
        tree = json!({"type":"stack","children":[tree]});
    }
    assert!(model::validate_view(&tree, &manifest.contributions).is_err());
    Ok(())
}
#[tokio::test]
async fn corrupted_registry_preserves_original_and_enters_safe_mode() -> Result<()> {
    let temporary = tempfile::tempdir().map_err(io_error)?;
    let folder = temporary.path().join("plugins");
    storage::atomic_write(&folder.join("registry.json"), b"broken")?;
    let state = PluginState::new(temporary.path())?;
    assert!(state.snapshot().await.safe_mode);
    assert!(
        std::fs::read_dir(folder)
            .map_err(io_error)?
            .filter_map(std::result::Result::ok)
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .starts_with("registry-corrupt-"))
    );
    Ok(())
}
#[tokio::test]
async fn publisher_binding_survives_uninstall_metadata() -> Result<()> {
    let temporary = tempfile::tempdir().map_err(io_error)?;
    let state = PluginState::new(temporary.path())?;
    state
        .registry
        .lock()
        .await
        .publishers
        .insert(manifest()?.id, Some("different-publisher".to_owned()));
    assert!(
        state
            .preview(archive(true, false, false)?, false)
            .await
            .is_err()
    );
    Ok(())
}
#[test]
fn manifest_cannot_enable_native_execution_or_implicit_network() -> Result<()> {
    let mut reserved = manifest()?;
    reserved.id = "con.plugin".to_owned();
    assert!(reserved.validate().is_err());
    let mut native = manifest()?;
    native.runtime = "native".to_owned();
    assert!(native.validate().is_err());
    let mut network = manifest()?;
    network.permissions.push(model::Permission {
        id: "network".to_owned(),
        reason: "test".to_owned(),
        optional: true,
        origins: vec![],
    });
    assert!(network.validate().is_err());
    assert!(model::origin("http://example.com").is_err());
    assert!(model::origin("https://example.com/path").is_err());
    assert!(model::origin("https://example.com").is_ok());
    Ok(())
}
/// 真实开发者身份与会费服务的完整联调。凭据只从维护者 D 盘私有目录读取，不生成测试后门。
/// 使用合成成员与独立临时账本；联网解析由单独的 live_dues_api 测试核验，避免外部离线掩盖业务结果。
#[cfg(feature = "developer-edition")]
#[tokio::test]
#[ignore = "需要本机已有开发者凭据；使用独立合成成员账本"]
async fn native_developer_dues_auth_edit_pay_void_and_fallback() -> Result<()> {
    #[derive(serde::Deserialize)]
    struct Credential {
        email: String,
        stoken: String,
    }
    async fn execute(state: &PluginState, input: serde_json::Value) -> Result<dues::Ledger> {
        let action = input
            .get("action")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("unknown")
            .to_owned();
        let request = serde_json::from_value(input).map_err(|_| error("DUES_TEST_REQUEST"))?;
        // 只报告固定动作名与受控原生错误，不拼接成员资料或凭据。
        let result = state
            .builtin_dues(request)
            .await
            .map_err(|cause| error(format!("DUES_TEST_{action}：{cause}")))?;
        serde_json::from_value(result).map_err(|_| error("DUES_TEST_RESPONSE"))
    }
    let project = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| error("DUES_TEST_ROOT"))?;
    let temporary = tempfile::tempdir().map_err(io_error)?;
    let identity = crate::services::developer::DeveloperState::new(temporary.path())?;
    // 与实际 run_app 相同：设置服务先准备 settings 目录，认证回退才可持久化通道选择。
    let _settings = crate::services::settings::SettingsState::new(temporary.path())?;
    let state = PluginState::new(temporary.path())?;
    assert!(!dues::visible());
    assert!(state.snapshot().await.builtins.is_empty());
    assert!(execute(&state, json!({"action":"snapshot"})).await.is_err());
    let mut credential: Credential = serde_json::from_slice(&storage::read_bounded(
        &project.join(".local/developer-identity/initial-credential.json"),
        8192,
    )?)
    .map_err(|_| error("DUES_TEST_IDENTITY"))?;
    let authenticated = identity
        .authenticate(&credential.email, &credential.stoken)
        .await;
    credential.stoken.clear();
    assert_eq!(authenticated?.mode, "developer");
    assert!(
        state
            .snapshot()
            .await
            .builtins
            .iter()
            .any(|item| item.id == dues::ID)
    );
    state.dues.seed_synthetic_members_for_test().await?;
    let mut ledger = execute(&state, json!({"action":"snapshot"})).await?;
    let count = ledger.members.len();
    let member = ledger
        .members
        .first()
        .ok_or_else(|| error("DUES_TEST_MEMBERS"))?
        .wxid
        .clone();
    ledger = execute(&state, json!({"action":"settings","revision":ledger.revision,"monthlyCents":101,"annualCents":10001})).await?;
    ledger = execute(&state, json!({"action":"edit-member","revision":ledger.revision,"wxid":member,"nickname":"隔离测试成员","groupNickname":"隔离测试群昵称","remark":"仅本次临时账本"})).await?;
    ledger = execute(&state, json!({"action":"pay","revision":ledger.revision,"wxids":[member],"month":"2026-11","kind":"annual","amountCents":10001,"remark":"隔离测试，不是实际缴费"})).await?;
    assert_eq!(ledger.payments.len(), 1);
    assert_eq!(ledger.payments[0].months, 12);
    assert_eq!(ledger.payments[0].amount_cents, 10001);
    assert!(ledger.payments[0].remark.contains("2026年11月"));
    assert!(execute(&state, json!({"action":"pay","revision":ledger.revision,"wxids":[member],"month":"2027-01","kind":"monthly","amountCents":101,"remark":""})).await.is_err());
    let payment = ledger.payments[0].id.clone();
    ledger = execute(
        &state,
        json!({"action":"void","revision":ledger.revision,"id":payment,"reason":"隔离验收结束"}),
    )
    .await?;
    assert!(ledger.payments[0].voided_at.is_some());
    let reopened = PluginState::new(temporary.path())?;
    assert_eq!(
        execute(&reopened, json!({"action":"snapshot"}))
            .await?
            .revision,
        ledger.revision
    );
    state.safe_mode(true, true).await?;
    assert!(execute(&state, json!({"action":"snapshot"})).await.is_err());
    state.safe_mode(false, true).await?;
    identity.fallback("隔离测试结束").await?;
    assert!(state.snapshot().await.builtins.is_empty());
    assert!(execute(&state, json!({"action":"snapshot"})).await.is_err());
    std::fs::write(project.join(".cache/verification/dues-native-workflow.json"), serde_json::to_vec_pretty(&json!({"version":crate::services::developer::build_version(),"passed":true,"memberCount":count,"memberSource":"synthetic-fixture","realSignatureAuthentication":true,"unauthenticatedDenied":true,"liveApiSync":false,"editing":true,"annualPayment":true,"overlapDenied":true,"voidAudit":true,"reopenPersistence":true,"safeMode":true,"fallbackHidden":true,"isolatedTemporaryLedger":true,"installerExecuted":false,"systemChangesExecuted":false})).map_err(|_| error("DUES_TEST_REPORT"))?).map_err(io_error)?;
    Ok(())
}
