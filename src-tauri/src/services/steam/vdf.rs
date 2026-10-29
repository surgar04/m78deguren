//! 有界 KeyValues 文本解析与局部编辑。保留未知字段、注释及原始格式，不重建整个 Steam 配置。
use crate::services::tools::{Result, error};
use std::ops::Range;

#[derive(Debug)]
pub struct Entry {
    pub key: String,
    pub value: String,
    pub children: Vec<Entry>,
    pub span: Range<usize>,
    pub value_span: Range<usize>,
}
impl Entry {
    pub fn get(&self, key: &str) -> Option<&Entry> {
        self.children
            .iter()
            .find(|entry| entry.key.eq_ignore_ascii_case(key))
    }
    pub fn text(&self, key: &str) -> &str {
        self.get(key).map_or("", |entry| entry.value.as_str())
    }
    pub fn number(&self, key: &str) -> Option<u64> {
        self.text(key).parse().ok()
    }
}
struct Parser<'a> {
    source: &'a str,
    position: usize,
    count: usize,
}
impl Parser<'_> {
    fn skip(&mut self) {
        loop {
            while self
                .source
                .as_bytes()
                .get(self.position)
                .is_some_and(u8::is_ascii_whitespace)
            {
                self.position += 1;
            }
            if self
                .source
                .get(self.position..)
                .is_some_and(|rest| rest.starts_with("//"))
            {
                while self
                    .source
                    .as_bytes()
                    .get(self.position)
                    .is_some_and(|byte| *byte != b'\n')
                {
                    self.position += 1;
                }
            } else {
                break;
            }
        }
    }
    fn token(&mut self) -> Result<(String, Range<usize>)> {
        self.skip();
        let start = self.position;
        let bytes = self.source.as_bytes();
        let Some(&first) = bytes.get(start) else {
            return Err(error("VDF 缺少字段"));
        };
        if first == b'"' {
            self.position += 1;
            let mut value = Vec::new();
            loop {
                let Some(&byte) = bytes.get(self.position) else {
                    return Err(error("VDF 字符串未闭合"));
                };
                self.position += 1;
                if byte == b'"' {
                    break;
                }
                if byte == b'\\'
                    && bytes
                        .get(self.position)
                        .is_some_and(|byte| matches!(*byte, b'"' | b'\\'))
                {
                    value.push(bytes[self.position]);
                    self.position += 1;
                } else {
                    value.push(byte);
                }
            }
            Ok((
                String::from_utf8(value).map_err(|_| error("VDF 不是 UTF-8"))?,
                start..self.position,
            ))
        } else {
            while bytes
                .get(self.position)
                .is_some_and(|byte| !byte.is_ascii_whitespace() && !matches!(*byte, b'{' | b'}'))
            {
                self.position += 1;
            }
            if start == self.position {
                return Err(error("VDF 字段无效"));
            }
            Ok((
                self.source[start..self.position].into(),
                start..self.position,
            ))
        }
    }
    fn object(&mut self, depth: usize) -> Result<Vec<Entry>> {
        if depth > 64 {
            return Err(error("VDF 嵌套超过上限"));
        }
        let mut entries = Vec::new();
        loop {
            self.skip();
            if self.position == self.source.len() {
                if depth != 0 {
                    return Err(error("VDF 对象未闭合"));
                }
                return Ok(entries);
            }
            if self.source.as_bytes()[self.position] == b'}' {
                if depth == 0 {
                    return Err(error("VDF 多余的结束括号"));
                }
                self.position += 1;
                return Ok(entries);
            }
            self.count += 1;
            if self.count > 300_000 {
                return Err(error("VDF 字段过多"));
            }
            let (key, key_span) = self.token()?;
            self.skip();
            let start = self.position;
            let (value, children, value_span) = if self.source.as_bytes().get(start) == Some(&b'{')
            {
                self.position += 1;
                (String::new(), self.object(depth + 1)?, start..self.position)
            } else {
                let (value, span) = self.token()?;
                (value, Vec::new(), span)
            };
            entries.push(Entry {
                key,
                value,
                children,
                span: key_span.start..self.position,
                value_span,
            });
        }
    }
}
pub fn parse(source: &str) -> Result<Entry> {
    if source.len() > 32 * 1024 * 1024 {
        return Err(error("VDF 文件超过读取上限"));
    }
    let mut parser = Parser {
        source,
        position: if source.starts_with('\u{feff}') { 3 } else { 0 },
        count: 0,
    };
    Ok(Entry {
        key: String::new(),
        value: String::new(),
        children: parser.object(0)?,
        span: 0..source.len(),
        value_span: 0..source.len(),
    })
}
pub fn edit_user(source: &str, target: &str, remove: bool) -> Result<String> {
    let root = parse(source)?;
    let users = root
        .get("users")
        .ok_or_else(|| error("未找到 Steam 本地账号列表"))?;
    let account = users
        .get(target)
        .ok_or_else(|| error("本地账号已变化，请刷新"))?;
    let mut patches = Vec::new();
    if remove {
        patches.push((account.span.clone(), String::new()));
    } else {
        for user in &users.children {
            let desired = if user.key == target { "1" } else { "0" };
            if let Some(field) = user.get("MostRecent") {
                patches.push((field.value_span.clone(), format!("\"{desired}\"")));
            } else {
                patches.push((
                    user.value_span.end - 1..user.value_span.end - 1,
                    format!("\n\t\t\"MostRecent\" \"{desired}\"\n\t"),
                ));
            }
        }
        // 不强制 RememberPassword=1，也不改变其他账号的密码记忆偏好；Steam Guard 仍由客户端处理。
    }
    patches.sort_by_key(|patch| std::cmp::Reverse(patch.0.start));
    let mut output = source.to_owned();
    for (range, value) in patches {
        output.replace_range(range, &value);
    }
    parse(&output)?;
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn edit_preserves_unrelated_data_and_escaping() -> Result<()> {
        let input = "// keep\n\"users\" { \"1\" { \"AccountName\" \"name\\\"x\" \"MostRecent\" \"1\" \"unknown\" \"keep\" } \"2\" {\"MostRecent\" \"0\"} }";
        let switched = edit_user(input, "2", false)?;
        assert!(switched.starts_with("// keep"));
        let parsed = parse(&switched)?;
        assert_eq!(
            parsed
                .get("users")
                .and_then(|users| users.get("1"))
                .map(|user| user.text("AccountName")),
            Some("name\"x")
        );
        assert!(switched.contains("\"unknown\" \"keep\""));
        let removed = edit_user(input, "2", true)?;
        assert_eq!(
            parse(&removed)?
                .get("users")
                .map(|users| users.children.len()),
            Some(1)
        );
        assert!(parse("\"x\" { \"a\" \"b\"").is_err());
        assert!(edit_user(input, "3", true).is_err());
        Ok(())
    }
}
