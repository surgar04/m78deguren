import { z } from 'zod';

/** 构建、签名、验收和上传共用发行身份，避免覆盖另一通道的 MSI。 */
export function releaseIdentity(
  baseVersion: string,
  edition: string = 'stable',
  build: string = '1',
) {
  z.string()
    .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u)
    .refine(
      (value) =>
        value.split('.').every((part, index) => Number(part) <= (index === 2 ? 65535 : 255)),
      '版本超出 MSI 三段版本范围',
    )
    .parse(baseVersion);
  const channel = z.enum(['stable', 'developer']).parse(edition);
  const number = Number(
    z
      .string()
      .regex(/^[1-9]\d{0,5}$/u)
      .parse(build),
  );
  const version = channel === 'developer' ? `${baseVersion}-dev.${number}` : baseVersion;
  return {
    baseVersion,
    version,
    channel,
    tag: `v${version}`,
    prerelease: channel === 'developer',
    manifest: channel === 'developer' ? 'zhenjing-developer-update.json' : 'zhenjing-update.json',
    directory: channel === 'developer' ? 'dist/desktop-developer' : 'dist/desktop',
    cargoDirectory:
      channel === 'developer' ? '.cache/cargo/developer-target' : '.cache/cargo/target',
    name: `zhenjing-${version}-windows-x64.msi`,
  };
}
