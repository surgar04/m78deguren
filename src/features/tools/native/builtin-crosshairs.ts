/** 七种内置图片准心由矢量规则生成透明 PNG；保存后与用户导入图片走同一校验和持久化链路。 */
export const BUILTIN_CROSSHAIRS = [
  { id: 'fine', name: '经典细线' },
  { id: 'rings', name: '双环' },
  { id: 'diamond', name: '菱形' },
  { id: 'point', name: '竞技点' },
  { id: 'corners', name: '四角' },
  { id: 'scope', name: '狙击环' },
  { id: 'chevron', name: '箭头' },
] as const;
export function reticleImage(id: (typeof BUILTIN_CROSSHAIRS)[number]['id'], color: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前 WebView 无法生成准心图片');
  context.translate(64, 64);
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 3;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  const ring = (radius: number) => {
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.stroke();
  };
  const cross = (gap: number, length: number) => {
    context.beginPath();
    for (const [x, y] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      context.moveTo((x ?? 0) * gap, (y ?? 0) * gap);
      context.lineTo((x ?? 0) * (gap + length), (y ?? 0) * (gap + length));
    }
    context.stroke();
  };
  switch (id) {
    case 'fine':
      context.lineWidth = 2;
      cross(8, 27);
      break;
    case 'rings':
      ring(15);
      ring(35);
      break;
    case 'diamond':
      context.beginPath();
      context.moveTo(0, -34);
      context.lineTo(34, 0);
      context.lineTo(0, 34);
      context.lineTo(-34, 0);
      context.closePath();
      context.stroke();
      break;
    case 'point':
      context.beginPath();
      context.arc(0, 0, 5, 0, Math.PI * 2);
      context.fill();
      cross(15, 12);
      break;
    case 'corners':
      for (const x of [-1, 1])
        for (const y of [-1, 1]) {
          context.beginPath();
          context.moveTo(x * 15, y * 33);
          context.lineTo(x * 33, y * 33);
          context.lineTo(x * 33, y * 15);
          context.stroke();
        }
      break;
    case 'scope':
      ring(33);
      cross(0, 43);
      break;
    case 'chevron':
      context.beginPath();
      context.moveTo(-30, 18);
      context.lineTo(0, -12);
      context.lineTo(30, 18);
      context.stroke();
      break;
  }
  return canvas.toDataURL('image/png');
}
