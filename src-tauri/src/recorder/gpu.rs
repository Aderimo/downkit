//! Ekran kartlarının listesi (DXGI): ad, üretici, sürücü sürümü ve bağlı ekranlar.
//! Kodlayıcı denemelerinin disk önbelleği bu bilgiyle anahtarlanır; sürücü ya da
//! kart değişince denemeler yeniden yapılır.

use serde::Serialize;
use windows::core::Interface;
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIDevice, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE,
};

pub const VENDOR_NVIDIA: u32 = 0x10DE;
pub const VENDOR_AMD: u32 = 0x1002;
pub const VENDOR_INTEL: u32 = 0x8086;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Adapter {
    /// DXGI sırası (`-init_hw_device d3d11va:N` ile aynı).
    pub index: u32,
    pub name: String,
    pub vendor_id: u32,
    pub dedicated_mb: u64,
    pub driver: String,
    /// Bu karta bağlı ekranların tutamaçları.
    pub monitors: Vec<u64>,
}

fn wide(buffer: &[u16]) -> String {
    let len = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..len])
}

/// Yazılım (Microsoft Basic Render) sürücüsü dışındaki kartlar.
pub fn adapters() -> Vec<Adapter> {
    let mut list = Vec::new();
    unsafe {
        let Ok(factory) = CreateDXGIFactory1::<IDXGIFactory1>() else {
            return list;
        };
        let mut index = 0;
        while let Ok(adapter) = factory.EnumAdapters1(index) {
            index += 1;
            let Ok(desc) = adapter.GetDesc1() else {
                continue;
            };
            if desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0 {
                continue;
            }
            let driver = adapter
                .CheckInterfaceSupport(&IDXGIDevice::IID)
                .map(|v| {
                    let v = v as u64;
                    format!(
                        "{}.{}.{}.{}",
                        v >> 48,
                        (v >> 32) & 0xFFFF,
                        (v >> 16) & 0xFFFF,
                        v & 0xFFFF
                    )
                })
                .unwrap_or_default();
            let mut monitors = Vec::new();
            let mut o = 0;
            while let Ok(output) = adapter.EnumOutputs(o) {
                if let Ok(d) = output.GetDesc() {
                    monitors.push(d.Monitor.0 as u64);
                }
                o += 1;
            }
            list.push(Adapter {
                index: index - 1,
                name: wide(&desc.Description).trim().to_string(),
                vendor_id: desc.VendorId,
                dedicated_mb: desc.DedicatedVideoMemory as u64 / (1024 * 1024),
                driver,
                monitors,
            });
        }
    }
    list
}

/// Kart + sürücü kümesinin parmak izi: değişince önbellekteki denemeler geçersizdir.
pub fn fingerprint(adapters: &[Adapter]) -> String {
    adapters
        .iter()
        .map(|a| format!("{:04x}:{}:{}", a.vendor_id, a.name, a.driver))
        .collect::<Vec<_>>()
        .join("|")
}

#[tauri::command]
pub fn recorder_gpus() -> Vec<Adapter> {
    adapters()
}
