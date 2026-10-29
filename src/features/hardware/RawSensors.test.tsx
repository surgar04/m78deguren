import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RawSensors } from './RawSensors';
import type { HardwareSensor } from '@/lib/hardware-contracts';

// 仅用于边界测试的明确夹具，生产代码与生成报告均不导入本文件。
const rows: HardwareSensor[] = [
  {
    id: 'cpu/temp',
    hardwareId: 'cpu',
    hardware: '测试 CPU',
    hardwareType: 'Cpu',
    name: '核心温度',
    sensorType: 'Temperature',
    unit: '°C',
    value: 42,
    min: 40,
    max: 45,
  },
  {
    id: 'cpu/load',
    hardwareId: 'cpu',
    hardware: '测试 CPU',
    hardwareType: 'Cpu',
    name: '使用率',
    sensorType: 'Load',
    unit: '%',
    value: 18,
    min: 10,
    max: 20,
  },
  {
    id: 'gpu/temp',
    hardwareId: 'gpu',
    hardware: '测试 GPU',
    hardwareType: 'GpuIntel',
    name: '核心温度',
    sensorType: 'Temperature',
    unit: '°C',
    value: null,
    min: null,
    max: null,
  },
];
describe('独立原始传感器视图', () => {
  it('组合硬件/类型/名称筛选，并显示最新真实字段与单位', () => {
    const view = render(<RawSensors sensors={rows} />);
    fireEvent.click(screen.getByRole('button', { name: '全部展开' }));
    expect(screen.getByText('42 °C')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: '硬件类型筛选' }), {
      target: { value: 'Cpu' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: '传感器类型筛选' }), {
      target: { value: 'Temperature' },
    });
    expect(screen.queryByText('使用率')).not.toBeInTheDocument();
    view.rerender(
      <RawSensors
        sensors={rows.map((row) => (row.id === 'cpu/temp' ? { ...row, value: 44 } : row))}
      />,
    );
    expect(screen.getByText('44 °C')).toBeInTheDocument();
    expect(screen.queryByText('42 °C')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '没有该名称' } });
    expect(screen.getByText(/没有匹配的传感器/u)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '全部收起' }));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
