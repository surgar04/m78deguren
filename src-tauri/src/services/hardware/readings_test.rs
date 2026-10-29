//! 仅供测试，确保名称尾空格不会补出一张不存在的 GPU，虚拟适配器不获得伪造的零值。
use super::{
    readings::complete_devices,
    types::{Device, Gpu, Metrics},
};
#[test]
fn fills_only_unmonitored_adapters_without_zero_values() {
    let mut cards = vec![Gpu {
        id: "/gpu/0".into(),
        name: "GPU A ".into(),
        metrics: Metrics::from([("gpu".into(), Some(10.0))]),
    }];
    let devices = vec![
        Device {
            id: "gpu:1".into(),
            kind: "gpu".into(),
            name: "GPU A".into(),
            fields: Vec::new(),
        },
        Device {
            id: "gpu:2".into(),
            kind: "gpu".into(),
            name: "Virtual display".into(),
            fields: Vec::new(),
        },
    ];
    complete_devices(&mut cards, &devices);
    assert_eq!(cards.len(), 2);
    assert_eq!(cards[0].metrics["gpu"], Some(10.0));
    assert!(cards[1].metrics.is_empty());
    assert_eq!(cards[1].id, "gpu:2");
}
