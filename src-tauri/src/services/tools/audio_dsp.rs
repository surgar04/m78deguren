//! EQ 与音效的纯 Rust DSP。所有数组和延迟线在启动时分配，音频回调不加锁、不做文件/网络 I/O。
use super::{Result, error};
use serde::{Deserialize, Serialize};
use std::f64::consts::PI;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Band {
    pub frequency: f64,
    pub gain: f64,
}
#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct Effects {
    pub clarity: f64,
    pub ambience: f64,
    pub width: f64,
    pub dynamics: f64,
    pub bass: f64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EqConfig {
    pub enabled: bool,
    pub preamp: f64,
    pub bands: Vec<Band>,
    pub effects: Effects,
    pub headroom: bool,
}
impl Default for EqConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            preamp: 0.0,
            bands: [
                31.5, 63.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0,
            ]
            .into_iter()
            .map(|frequency| Band {
                frequency,
                gain: 0.0,
            })
            .collect(),
            effects: Effects::default(),
            headroom: true,
        }
    }
}
impl EqConfig {
    pub fn validate(&self) -> Result<()> {
        if ![5, 10, 15, 20, 31].contains(&self.bands.len())
            || !self.preamp.is_finite()
            || !(-24.0..=12.0).contains(&self.preamp)
        {
            return Err(error("EQ 频段数或前级增益无效"));
        }
        let mut previous = 0.0;
        for band in &self.bands {
            if !band.frequency.is_finite()
                || !band.gain.is_finite()
                || !(20.0..=20000.0).contains(&band.frequency)
                || !(-24.0..=24.0).contains(&band.gain)
                || band.frequency <= previous
            {
                return Err(error("EQ 频率必须递增，且增益在 -24 至 24 dB 之间"));
            }
            previous = band.frequency;
        }
        for value in [
            self.effects.clarity,
            self.effects.ambience,
            self.effects.width,
            self.effects.dynamics,
            self.effects.bass,
        ] {
            if !value.is_finite() || !(0.0..=1.0).contains(&value) {
                return Err(error("音效参数必须位于 0 至 1"));
            }
        }
        Ok(())
    }
}
#[derive(Clone, Copy)]
pub struct Coefficients {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
}
impl Default for Coefficients {
    fn default() -> Self {
        Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
        }
    }
}
impl Coefficients {
    /// RBJ peaking EQ，频率始终小于 Nyquist；0 dB 明确返回恒等滤波器。
    fn peak(rate: f64, frequency: f64, gain: f64, q: f64) -> Self {
        if gain.abs() < 0.0001 {
            return Self::default();
        }
        let a = 10_f64.powf(gain / 40.0);
        let omega = 2.0 * PI * frequency.min(rate * 0.45) / rate;
        let alpha = omega.sin() / (2.0 * q);
        let denominator = 1.0 + alpha / a;
        Self {
            b0: (1.0 + alpha * a) / denominator,
            b1: -2.0 * omega.cos() / denominator,
            b2: (1.0 - alpha * a) / denominator,
            a1: -2.0 * omega.cos() / denominator,
            a2: (1.0 - alpha / a) / denominator,
        }
    }
    fn approach(&mut self, target: Self, step: f64) {
        self.b0 += (target.b0 - self.b0) * step;
        self.b1 += (target.b1 - self.b1) * step;
        self.b2 += (target.b2 - self.b2) * step;
        self.a1 += (target.a1 - self.a1) * step;
        self.a2 += (target.a2 - self.a2) * step;
    }
}
#[derive(Clone, Copy, Default)]
struct Filter {
    z1: f64,
    z2: f64,
}
impl Filter {
    fn sample(&mut self, x: f64, c: Coefficients) -> f64 {
        let y = c.b0 * x + self.z1;
        self.z1 = c.b1 * x - c.a1 * y + self.z2;
        self.z2 = c.b2 * x - c.a2 * y;
        y
    }
}
pub struct Parameters {
    pub coefficients: [Coefficients; 33],
    pub gain: f64,
    pub effects: Effects,
}
impl Parameters {
    pub fn compile(config: &EqConfig, rate: u32) -> Self {
        let mut coefficients = [Coefficients::default(); 33];
        // 频段越密集，Q 越高，避免 31 段仍使用宽带 Q 导致相邻频段过度叠加。
        let q = match config.bands.len() {
            5 => 0.7,
            10 => 1.4,
            15 => 2.2,
            20 => 3.0,
            _ => 4.3,
        };
        if config.enabled {
            for (index, band) in config.bands.iter().enumerate() {
                coefficients[index] =
                    Coefficients::peak(f64::from(rate), band.frequency, band.gain, q);
            }
        }
        coefficients[31] =
            Coefficients::peak(f64::from(rate), 4000.0, config.effects.clarity * 6.0, 0.7);
        coefficients[32] =
            Coefficients::peak(f64::from(rate), 90.0, config.effects.bass * 10.0, 0.6);
        let reserve = if config.headroom {
            config
                .bands
                .iter()
                .map(|v| if config.enabled { v.gain.max(0.0) } else { 0.0 })
                .fold(0.0, f64::max)
                + config.effects.bass * 6.0
                + config.effects.clarity * 3.0
        } else {
            0.0
        };
        Self {
            coefficients,
            gain: 10_f64.powf((config.preamp - reserve) / 20.0),
            effects: config.effects.clone(),
        }
    }
}
pub struct Processor {
    coefficients: [Coefficients; 33],
    filters: [[Filter; 33]; 2],
    delay: Vec<[f64; 2]>,
    cursor: usize,
    gain: f64,
    envelope: f64,
    smoothing: f64,
}
impl Processor {
    pub fn new(rate: u32) -> Self {
        Self {
            coefficients: [Coefficients::default(); 33],
            filters: [[Filter::default(); 33]; 2],
            delay: vec![[0.0; 2]; ((f64::from(rate) * 0.037).round() as usize).max(1)],
            cursor: 0,
            gain: 1.0,
            envelope: 0.0,
            smoothing: 1.0 - (-1.0 / (f64::from(rate) * 0.01)).exp(),
        }
    }
    pub fn process(&mut self, input: [f32; 2], parameters: &Parameters) -> [f32; 2] {
        self.gain += (parameters.gain - self.gain) * self.smoothing;
        for (index, coefficient) in self.coefficients.iter_mut().enumerate() {
            coefficient.approach(parameters.coefficients[index], self.smoothing);
        }
        let mut frame = [
            f64::from(input[0]) * self.gain,
            f64::from(input[1]) * self.gain,
        ];
        for (channel, sample) in frame.iter_mut().enumerate() {
            for (index, coefficient) in self.coefficients.iter().enumerate() {
                *sample = self.filters[channel][index].sample(*sample, *coefficient);
            }
        }
        // Mid/Side 调整立体声宽度，再混入低反馈交叉延迟，避免无界反馈或音量累积。
        let mid = (frame[0] + frame[1]) * 0.5;
        let side = (frame[0] - frame[1]) * 0.5 * (1.0 + parameters.effects.width);
        frame = [mid + side, mid - side];
        let delayed = self.delay[self.cursor];
        self.delay[self.cursor] = [frame[1] + delayed[0] * 0.22, frame[0] + delayed[1] * 0.22];
        self.cursor = (self.cursor + 1) % self.delay.len();
        for (channel, sample) in frame.iter_mut().enumerate() {
            *sample += delayed[channel] * parameters.effects.ambience * 0.25;
        }
        let peak = frame[0].abs().max(frame[1].abs());
        let speed = if peak > self.envelope { 0.04 } else { 0.0004 };
        self.envelope += (peak - self.envelope) * speed;
        let ratio = 1.0 + parameters.effects.dynamics * 4.0;
        let compressor = if self.envelope > 0.5 {
            ((self.envelope / 0.5).powf(1.0 / ratio) * 0.5) / self.envelope
        } else {
            1.0
        };
        let mut output = [0.0; 2];
        for (index, sample) in frame.into_iter().enumerate() {
            let value = sample * compressor;
            if value.is_finite() {
                output[index] = value.clamp(-1.0, 1.0) as f32;
            } else {
                self.filters = [[Filter::default(); 33]; 2];
                self.delay.fill([0.0; 2]);
                self.envelope = 0.0;
            }
        }
        output
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn flat_equalizer_preserves_signal() {
        let config = EqConfig::default();
        let parameters = Parameters::compile(&config, 48000);
        let mut dsp = Processor::new(48000);
        for sample in [0.0, 0.25, -0.5, 0.75] {
            assert_eq!(dsp.process([sample, sample], &parameters), [sample, sample]);
        }
    }
    #[test]
    fn effects_remain_finite_under_impulse() {
        let mut config = EqConfig {
            effects: Effects {
                clarity: 1.0,
                ambience: 1.0,
                width: 1.0,
                dynamics: 1.0,
                bass: 1.0,
            },
            ..EqConfig::default()
        };
        for band in &mut config.bands {
            band.gain = 24.0;
        }
        let parameters = Parameters::compile(&config, 44100);
        let mut dsp = Processor::new(44100);
        for index in 0..44100 {
            for sample in dsp.process(if index == 0 { [1.0, -1.0] } else { [0.0; 2] }, &parameters)
            {
                assert!(sample.is_finite() && sample.abs() <= 1.0);
            }
        }
    }
    #[test]
    fn rejects_nonfinite_and_unordered_parameters() {
        let mut config = EqConfig::default();
        config.bands[0].gain = f64::NAN;
        assert!(config.validate().is_err());
        config.bands[0].gain = 0.0;
        config.bands[1].frequency = 20.0;
        assert!(config.validate().is_err());
    }
}
