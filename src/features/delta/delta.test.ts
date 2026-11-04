import { describe, expect, it } from 'vitest';
import { gameRoomRequestSchema } from '@/lib/game-room-contracts';
import { analyze, battleRows, collectionKind, firstNumber, seasonStats } from './stats-model';
import { drawEquipment } from './random';
import { isPistol } from './data/weapons';
import { deltaImageSource } from './image-source';
import { filledSetting } from './streamer-model';

describe('游戏空间边界与真实数据语义', () => {
  it('解析协议相对头像与数字资源 ID，区分未填写和真实未绑定状态', () => {
    expect(deltaImageSource('//q.qlogo.cn/fixture')).toBe('https://q.qlogo.cn/fixture');
    expect(deltaImageSource('88000000030')).toBe(
      'https://playerhub.df.qq.com/playerhub/60004/object/88000000030.png',
    );
    expect(deltaImageSource('/streamer-settings/avatar.jpg')).toBe(
      'https://gjts.cn/streamer-settings/avatar.jpg',
    );
    expect(filledSetting('—', '未填写')).toBe(false);
    expect(filledSetting('未绑定')).toBe(true);
  });
  it('只接受固定业务请求，拒绝任意地址、未确认报告与非法模式', () => {
    for (const value of [
      { operation: 'link', key: 'arbitrary' },
      { operation: 'refresh', url: 'https://private.invalid' },
      { operation: 'report', id: 1, consent: false },
      { operation: 'detail', room_id: 'room', start_time: '1', queue: 'other' },
    ])
      expect(gameRoomRequestSchema.safeParse(value).success).toBe(false);
    expect(
      gameRoomRequestSchema.parse({ operation: 'season', sid: '12', queue: 'sol' }).operation,
    ).toBe('season');
  });
  it('统计保留零值，缺失数据不伪装为零，模式使用各自赛季字段', () => {
    expect(firstNumber({ zero: 0 }, 'zero', 'absent')).toBe(0);
    expect(firstNumber({}, 'absent')).toBeNull();
    expect(
      seasonStats({ season: { stats: { total: 10 }, sol: { total: 2 }, mp: { total: 3 } } }, 'sol')[
        'total'
      ],
    ).toBe(2);
    expect(analyze([], {}, 'sol')).toBeNull();
  });
  it('压力计算使用排序后的近期对局，正确处理百分率单位并限制参考分上下界', () => {
    const games = battleRows(
      {
        battles_sol: {
          sols: [
            { startTime: 20, gameResult: 0, killCnt: 0, death: 1, ProfitLoss: -9e8, gameTime: 60 },
            { startTime: 10, gameResult: 1, killCnt: 0, death: 1, ProfitLoss: -9e8, gameTime: 60 },
          ],
        },
      },
      'sol',
    );
    expect(games.map((row) => row['startTime'])).toEqual([10, 20]);
    const score = analyze(games, { season: { stats: { solEscaperatio: 0.5 } } }, 'sol');
    expect(score?.winRate).toBe(0.005);
    expect(score?.pps).toBeGreaterThanOrEqual(0);
    expect(score?.mmr).toBeGreaterThanOrEqual(0);
    expect(score?.pressure.reduce((total, value) => total + value, 0)).toBeGreaterThanOrEqual(98);
    expect(collectionKind({ grade: 6, secondClass: 'pendant' }, {})).toBe('pendant');
    expect(collectionKind({ grade: 6, secondClass: 'gun' }, {})).toBe('collection');
  });
});
describe('随机装备规则', () => {
  it('绝密选项不产生常规地图，不带手枪约束覆盖所有抽取结果', () => {
    for (let index = 0; index < 120; index++) {
      const value = drawEquipment({
        classified: true,
        noPistol: true,
        specialTask: true,
        skipAnimation: true,
      });
      expect(['绝密', '永夜']).toContain(value.map.difficulty);
      expect(isPistol(value.weapon)).toBe(false);
      expect(value.task).toBeTruthy();
    }
  });
  it('常规难度不会产生六级防具或五级及以上弹药', () => {
    let normal = 0;
    for (let index = 0; index < 500; index++) {
      const value = drawEquipment({
        classified: false,
        noPistol: false,
        specialTask: false,
        skipAnimation: true,
      });
      expect(value.task).toBeNull();
      if (value.map.difficulty === '常规') {
        normal++;
        expect(value.weapon.selectedAmmoGrade).toBeLessThanOrEqual(4);
        expect(value.helmet.protectLevel).toBeLessThanOrEqual(5);
        expect(value.armor.protectLevel).toBeLessThanOrEqual(5);
      }
    }
    expect(normal).toBeGreaterThan(0);
  });
});
