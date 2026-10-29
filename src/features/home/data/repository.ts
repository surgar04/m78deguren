import type { HomeData } from '../types';
/** 日期是界面格式；头像由原生 Steam 身份提供，未选择身份时显示中性用户图标。 */
export function loadLocalHomeData(): HomeData {
  return {
    source: 'local',
    date: new Intl.DateTimeFormat('zh-CN', { dateStyle: 'full' }).format(new Date()),
  };
}
