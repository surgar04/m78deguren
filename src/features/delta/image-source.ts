/** 官方角色头像可能是纯数字资源 ID；协议相对地址须先于普通相对路径解析。 */
export function deltaImageSource(source: string | undefined) {
  if (!source) return '';
  if (source.startsWith('//')) return `https:${source}`;
  if (source.startsWith('/')) return `https://gjts.cn${source}`;
  if (/^\d{1,32}$/u.test(source))
    return `https://playerhub.df.qq.com/playerhub/60004/object/${source}.png`;
  if (source.startsWith('http://')) return `https://${source.slice(7)}`;
  return source;
}
