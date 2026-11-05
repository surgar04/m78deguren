//! 安装包只解析数据，绝不执行安装脚本。签名覆盖原始清单和摘要表，避免 JSON 重编码歧义。
use super::model::{MAX_PACKAGE, Manifest, package_path};
use crate::services::tools::{Result, error};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    io::{Cursor, Read},
};

pub struct Package {
    pub manifest: Manifest,
    pub files: BTreeMap<String, Vec<u8>>,
    pub publisher_key: Option<String>,
    pub digest: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Seal {
    public_key: String,
    signature: String,
}

pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn hex<const N: usize>(value: &str) -> Result<[u8; N]> {
    if value.len() != N * 2
        || !value
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return Err(error("PLUGIN_SIGNATURE：签名编码无效"));
    }
    let mut result = [0; N];
    for (index, part) in value.as_bytes().chunks_exact(2).enumerate() {
        let text =
            std::str::from_utf8(part).map_err(|_| error("PLUGIN_SIGNATURE：签名编码无效"))?;
        result[index] =
            u8::from_str_radix(text, 16).map_err(|_| error("PLUGIN_SIGNATURE：签名编码无效"))?;
    }
    Ok(result)
}
pub fn signed_message(manifest: &[u8], integrity: &[u8]) -> Vec<u8> {
    let mut message = b"zhenjing-plugin-package-v1\0".to_vec();
    message.extend_from_slice(&(manifest.len() as u64).to_le_bytes());
    message.extend_from_slice(manifest);
    message.extend_from_slice(&(integrity.len() as u64).to_le_bytes());
    message.extend_from_slice(integrity);
    message
}
pub fn read(bytes: &[u8], allow_unsigned: bool) -> Result<Package> {
    if bytes.len() > MAX_PACKAGE {
        return Err(error("PLUGIN_PACKAGE_LIMIT：安装包超过 64 MiB"));
    }
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|_| error("PLUGIN_PACKAGE：归档格式无效"))?;
    if archive.is_empty() || archive.len() > 256 {
        return Err(error("PLUGIN_PACKAGE_LIMIT：文件数量无效"));
    }
    let mut files = BTreeMap::new();
    let mut names = std::collections::BTreeSet::new();
    let mut total = 0usize;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|_| error("PLUGIN_PACKAGE：归档条目无效"))?;
        let name = entry.name().to_owned();
        package_path(&name)?;
        if !names.insert(name.to_ascii_lowercase())
            || entry.is_dir()
            || entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 != 0 && mode & 0o170000 != 0o100000)
            || entry.size() > MAX_PACKAGE as u64
        {
            return Err(error(
                "PLUGIN_PACKAGE：不接受重复条目、目录、链接或超大文件",
            ));
        }
        let mut content = Vec::new();
        entry
            .by_ref()
            .take((MAX_PACKAGE + 1) as u64)
            .read_to_end(&mut content)
            .map_err(|_| error("PLUGIN_PACKAGE：解压失败"))?;
        total = total
            .checked_add(content.len())
            .ok_or_else(|| error("PLUGIN_PACKAGE_LIMIT：总长度溢出"))?;
        if total > 128 * 1024 * 1024 || content.len() > MAX_PACKAGE {
            return Err(error("PLUGIN_PACKAGE_LIMIT：解压内容超过上限"));
        }
        files.insert(name, content);
    }
    let manifest_bytes = files
        .get("manifest.json")
        .ok_or_else(|| error("PLUGIN_PACKAGE：缺少 manifest.json"))?;
    let integrity_bytes = files
        .get("integrity.json")
        .ok_or_else(|| error("PLUGIN_PACKAGE：缺少 integrity.json"))?;
    if manifest_bytes.len() > 64 * 1024 || integrity_bytes.len() > 64 * 1024 {
        return Err(error("PLUGIN_PACKAGE_LIMIT：清单过大"));
    }
    let manifest: Manifest = serde_json::from_slice(manifest_bytes)
        .map_err(|_| error("PLUGIN_MANIFEST：清单格式无效"))?;
    manifest.validate()?;
    let integrity: BTreeMap<String, String> = serde_json::from_slice(integrity_bytes)
        .map_err(|_| error("PLUGIN_INTEGRITY：摘要表格式无效"))?;
    if integrity.len() + 2 + usize::from(files.contains_key("signature.json")) != files.len() {
        return Err(error("PLUGIN_INTEGRITY：摘要表未覆盖全部文件"));
    }
    for (name, expected) in &integrity {
        if ["manifest.json", "integrity.json", "signature.json"].contains(&name.as_str()) {
            return Err(error("PLUGIN_INTEGRITY：元数据不能出现在摘要表中"));
        }
        let content = files
            .get(name)
            .ok_or_else(|| error("PLUGIN_INTEGRITY：文件缺失"))?;
        if &digest(content) != expected {
            return Err(error("PLUGIN_INTEGRITY：文件摘要不符"));
        }
    }
    let component = files
        .get(&manifest.entry)
        .ok_or_else(|| error("PLUGIN_PACKAGE：缺少组件入口"))?;
    if !component.starts_with(b"\0asm\x0d\0\x01\0") {
        return Err(error(
            "PLUGIN_COMPONENT：必须提供 Wasm Component，不能提供原生程序或预编译缓存",
        ));
    }
    let publisher_key = if let Some(bytes) = files.get("signature.json") {
        if bytes.len() > 4096 {
            return Err(error("PLUGIN_SIGNATURE：签名内容过大"));
        }
        let seal: Seal =
            serde_json::from_slice(bytes).map_err(|_| error("PLUGIN_SIGNATURE：签名格式无效"))?;
        let key = VerifyingKey::from_bytes(&hex::<32>(&seal.public_key)?)
            .map_err(|_| error("PLUGIN_SIGNATURE：公钥无效"))?;
        key.verify_strict(
            &signed_message(manifest_bytes, integrity_bytes),
            &Signature::from_bytes(&hex::<64>(&seal.signature)?),
        )
        .map_err(|_| error("PLUGIN_SIGNATURE：签名不匹配"))?;
        Some(seal.public_key)
    } else if allow_unsigned {
        None
    } else {
        return Err(error("PLUGIN_UNSIGNED：当前通道不接受未签名插件"));
    };
    Ok(Package {
        manifest,
        files,
        publisher_key,
        digest: digest(bytes),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_windows_aliases_and_traversal() {
        for name in [
            "../escape",
            "C:/x",
            "dir\\x",
            "a/CON.txt",
            "a/a.",
            "/x",
            "a//x",
            "x:stream",
            "a/COM1",
        ] {
            assert!(package_path(name).is_err(), "{name}");
        }
        assert!(package_path("assets/icon.png").is_ok());
    }
    #[test]
    fn signature_domain_and_lengths_are_unambiguous() {
        assert_ne!(signed_message(b"ab", b"c"), signed_message(b"a", b"bc"));
        assert!(hex::<1>("aa").is_ok());
        assert!(hex::<1>("AA").is_err());
    }
}
