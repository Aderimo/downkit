//! Uygulama kapanınca (çökse bile) başlattığı yt-dlp/ffmpeg süreçlerinin de
//! kapanmasını sağlar. Aksi halde pencere kapansa bile indirme görünmez biçimde
//! sürer; yeniden açılışta "Devam et" aynı yarım dosyaya ikinci bir süreç yazardı.
//!
//! Windows "iş nesnesi" (Job Object) `KILL_ON_JOB_CLOSE` ile oluşturulur; tutamaç
//! yalnızca uygulama sürecinde açık kalır, süreç bitince işletim sistemi tutamacı
//! kapatır ve iş nesnesine bağlı her süreci (yt-dlp'nin başlattığı ffmpeg dahil) sonlandırır.

#[cfg(windows)]
mod imp {
    use std::sync::OnceLock;

    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

    struct JobHandle(HANDLE);
    // Tutamaç yalnızca kimlik gibi kullanılır; Win32 iş nesnesi çağrıları iş
    // parçacığı güvenlidir.
    unsafe impl Send for JobHandle {}
    unsafe impl Sync for JobHandle {}

    fn job() -> Option<HANDLE> {
        static JOB: OnceLock<Option<JobHandle>> = OnceLock::new();
        JOB.get_or_init(|| unsafe {
            let job = CreateJobObjectW(None, PCWSTR::null()).ok()?;
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
            .ok()?;
            Some(JobHandle(job))
        })
        .as_ref()
        .map(|j| j.0)
    }

    pub fn attach(pid: u32) {
        let Some(job) = job() else { return };
        unsafe {
            if let Ok(process) = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid) {
                let _ = AssignProcessToJobObject(job, process);
                let _ = CloseHandle(process);
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use windows::Win32::System::JobObjects::IsProcessInJob;
        use windows::Win32::System::Threading::PROCESS_QUERY_LIMITED_INFORMATION;

        #[test]
        fn baslatilan_surec_is_nesnesine_baglanir() {
            let mut child = std::process::Command::new("cmd")
                .args(["/c", "ping", "-n", "10", "127.0.0.1"])
                .stdout(std::process::Stdio::null())
                .spawn()
                .unwrap();
            attach(child.id());

            let in_job = unsafe {
                let process =
                    OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, child.id()).unwrap();
                let mut result = Default::default();
                IsProcessInJob(process, job(), &mut result).unwrap();
                let _ = CloseHandle(process);
                result.as_bool()
            };
            let _ = child.kill();
            let _ = child.wait();
            assert!(in_job, "süreç iş nesnesine bağlanmadı");
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn attach(_pid: u32) {}
}

/// Süreci, uygulama kapanınca otomatik sonlandırılacaklar arasına ekler.
/// Başarısız olursa sessizce geçer: bu bir güvenlik ağı, işin kendisi değil.
pub fn attach(pid: u32) {
    imp::attach(pid);
}
